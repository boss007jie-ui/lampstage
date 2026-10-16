import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readVideoJson, requireVideoUser, requireVideoWorker, videoRoute, VideoHttpError } from "@/lib/video/http";
import { ownedVideoJob, viewVideoJob } from "@/lib/video/projects";
import { isVideoPreparation, segmentCoinQuote, videoData } from "@/lib/video/types";
import { checkReviewToken, validateRenderConsent } from "@/lib/video/consent";
import { reviewToken } from "@/lib/video/review-token";
import { generationMode } from "@/lib/video/reference-inputs";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const job = await ownedVideoJob(params.id, user.id);
  // A repeated HTTP request returns the existing attempt, not a new paid build.
  if (["queued", "generating", "assembling", "completed"].includes(job.status) && !isVideoPreparation(job.phase)) return NextResponse.json({ project: await viewVideoJob(job.id, user.id) });
  if (job.status !== "review") throw new VideoHttpError(409, "请先完成关键参考图确认。");
  const input = await readVideoJson(request);
  if (input.confirm_references !== true || input.accept_estimate !== true) throw new VideoHttpError(400, "请确认参考图并接受本次费用预估。");
  const data = videoData(job.data);
  // 旧入口同样必须回传审阅标识：不能让"网页/旧路径"绕过展示与提交之间的版本绑定。
  const review = checkReviewToken(input.review_token, reviewToken({ jobId: job.id, data, quote: segmentCoinQuote(generationMode(data)) }));
  if (!review.ok) throw new VideoHttpError(review.status, review.reason);
  const consent = validateRenderConsent(data, input.max_coins, segmentCoinQuote(generationMode(data)));
  if (!consent.ok) throw new VideoHttpError(400, consent.reason);
  await requireVideoWorker(true, generationMode(data) === "legacy_frames", generationMode(data));
  data.renderConsent = { at: new Date().toISOString(), maxCoins: consent.maxCoins, estimatedCoins: consent.estimate, perSegmentCoins: consent.quote,
    pricingBasis: consent.pricingBasis, segmentIndices: consent.segmentIndices,
    ...(consent.referenceDigest ? { referenceDigest: consent.referenceDigest } : {}) };
  const update = await prisma.videoJob.updateMany({ where: { id: job.id, user_id: user.id, status: "review", revision: job.revision },
    data: { status: "queued", phase: "render", stage: "等待生成商品视频", data: data as object, error: null, revision: { increment: 1 } } });
  if (update.count !== 1) throw new VideoHttpError(409, "项目已提交，请刷新后查看。");
  return NextResponse.json({ project: await viewVideoJob(job.id, user.id) }, { status: 202 });
}); }
