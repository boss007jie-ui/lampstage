import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { videoData } from "@/lib/video/types";
import { workerState } from "@/lib/video/http";
export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.auth.user.id } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  if (job.phase === "reconcile" && ["queued", "generating"].includes(job.status)) return apiJson({ id: job.id, status: job.status });
  if (job.status !== "attention" || !videoData(job.data).segments.some(s => s.buildId || s.submissionIntentAt)) return apiJson({ error: "no_existing_submission_to_reconcile" }, { status: 409 });
  if (job.lease_until && job.lease_until > new Date()) return apiJson({ error: "job_still_active" }, { status: 409 });
  if (!await workerState()) return apiJson({ error: "video_worker_unavailable" }, { status: 503 });
  const update = await prisma.videoJob.updateMany({ where: { id: job.id, user_id: auth.auth.user.id, status: "attention", revision: job.revision },
    data: { status: "queued", phase: "reconcile", stage: "等待核查原任务，不发起新生成", error: null, lease_owner: null, lease_until: null, revision: { increment: 1 } } });
  if (update.count !== 1) return apiJson({ error: "job_state_changed" }, { status: 409 });
  return apiJson({ id: job.id, status: "queued", phase: "reconcile" }, { status: 202 });
}
