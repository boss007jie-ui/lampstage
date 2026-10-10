import { prisma } from "@/lib/db";
import { jobView } from "./repository";
import { VideoHttpError } from "./http";

export async function ownedVideoJob(id: string, userId: string) {
  const job = await prisma.videoJob.findFirst({ where: { id, user_id: userId }, include: { source_asset: true } });
  if (!job) throw new VideoHttpError(404, "视频项目不存在。");
  return job;
}
export async function viewVideoJob(id: string, userId: string) {
  const job = await ownedVideoJob(id, userId);
  return jobView(job);
}
