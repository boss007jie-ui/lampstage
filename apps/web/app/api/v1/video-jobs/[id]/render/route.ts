import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { requireVideoWorker } from "@/lib/video/http";
import { ownedVideoJob } from "@/lib/video/projects";
import { segmentCoinQuote, videoData } from "@/lib/video/types";
import { validateRenderConsent } from "@/lib/video/consent";

export const runtime = "nodejs";

/** Submit the reviewed reference frames to the Hypit/RunningHub H3 worker. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const job = await ownedVideoJob(params.id, auth.auth.user.id).catch(() => null);
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  if (["queued", "generating", "assembling", "completed"].includes(job.status) && job.phase !== "prepare") {
    return apiJson({ id: job.id, job_id: job.id, status: job.status }, { status: 200 });
  }
  if (job.status !== "review") return apiJson({ error: "references_not_ready", status: job.status }, { status: 409 });
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  if (body.confirm_references !== true || body.accept_estimate !== true) return apiJson({ error: "confirmation_required" }, { status: 400 });
  const data = videoData(job.data);
  const maxCoins = typeof body.max_coins === "number" ? body.max_coins : undefined;
  const consent = validateRenderConsent(data, maxCoins, segmentCoinQuote());
  if (!consent.ok) return apiJson({ error: "invalid_render_consent", message: consent.reason }, { status: 400 });
  try {
    await requireVideoWorker(true);
  } catch (error) {
    return apiJson({ error: "hypit_worker_unavailable", message: error instanceof Error ? error.message : "Hypit 视频处理服务尚未启动。" }, { status: 503 });
  }
  data.renderConsent = { at: new Date().toISOString(), maxCoins: consent.maxCoins, estimatedCoins: consent.estimate, perSegmentCoins: consent.quote, segmentIndices: consent.segmentIndices };
  const claimed = await prisma.videoJob.updateMany({
    where: { id: job.id, user_id: auth.auth.user.id, status: "review", revision: job.revision },
    data: { status: "queued", phase: "render", stage: "等待 Hypit / RunningHub Minimax H3 生成", data: data as object, error: null, revision: { increment: 1 } },
  });
  if (claimed.count !== 1) return apiJson({ error: "job_state_changed" }, { status: 409 });
  return apiJson({ id: job.id, job_id: job.id, status: "queued", phase: "render", estimated_coins: consent.estimate }, { status: 202 });
}
