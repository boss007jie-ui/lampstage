import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getObjectBytes } from "@/lib/storage";
import type { GenInput } from "./types";
import type { ImageReference } from "./image-requests";

async function readReference(url: string): Promise<ImageReference> {
  // These are bundled public assets even when uploaded customer media uses R2.
  if (/^\/(?:scene-refs(?:-v2)?|templates|scene-examples)\//.test(url)) {
    const root = path.resolve(process.cwd(), "public");
    const file = path.resolve(root, `.${url}`);
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid static reference path.");
    return { bytes: await readFile(file), mime: "image/png" };
  }
  return getObjectBytes(url);
}

/** Keep the full product reference, rather than shrinking its identifying details to 256 px. */
export async function readImageReferences(input: GenInput, maxReferences: number): Promise<ImageReference[]> {
  const hasComposition = Boolean(input.compositionReferenceData || input.compositionReferenceUrl);
  if (hasComposition && maxReferences < 2) throw new Error("This image model accepts only the product reference.");
  const product = input.referenceImageData ?? await readReference(input.referenceImageUrl);
  const references = hasComposition
    ? [input.compositionReferenceData ?? await readReference(input.compositionReferenceUrl!), product]
    : [product];
  const prepared = [];
  for (const reference of references) {
    const bytes = await sharp(reference.bytes).rotate()
      .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
      .png().toBuffer();
    prepared.push({ bytes, mime: "image/png" });
  }
  return prepared;
}

/** Decode downloaded bytes before a request can count as a successful generation. */
export async function resolveImageBytes(image: { b64: string } | { url: string }): Promise<ImageReference> {
  let bytes: Buffer;
  if ("b64" in image) bytes = Buffer.from(image.b64, "base64");
  else if (image.url.startsWith("data:")) {
    const matched = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image.url);
    if (!matched) throw new Error("Invalid image data.");
    bytes = Buffer.from(matched[1], "base64");
  } else {
    const remote = new URL(image.url);
    if (remote.protocol !== "https:" || remote.username || remote.password) throw new Error("Invalid image download address.");
    const response = await fetch(remote, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error("Invalid image size.");
  // Full decode catches truncated files that metadata alone might accept.
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).stats();
  if (!metadata.channels.length) throw new Error("Invalid image bytes.");
  const info = await sharp(bytes).metadata();
  const mime = info.format === "jpeg" ? "image/jpeg" : info.format === "png" ? "image/png" : info.format === "webp" ? "image/webp" : null;
  if (!mime || !info.width || !info.height) throw new Error("Invalid image bytes.");
  return { bytes, mime };
}
