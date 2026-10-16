import { ImageContentError, MAX_IMAGE_BYTES } from "./image-content";
export const MAX_IMAGE_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
/** Bound actual request bytes before the platform multipart parser can allocate arbitrary input. */
export async function readImageUploadForm(request: Request): Promise<FormData> {
  if (Number(request.headers.get("content-length")) > MAX_IMAGE_MULTIPART_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    throw new ImageContentError("file_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ImageContentError("invalid_multipart");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_IMAGE_MULTIPART_BYTES) { await reader.cancel(); throw new ImageContentError("file_too_large", 413); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(chunks) }).formData();
  } catch { throw new ImageContentError("invalid_multipart"); }
}
