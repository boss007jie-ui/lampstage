/**
 * 对象存储 adapter — 两路：本地 fs / Cloudflare R2。
 *
 * 自动检测：env 里有 R2_ACCESS_KEY_ID 就走 R2，否则写本地 public/ 目录（开发用）。
 * 这样本地 dev 不需要联网，CI / 部署到 Pages 就自动切到 R2。
 *
 * 上传到 R2 后返回的 URL 是 R2_PUBLIC_BASE + path（用 r2.dev 公开域名 / 或自定义域名）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const SUBDIR_GENERATED = "generated";
const SUBDIR_UPLOADS = "uploads";
const SUBDIR_SUGGEST = "suggest-thumbs";

function isR2(): boolean {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_ENDPOINT,
  );
}

let r2Client: S3Client | null = null;
function getR2(): S3Client {
  if (r2Client) return r2Client;
  r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    // R2 doesn't support per-bucket subdomain style URLs by default
    forcePathStyle: true,
  });
  return r2Client;
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function publicBase(): string {
  return process.env.R2_PUBLIC_BASE?.replace(/\/$/, "") || "";
}

/**
 * 写一个对象。key 形如 "generated/<job>/<n>" 或 "uploads/<user>/<id>"。
 * 返回浏览器可访问的 URL。
 */
export async function putObject(
  key: string,
  data: Buffer,
  mime: string = "image/jpeg",
): Promise<string> {
  const ext = extFromMime(mime);
  const finalKey = key.endsWith(`.${ext}`) ? key : `${key}.${ext}`;

  if (isR2()) {
    const cmd = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: finalKey,
      Body: data,
      ContentType: mime,
      // 让浏览器和 CDN 长缓存（生成图本就是不变的）
      CacheControl: "public, max-age=31536000, immutable",
    });
    await getR2().send(cmd);
    const base = publicBase();
    if (base) {
      return `${base}/${finalKey}`;
    }
    // fallback: just return the key, callers must resolve themselves
    return `/${finalKey}`;
  }

  // local fs (dev)
  const fullPath = path.join(process.cwd(), "public", finalKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, data);
  return `/${finalKey.replace(/\\/g, "/")}`;
}

/**
 * 兼容老路径：把"裸 key"（不带 generated/ 前缀）自动放进 generated/ 下。
 * 旧代码大量调用 putObject("<jobId>/0", data) 期望落到 /generated/<jobId>/0.jpg。
 */
export async function putGeneratedImage(
  relKey: string,
  data: Buffer,
  mime: string = "image/jpeg",
): Promise<string> {
  return putObject(`${SUBDIR_GENERATED}/${relKey}`, data, mime);
}

export async function putUploadedAsset(
  relKey: string,
  data: Buffer,
  mime: string,
): Promise<string> {
  return putObject(`${SUBDIR_UPLOADS}/${relKey}`, data, mime);
}

export async function putSuggestThumb(
  relKey: string,
  data: Buffer,
  mime: string = "image/jpeg",
): Promise<string> {
  return putObject(`${SUBDIR_SUGGEST}/${relKey}`, data, mime);
}

export async function deleteObject(urlOrKey: string): Promise<void> {
  // 把 URL 还原成 key
  let key = urlOrKey;
  const base = publicBase();
  if (base && key.startsWith(base + "/")) {
    key = key.slice(base.length + 1);
  } else if (key.startsWith("/")) {
    key = key.slice(1);
  }

  if (isR2()) {
    try {
      await getR2().send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET!,
          Key: key,
        }),
      );
    } catch {
      // 不存在就算了
    }
    return;
  }

  const fullPath = path.join(process.cwd(), "public", key);
  try {
    await fs.unlink(fullPath);
  } catch {
    /* gone */
  }
}

/**
 * 读对象成 Buffer。给 nano banana provider 把"我们刚上传的图"作参考图用。
 *
 * 接受：完整 R2 公开 URL / 本地相对路径 (/uploads/abc.jpg) / 或 raw key。
 * 返回 { bytes, mime }。
 */
export async function getObjectBytes(
  urlOrKey: string,
): Promise<{ bytes: Buffer; mime: string }> {
  // 还原成 key
  let key = urlOrKey;
  const base = publicBase();
  if (base && key.startsWith(base + "/")) {
    key = key.slice(base.length + 1);
  } else if (key.startsWith("http://") || key.startsWith("https://")) {
    // 远程 URL 但不是我们的 R2 公开域名：直接 fetch
    const r = await fetch(key);
    if (!r.ok) {
      throw new Error(`fetch ${key} failed: ${r.status}`);
    }
    const ab = await r.arrayBuffer();
    return {
      bytes: Buffer.from(ab),
      mime: r.headers.get("content-type") || "image/jpeg",
    };
  } else if (key.startsWith("/")) {
    key = key.slice(1);
  }

  if (isR2()) {
    const obj = await getR2().send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
      }),
    );
    const stream = obj.Body as unknown as AsyncIterable<Uint8Array>;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      bytes: Buffer.concat(chunks),
      mime: obj.ContentType ?? "image/jpeg",
    };
  }

  // local fs
  const fullPath = path.join(process.cwd(), "public", key);
  const buf = await fs.readFile(fullPath);
  const ext = path.extname(fullPath).toLowerCase();
  const mime =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
  return { bytes: buf, mime };
}
