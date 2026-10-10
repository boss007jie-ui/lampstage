import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireVideoUser, requireVideoWorker, videoRoute, VideoHttpError } from "@/lib/video/http";
import { ownedVideoJob, viewVideoJob } from "@/lib/video/projects";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const job = await ownedVideoJob(params.id, user.id);
  if (job.status !== "draft") return NextResponse.json({ project: await viewVideoJob(job.id, user.id) });
  await requireVideoWorker();
  const update = await prisma.videoJob.updateMany({ where: { id: job.id, user_id: user.id, status: "draft", revision: job.revision },
    data: { status: "queued", phase: "prepare", stage: "等待检查视频并准备参考图", error: null, revision: { increment: 1 } } });
  if (update.count !== 1) throw new VideoHttpError(409, "项目状态已更新，请刷新后查看。");
  return NextResponse.json({ project: await viewVideoJob(job.id, user.id) }, { status: 202 });
}); }
