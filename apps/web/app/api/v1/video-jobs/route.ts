import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { VIDEO_JOB_LIMIT, type VideoJobData } from "@/lib/video/types";
import { parseVideoReferenceInput, VideoReferenceInputError } from "@/lib/video/reference-inputs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiJson({ error: "invalid_json" }, { status: 400 });
  const sourceId = typeof body.source_asset_id === "string" ? body.source_asset_id : "";
  const productId = typeof body.product_asset_id === "string" ? body.product_asset_id : "";
  if (!sourceId || !productId) return apiJson({ error: "missing_asset_id" }, { status: 400 });
  let data: VideoJobData;
  try { data = parseVideoReferenceInput(body, productId); }
  catch (error) {
    if (error instanceof VideoReferenceInputError) return apiJson({ error: "invalid_video_references", message: error.message }, { status: 400 });
    throw error;
  }
  const [source, product, activeCount, references] = await Promise.all([
    prisma.videoAsset.findFirst({ where: { id: sourceId, user_id: auth.auth.user.id, status: { in: ["ready", "uploaded"] } } }),
    prisma.uploadedAsset.findFirst({ where: { id: productId, user_id: auth.auth.user.id } }),
    prisma.videoJob.count({ where: { user_id: auth.auth.user.id, status: { notIn: ["completed", "failed"] } } }),
    data.referenceImages ? prisma.uploadedAsset.findMany({ where: { id: { in: data.referenceImages.map(r => r.assetId) }, user_id: auth.auth.user.id }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (!source || !product || (data.referenceImages && data.referenceImages.some(r => !references.some(asset => asset.id === r.assetId)))) return apiJson({ error: "asset_not_found" }, { status: 404 });
  if (activeCount >= VIDEO_JOB_LIMIT) return apiJson({ error: "video_job_limit_reached" }, { status: 429 });
  const job = await prisma.videoJob.create({ data: {
    user_id: auth.auth.user.id, source_asset_id: sourceId, product_asset_id: productId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "商品视频",
    instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "",
    preserve_audio: typeof body.preserve_audio === "boolean" ? body.preserve_audio : true,
    stage: data.generationMode === "direct_references" ? "等待检查参考图与原视频动作" : "等待准备参考图",
    data: data as object,
  } });
  return apiJson({ id: job.id, job_id: job.id, type: "video", status: job.status, generation_mode: data.generationMode,
    reference_assets: (data.referenceImages ?? []).map((ref, i) => ({ picture: i + 1, asset_id: ref.assetId, role: ref.role, label: ref.label, url: null, sha256: null })),
    references_ready: false, source_duration: null, next: "prepare_video_job" }, { status: 201 });
}
