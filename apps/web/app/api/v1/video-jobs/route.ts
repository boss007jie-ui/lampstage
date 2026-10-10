import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { emptyVideoData, VIDEO_JOB_LIMIT } from "@/lib/video/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  const sourceId = typeof body.source_asset_id === "string" ? body.source_asset_id : "";
  const productId = typeof body.product_asset_id === "string" ? body.product_asset_id : "";
  if (!sourceId || !productId) return apiJson({ error: "missing_asset_id" }, { status: 400 });
  const [source, product, activeCount] = await Promise.all([
    prisma.videoAsset.findFirst({ where: { id: sourceId, user_id: auth.auth.user.id, status: { in: ["ready", "uploaded"] } } }),
    prisma.uploadedAsset.findFirst({ where: { id: productId, user_id: auth.auth.user.id } }),
    prisma.videoJob.count({ where: { user_id: auth.auth.user.id, status: { notIn: ["completed", "failed"] } } }),
  ]);
  if (!source || !product) return apiJson({ error: "asset_not_found" }, { status: 404 });
  if (activeCount >= VIDEO_JOB_LIMIT) return apiJson({ error: "video_job_limit_reached" }, { status: 429 });
  const job = await prisma.videoJob.create({ data: {
    user_id: auth.auth.user.id, source_asset_id: sourceId, product_asset_id: productId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "商品视频",
    instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "",
    preserve_audio: typeof body.preserve_audio === "boolean" ? body.preserve_audio : true,
    data: emptyVideoData() as object,
  } });
  return apiJson({ id: job.id, job_id: job.id, type: "video", status: job.status }, { status: 201 });
}
