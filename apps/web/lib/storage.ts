/**
 * 对象存储 adapter。
 *
 * MVP: 写到 apps/web/public/generated/<job_id>/<n>.<ext>
 *      生成的 URL 形如 /generated/<job_id>/<n>.<ext>，Next.js 的 public/ 自动 serve
 *
 * 部署到 Cloudflare Pages / Vercel 时切换到 R2 / S3：
 *   只需要再写一个 adapter，保持 putObject 同样签名即可
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const SUBDIR = "generated";

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * 把 Buffer 写到 public/generated/<key>。返回浏览器可访问的 URL。
 */
export async function putObject(
  key: string,
  data: Buffer,
  mime: string = "image/jpeg",
): Promise<string> {
  const filename = key.endsWith(`.${extFromMime(mime)}`)
    ? key
    : `${key}.${extFromMime(mime)}`;
  const fullPath = path.join(PUBLIC_ROOT, SUBDIR, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, data);
  return `/${SUBDIR}/${filename.replace(/\\/g, "/")}`;
}

/**
 * 删除一个对象。失败静默。
 */
export async function deleteObject(urlOrKey: string): Promise<void> {
  const rel = urlOrKey.startsWith(`/${SUBDIR}/`)
    ? urlOrKey.slice(`/${SUBDIR}/`.length)
    : urlOrKey;
  const fullPath = path.join(PUBLIC_ROOT, SUBDIR, rel);
  try {
    await fs.unlink(fullPath);
  } catch {
    // 不存在就算了
  }
}
