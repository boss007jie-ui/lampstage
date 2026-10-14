import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readVideoJson, requireVideoUser, textField, videoRoute, VideoHttpError } from "@/lib/video/http";
import { VIDEO_JOB_LIMIT } from "@/lib/video/types";
import { viewVideoJob } from "@/lib/video/projects";
import { parseVideoReferenceInput, VideoReferenceInputError } from "@/lib/video/reference-inputs";
export const dynamic = "force-dynamic";
export async function GET() { return videoRoute(async () => {
  const user = await requireVideoUser();
  const jobs = await prisma.videoJob.findMany({ where: { user_id: user.id }, orderBy: { created_at: "desc" }, take: 20, select: { id: true } });
  return NextResponse.json({ projects: await Promise.all(jobs.map(job => viewVideoJob(job.id, user.id))) }, { headers: { "Cache-Control": "no-store" } });
}); }
export async function POST(request: NextRequest) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const body = await readVideoJson(request);
  const sourceId = textField(body.source_asset_id, 100);
  const productId = textField(body.product_asset_id, 100);
  if (!sourceId || !productId || typeof body.preserve_audio !== "boolean") throw new VideoHttpError(400, "请上传参考视频和商品图，并选择音轨。");
  let data;
  try { data = parseVideoReferenceInput(body, productId); }
  catch (error) { if (error instanceof VideoReferenceInputError) throw new VideoHttpError(400, error.message); throw error; }
  const [source, product, activeCount, references] = await Promise.all([
    prisma.videoAsset.findFirst({ where: { id: sourceId, user_id: user.id, status: "ready" } }),
    prisma.uploadedAsset.findFirst({ where: { id: productId, user_id: user.id } }),
    prisma.videoJob.count({ where: { user_id: user.id, status: { notIn: ["completed", "failed"] } } }),
    data.referenceImages ? prisma.uploadedAsset.findMany({ where: { id: { in: data.referenceImages.map(r => r.assetId) }, user_id: user.id }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (!source || !product || !product.width || !product.height) throw new VideoHttpError(400, "素材不存在、无效或不属于当前账号。");
  if (data.referenceImages?.some(ref => !references.some(asset => asset.id === ref.assetId))) throw new VideoHttpError(400, "参考图不存在或不属于当前账号。");
  if (activeCount >= VIDEO_JOB_LIMIT) throw new VideoHttpError(429, "同时进行的项目已达内测限制。");
  const job = await prisma.videoJob.create({ data: { user_id: user.id, source_asset_id: sourceId, product_asset_id: productId,
    title: textField(body.title, 80, "商品视频") || "商品视频", instructions: textField(body.instructions, 2000),
    preserve_audio: body.preserve_audio, stage: data.generationMode === "direct_references" ? "等待检查参考图与原视频动作" : "等待准备参考图", data: data as object } });
  return NextResponse.json({ project: await viewVideoJob(job.id, user.id) }, { status: 201 });
}); }
