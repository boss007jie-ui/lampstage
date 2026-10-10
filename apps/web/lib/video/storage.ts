import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { VIDEO_MAX_BYTES } from "./types";
import { s3ForcePathStyle, s3Region } from "../s3-config";

export function privateStorageReady(): boolean {
  return r2Enabled() || process.env.NODE_ENV !== "production" || Boolean(process.env.VIDEO_STORAGE_DIR);
}
function r2Enabled() {
  return Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.VIDEO_R2_BUCKET);
}
let client: S3Client | undefined;
function s3() {
  client ??= new S3Client({ region: s3Region("video"), endpoint: process.env.R2_ENDPOINT, forcePathStyle: s3ForcePathStyle("video"),
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  return client;
}
function bucket() { return process.env.VIDEO_R2_BUCKET!; }
export function validatePrivateKey(key: string): string {
  if (!/^videos\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(key) || key.split("/").some(p => p === "." || p === "..")) throw new Error("Invalid private media key");
  return key;
}
function localPath(key: string) {
  validatePrivateKey(key);
  const root = path.resolve(process.env.VIDEO_STORAGE_DIR || path.join(process.cwd(), ".video-private"));
  const result = path.resolve(root, key);
  if (!result.startsWith(root + path.sep)) throw new Error("Invalid private media path");
  return result;
}
export function usesDirectUpload() { return r2Enabled(); }
export async function privateUploadUrl(key: string, mime: string, size: number): Promise<string> {
  validatePrivateKey(key);
  if (!r2Enabled()) throw new Error("Direct upload storage unavailable");
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: mime, ContentLength: size, CacheControl: "private, no-store" }), { expiresIn: 900, signableHeaders: new Set(["content-length", "content-type"]) });
}
export async function privateMediaUrl(key: string, mime: string, downloadName?: string) {
  validatePrivateKey(key);
  if (!r2Enabled()) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentType: mime,
    ResponseCacheControl: "private, no-store", ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, "_")}"` : "inline" }), { expiresIn: 300 });
}
export async function privateHead(key: string): Promise<{ size: number; mime: string; etag?: string }> {
  validatePrivateKey(key);
  if (r2Enabled()) {
    const result = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: result.ContentLength || 0, mime: result.ContentType || "application/octet-stream", etag: result.ETag };
  }
  const stat = await fs.stat(localPath(key));
  return { size: stat.size, mime: key.endsWith(".webm") ? "video/webm" : key.endsWith(".mov") ? "video/quicktime" : key.endsWith(".png") ? "image/png" : key.endsWith(".jpg") ? "image/jpeg" : "video/mp4" };
}
/** Signed upload URLs remain reusable until expiry. Seal into an unissued key before marking ready. */
export async function sealPrivateUpload(key: string, sealedKey: string, etag?: string): Promise<void> {
  validatePrivateKey(key); validatePrivateKey(sealedKey);
  if (key === sealedKey) throw new Error("Sealed uploads require a new object key");
  if (r2Enabled()) {
    if (!etag) throw new Error("Upload version is unavailable");
    await s3().send(new CopyObjectCommand({ Bucket: bucket(), Key: sealedKey, CopySource: `${bucket()}/${key}`, CopySourceIfMatch: etag }));
  } else {
    await fs.mkdir(path.dirname(localPath(sealedKey)), { recursive: true });
    await fs.copyFile(localPath(key), localPath(sealedKey), 1);
  }
}
export async function privateDelete(key: string) {
  validatePrivateKey(key);
  if (r2Enabled()) await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  else await fs.unlink(localPath(key)).catch(() => undefined);
}
export async function privateWrite(key: string, bytes: Buffer, mime: string): Promise<void> {
  validatePrivateKey(key);
  if (r2Enabled()) await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: mime, CacheControl: "private, no-store" }));
  else {
    const target = localPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temp, bytes, { flag: "wx" }); await fs.rename(temp, target); }
    finally { await fs.unlink(temp).catch(() => undefined); }
  }
}
export async function privateRead(key: string): Promise<Buffer> {
  validatePrivateKey(key);
  if (!r2Enabled()) return fs.readFile(localPath(key));
  const obj = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!obj.Body) throw new Error("Media not found");
  return Buffer.from(await obj.Body.transformToByteArray());
}
export async function privateDownloadTo(key: string, target: string): Promise<void> {
  validatePrivateKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (!r2Enabled()) { await fs.copyFile(localPath(key), target); return; }
  const obj = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!obj.Body) throw new Error("Media not found");
  const handle = await fs.open(target, "w");
  try { await pipeline(obj.Body as Readable, handle.createWriteStream({ autoClose: false })); }
  finally { await handle.close(); }
}
export async function privateUploadFile(key: string, source: string, mime: string): Promise<void> {
  validatePrivateKey(key);
  if (!r2Enabled()) { await fs.mkdir(path.dirname(localPath(key)), { recursive: true }); await fs.copyFile(source, localPath(key)); return; }
  const stat = await fs.stat(source);
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: createReadStream(source), ContentLength: stat.size, ContentType: mime, CacheControl: "private, no-store" }));
}
/** Self-hosted/local only. Direct signed PUT is used in a serverless deployment. */
export async function acceptLocalUpload(key: string, body: ReadableStream<Uint8Array> | null, expectedBytes: number) {
  if (r2Enabled() || !privateStorageReady() || !body) throw new Error("Upload unavailable");
  const target = localPath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx");
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > VIDEO_MAX_BYTES || size > expectedBytes) { await reader.cancel(); throw new Error("Upload exceeds expected size"); }
      let offset = 0;
      while (offset < chunk.value.length) {
        const { bytesWritten } = await handle.write(chunk.value, offset, chunk.value.length - offset);
        if (!bytesWritten) throw new Error("Upload write failed");
        offset += bytesWritten;
      }
    }
    if (size !== expectedBytes) throw new Error("Upload size mismatch");
    await handle.close();
    await fs.rename(temp, target);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
    reader.releaseLock();
    await fs.unlink(temp).catch(() => undefined);
  }
}
/** Local ranged streaming avoids loading the complete video into the application response. */
export async function localMediaResponse(key: string, mime: string, range: string | null, downloadName?: string): Promise<Response> {
  const target = localPath(key);
  const { size } = await fs.stat(target);
  const headers = new Headers({ "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (downloadName) headers.set("Content-Disposition", `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`);
  let start = 0; let end = size - 1; let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    status = 206; headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  return new Response(Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream, { status, headers });
}
