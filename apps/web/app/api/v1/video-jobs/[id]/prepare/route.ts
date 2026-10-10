import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { requireVideoWorker } from "@/lib/video/http";

export const runtime = "nodejs";

/** Queue reference-video analysis and image-reference generation for the Expert. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.auth.user.id } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  if (job.status !== "draft") return apiJson({ id: job.id, job_id: job.id, status: job.status }, { status: 200 });
  try {
    await requireVideoWorker();
  } catch (error) {
    return apiJson({ error: "video_worker_unavailable", message: error instanceof Error ? error.message : "视频处理服务尚未启动。" }, { status: 503 });
  }
  const claimed = await prisma.videoJob.updateMany({
    where: { id: job.id, user_id: auth.auth.user.id, status: "draft", revision: job.revision },
    data: { status: "queued", phase: "prepare", stage: "等待拆解参考视频并生成参考帧", error: null, revision: { increment: 1 } },
  });
  if (claimed.count !== 1) return apiJson({ error: "job_state_changed" }, { status: 409 });
  return apiJson({ id: job.id, job_id: job.id, status: "queued", phase: "prepare" }, { status: 202 });
}
