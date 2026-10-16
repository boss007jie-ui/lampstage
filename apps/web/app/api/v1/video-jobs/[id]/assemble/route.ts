import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { videoData } from "@/lib/video/types";
import { checkReviewToken } from "@/lib/video/consent";
import { candidateReviewToken } from "@/lib/video/candidate-review";
import { workerState } from "@/lib/video/http";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.auth.user.id } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  const data = videoData(job.data);
  if (data.generationMode !== "six_references") return apiJson({ error: "six_reference_job_required" }, { status: 409 });
  if (job.phase === "assemble" && ["queued", "assembling", "completed"].includes(job.status)) return apiJson({ id: job.id, status: job.status });
  if (job.status !== "review" || job.lease_owner || !data.segments.length || !data.segments.every(s => s.accepted && s.candidateKey && s.candidateSha256)) return apiJson({ error: "all_candidates_must_be_accepted" }, { status: 409 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  const checked = checkReviewToken(body?.candidate_review_token, candidateReviewToken(job.id, data));
  if (!checked.ok) return apiJson({ error: checked.reason }, { status: checked.status });
  if (!await workerState()) return apiJson({ error: "video_worker_unavailable" }, { status: 503 });
  const updated = await prisma.videoJob.updateMany({ where: { id: job.id, user_id: auth.auth.user.id, status: "review", revision: job.revision, lease_owner: null },
    data: { status: "queued", phase: "assemble", stage: "等待合成已审阅片段", error: null, revision: { increment: 1 } } });
  if (updated.count !== 1) return apiJson({ error: "job_state_changed" }, { status: 409 });
  return apiJson({ id: job.id, status: "queued", phase: "assemble" }, { status: 202 });
}
