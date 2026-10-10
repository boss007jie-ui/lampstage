import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { privateStorageReady, privateUploadUrl, usesDirectUpload } from "@/lib/video/storage";
import { readVideoJson, requireVideoUser, videoRoute, VideoHttpError } from "@/lib/video/http";
import { VIDEO_MAX_BYTES } from "@/lib/video/types";
export const runtime = "nodejs";
export async function POST(request: NextRequest) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  if (!privateStorageReady()) throw new VideoHttpError(503, "私有视频存储尚未配置。");
  const input = await readVideoJson(request);
  const mime = input.mime;
  if (typeof mime !== "string" || !["video/mp4", "video/webm", "video/quicktime"].includes(mime)) throw new VideoHttpError(400, "请选择 MP4、MOV 或 WebM 视频。");
  const size = input.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > VIDEO_MAX_BYTES) throw new VideoHttpError(400, "视频大小需在 150 MB 以内。");
  const recentCount = await prisma.videoAsset.count({ where: { user_id: user.id, created_at: { gt: new Date(Date.now() - 86400000) } } });
  if (recentCount >= 20) throw new VideoHttpError(429, "今天上传次数已达内测限制。");
  const extension = mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : "mp4";
  const key = `videos/${user.id}/pending/${randomUUID()}.${extension}`;
  const asset = await prisma.videoAsset.create({ data: { user_id: user.id, storage_key: key, mime, size_bytes: size } });
  const upload_url = usesDirectUpload() ? await privateUploadUrl(key, mime, size) : `/api/videos/uploads/${asset.id}`;
  return NextResponse.json({ asset_id: asset.id, upload_url, headers: { "Content-Type": mime } }, { status: 201 });
}); }
