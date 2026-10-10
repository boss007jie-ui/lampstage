import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { privateDelete, privateHead, sealPrivateUpload } from "@/lib/video/storage";
import { requireVideoUser, videoRoute, VideoHttpError } from "@/lib/video/http";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const asset = await prisma.videoAsset.findFirst({ where: { id: params.id, user_id: user.id } });
  if (!asset) throw new VideoHttpError(404, "上传不存在。");
  if (asset.status === "ready") return NextResponse.json({ asset_id: asset.id });
  if (!["pending", "uploaded"].includes(asset.status) || Date.now() - asset.created_at.getTime() > 900000) throw new VideoHttpError(400, "上传已失效，请重新上传。");
  let head;
  try { head = await privateHead(asset.storage_key); } catch { throw new VideoHttpError(400, "尚未收到视频文件，请完成上传后再试。"); }
  if (head.size !== asset.size_bytes || head.mime !== asset.mime) {
    await prisma.videoAsset.update({ where: { id: asset.id }, data: { status: "invalid" } });
    await privateDelete(asset.storage_key);
    throw new VideoHttpError(400, "视频大小或格式与上传声明不一致。");
  }
  const extension = asset.mime === "video/webm" ? "webm" : asset.mime === "video/quicktime" ? "mov" : "mp4";
  const sealedKey = `videos/${user.id}/source/${randomUUID()}.${extension}`;
  await sealPrivateUpload(asset.storage_key, sealedKey, head.etag);
  const sealed = await privateHead(sealedKey);
  if (sealed.size !== asset.size_bytes || sealed.mime !== asset.mime) {
    await privateDelete(sealedKey);
    throw new VideoHttpError(400, "上传内容已变化，请重新上传。");
  }
  const update = await prisma.videoAsset.updateMany({ where: { id: asset.id, storage_key: asset.storage_key, status: { in: ["pending", "uploaded"] } }, data: { status: "ready", storage_key: sealedKey } });
  if (update.count !== 1) {
    await privateDelete(sealedKey);
    const current = await prisma.videoAsset.findFirst({ where: { id: asset.id, user_id: user.id, status: "ready" } });
    if (!current) throw new VideoHttpError(409, "上传状态已变化，请重新上传。");
  }
  else await privateDelete(asset.storage_key).catch(() => undefined);
  return NextResponse.json({ asset_id: asset.id });
}); }
