import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { isProviderMigrationError, publicGenerationFailure } from "@/lib/provider-errors";
import { recordedImageModel } from "@/lib/image-models";
import { privateMediaUrl } from "@/lib/video/storage";
import { isVideoPreparation, segmentCoinQuote, videoData } from "@/lib/video/types";
import { generationMode, preparedReferencesReady } from "@/lib/video/reference-inputs";
import { reviewToken } from "@/lib/video/review-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const imageJob = await prisma.generationJob.findFirst({
    where: { id: params.id, user_id: auth.auth.user.id },
    include: { outputs: { orderBy: { created_at: "asc" } } },
  });
  if (imageJob) return apiJson({
    id: imageJob.id, type: "image", status: imageJob.status,
    stage: imageJob.stage_hint,
    error: publicGenerationFailure(imageJob.failure_reason),
    error_code: isProviderMigrationError(imageJob.failure_reason) ? "provider_migration_required" : null,
    image_model: recordedImageModel(imageJob.metadata),
    outputs: imageJob.outputs.map((output) => ({ id: output.id, url: output.image_url, thumbnail_url: output.thumbnail_url, is_downloaded: output.is_downloaded })),
    created_at: imageJob.created_at.toISOString(), updated_at: imageJob.updated_at.toISOString(),
  });

  const videoJob = await prisma.videoJob.findFirst({
    where: { id: params.id, user_id: auth.auth.user.id },
    include: { source_asset: true },
  });
  if (!videoJob) return apiJson({ error: "not_found" }, { status: 404 });
  const data = videoData(videoJob.data);
  const mode = generationMode(data);
  const quote = segmentCoinQuote();
  const references = await Promise.all((data.referenceImages ?? []).map(async (ref, i) => ({
    picture: i + 1, asset_id: ref.assetId, role: ref.role, label: ref.label,
    url: ref.key ? await privateMediaUrl(ref.key, "image/png") : null, sha256: ref.sha256 ?? null,
  })));
  const outputUrl = data.outputKey ? await privateMediaUrl(data.outputKey, "video/mp4", `${videoJob.id}.mp4`) : null;
  const segments = await Promise.all(data.segments.map(async (segment) => ({
    index: segment.index,
    start: segment.start,
    duration: segment.duration,
    trim_start: segment.trimStart,
    keep_duration: Math.min(segment.duration - segment.trimStart, (data.sourceDuration ?? 0) - segment.start - segment.trimStart),
    source_url: segment.clipKey ? await privateMediaUrl(segment.clipKey, "video/mp4") : null,
    opening_url: segment.openingKey ? await privateMediaUrl(segment.openingKey, "image/png") : null,
    ending_url: segment.endingKey ? await privateMediaUrl(segment.endingKey, "image/png") : null,
    candidate_url: segment.candidateKey ? await privateMediaUrl(segment.candidateKey, "video/mp4", `${videoJob.id}-${segment.index}.mp4`) : null,
  })));
  return apiJson({
    id: videoJob.id, type: "video", status: videoJob.status, stage: videoJob.stage,
    generation_mode: mode, reference_assets: references, source_duration: data.sourceDuration ?? null,
    references_ready: mode === "direct_references" ? preparedReferencesReady(data) : data.segments.length > 0 && data.segments.every(s => s.openingKey && s.endingKey && s.clipKey),
    phase: isVideoPreparation(videoJob.phase) ? "prepare" : videoJob.phase, error: videoJob.error, output_url: outputUrl, segments,
    estimate: { segments: data.segments.length, image_calls: data.imageCalls, video_coins: quote === null ? null : data.segments.length ? quote * data.segments.filter(s => !s.candidateKey).length : null },
    pricing_basis: quote === null ? "unpriced_technical_cap" : "configured_quote",
    // 渲染前必须回传该标识；它绑定参考快照、动作窗口、待生成片段与展示报价。
    review_token: videoJob.status === "review" ? reviewToken({ jobId: videoJob.id, data, quote }) : null,
    created_at: videoJob.created_at.toISOString(), updated_at: videoJob.updated_at.toISOString(),
  });
}
