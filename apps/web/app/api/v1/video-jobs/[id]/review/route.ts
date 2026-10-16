import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { videoData } from "@/lib/video/types";
import { checkReviewToken } from "@/lib/video/consent";
import { applyCandidateReview, candidateReviewToken } from "@/lib/video/candidate-review";
import { CandidateReviewError, candidateReviewErrorBody } from "@/lib/video/candidate-review-error";
import { readySixSegments, SixReferencePlanError } from "@/lib/video/six-reference-plan";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.auth.user.id } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  const data = videoData(job.data);
  if (data.generationMode !== "six_references" || !["review", "attention"].includes(job.status) || job.lease_owner ||
    data.segments.some(s => !s.candidateKey && !s.terminalFailure && (s.submissionIntentAt || s.buildId))) return apiJson({ error: "candidate_review_unavailable" }, { status: 409 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiJson({ error: "invalid_json" }, { status: 400 });
  const checked = checkReviewToken(body.candidate_review_token, candidateReviewToken(job.id, data));
  if (!checked.ok) return apiJson({ error: checked.reason }, { status: checked.status });
  let next;
  try { next = applyCandidateReview(data, body.decisions); }
  catch (error) {
    if (error instanceof CandidateReviewError) return apiJson(candidateReviewErrorBody(error), { status: 400 });
    if (error instanceof SixReferencePlanError) return apiJson({ error: "invalid_candidate_review", message: error.message }, { status: 400 });
    throw error;
  }
  const updated = await prisma.videoJob.updateMany({ where: { id: job.id, user_id: auth.auth.user.id, revision: job.revision, status: job.status, lease_owner: null },
    data: { data: next as object, status: "review", stage: "片段审阅已保存，请核对下一轮动作或合成", error: null, revision: { increment: 1 } } });
  if (updated.count !== 1) return apiJson({ error: "job_state_changed" }, { status: 409 });
  return apiJson({ id: job.id, status: "review", ready_segment_indices: readySixSegments(next).map(s => s.index),
    all_accepted: next.segments.every(s => s.accepted), next: next.segments.every(s => s.accepted) ? "assemble_video_job" : "get_job" });
}
