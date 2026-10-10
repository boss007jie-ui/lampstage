import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { putUploadedAsset } from "@/lib/storage";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiJson({ error: "missing_file" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return apiJson({ error: "unsupported_format" }, { status: 400 });
  if (file.size > MAX_BYTES) return apiJson({ error: "file_too_large", max_bytes: MAX_BYTES }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  let width = 0; let height = 0;
  try {
    const sharpMod = await import("sharp");
    const meta = await sharpMod.default(bytes).metadata();
    width = meta.width ?? 0; height = meta.height ?? 0;
  } catch { /* metadata is optional; provider can still inspect the source */ }
  const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
  const asset = await prisma.uploadedAsset.create({ data: {
    user_id: auth.auth.user.id,
    image_url: await putUploadedAsset(`${auth.auth.user.id}/${randomUUID()}.${ext}`, bytes, file.type),
    file_type: ext, width, height,
    background_type: "unknown",
  } });
  return apiJson({ id: asset.id, asset_id: asset.id, image_url: asset.image_url, width, height }, { status: 201 });
}
