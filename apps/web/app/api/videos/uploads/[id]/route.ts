import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { acceptLocalUpload, usesDirectUpload } from "@/lib/video/storage";
import { requireVideoUser, videoRoute, VideoHttpError } from "@/lib/video/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  if (usesDirectUpload()) throw new VideoHttpError(400, "请使用签名上传地址。");
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, user_id: user.id, status: "pending", created_at: { gt: new Date(Date.now() - 900000) } } });
  if (!asset) throw new VideoHttpError(404, "上传凭证无效或已过期。");
  const claimed = await prisma.videoAsset.updateMany({ where: { id: asset.id, status: "pending" }, data: { status: "uploading" } });
  if (claimed.count !== 1) throw new VideoHttpError(409, "该视频已在上传，请勿重复提交。");
  try {
    await acceptLocalUpload(asset.storage_key, request.body, asset.size_bytes);
    await prisma.videoAsset.update({ where: { id: asset.id }, data: { status: "uploaded" } });
  } catch {
    await prisma.videoAsset.update({ where: { id: asset.id }, data: { status: "invalid" } });
    throw new VideoHttpError(400, "上传失败或文件大小不一致，请重新选择视频。");
  }
  return NextResponse.json({ uploaded: true });
}); }
