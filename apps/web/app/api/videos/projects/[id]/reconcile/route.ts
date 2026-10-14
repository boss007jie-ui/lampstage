import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireVideoUser, requireVideoWorker, videoRoute, VideoHttpError } from "@/lib/video/http";
import { ownedVideoJob, viewVideoJob } from "@/lib/video/projects";
import { videoData } from "@/lib/video/types";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const job = await ownedVideoJob(params.id, user.id);
  if (job.status !== "attention") throw new VideoHttpError(409, "当前项目无需核查。");
  const data = videoData(job.data);
  if (!data.segments.some(s => s.submissionIntentAt || s.buildId)) throw new VideoHttpError(409, "没有视频提交记录，请由管理员检查参考图任务。");
  // Recovery only queries existing video receipts; it never invokes image generation.
  await requireVideoWorker(true, false);
  const update = await prisma.videoJob.updateMany({ where: { id: job.id, status: "attention", revision: job.revision, user_id: user.id },
    data: { status: "queued", phase: "reconcile", stage: "等待核查原任务，不重复提交", error: null, lease_owner: null, lease_until: null, revision: { increment: 1 } } });
  if (update.count !== 1) throw new VideoHttpError(409, "项目状态已更新。");
  return NextResponse.json({ project: await viewVideoJob(job.id, user.id) }, { status: 202 });
}); }
