import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { privateStorageReady, privateWrite } from "@/lib/video/storage";
import { VIDEO_MAX_BYTES } from "@/lib/video/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/** Server-side Expert upload for users who do not need a browser signed-upload flow. */
export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  if (!privateStorageReady()) return apiJson({ error: "video_storage_unavailable" }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiJson({ error: "missing_file" }, { status: 400 });
  if (!VIDEO_TYPES.has(file.type)) return apiJson({ error: "unsupported_video_format" }, { status: 400 });
  if (file.size <= 0 || file.size > VIDEO_MAX_BYTES) return apiJson({ error: "video_file_too_large", max_bytes: VIDEO_MAX_BYTES }, { status: 400 });
  const ext = file.type === "video/webm" ? "webm" : file.type === "video/quicktime" ? "mov" : "mp4";
  const key = `videos/${auth.auth.user.id}/api/${randomUUID()}.${ext}`;
  await privateWrite(key, Buffer.from(await file.arrayBuffer()), file.type);
  const asset = await prisma.videoAsset.create({ data: { user_id: auth.auth.user.id, storage_key: key, mime: file.type, size_bytes: file.size, status: "ready" } });
  return apiJson({ id: asset.id, asset_id: asset.id, status: asset.status }, { status: 201 });
}
