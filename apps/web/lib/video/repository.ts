import { Prisma, type VideoAsset, type VideoJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import { segmentCoinQuote, videoData, type VideoJobData, type VideoJobView, type VideoStatus } from "./types";

export const LEASE_MS = 90_000;
type RepositoryDb = Pick<typeof prisma, "videoJob">;
export class LeaseLostError extends Error { constructor() { super("任务租约已失效"); } }

export function jobView(job: VideoJob & { source_asset?: VideoAsset }): VideoJobView {
  const data = videoData(job.data);
  const media = (kind: string, segment?: number) => `/api/videos/projects/${encodeURIComponent(job.id)}/media?kind=${kind}${segment === undefined ? "" : `&segment=${segment}`}`;
  const quote = segmentCoinQuote();
  return {
    id: job.id, title: job.title, status: job.status as VideoStatus, stage: job.stage,
    instructions: job.instructions, preserve_audio: job.preserve_audio,
    source_url: media("source"), product_url: media("product"), source_duration: data.sourceDuration ?? null,
    error: job.error, created_at: job.created_at.toISOString(), updated_at: job.updated_at.toISOString(),
    // 业务进展与数据库 updated_at 分开：后者会被 20 秒一次的租约心跳刷新，不能当业务推进的证据。
    progress_updated_at: data.progress?.lastProgressAt ?? null,
    stage_code: data.progress?.stageCode ?? null,
    segments: data.segments.map(s => ({ index: s.index, start: s.start, duration: s.duration,
      opening_url: s.openingKey ? media("opening", s.index) : null,
      ending_url: s.endingKey ? media("ending", s.index) : null,
      candidate_url: s.candidateKey ? media("candidate", s.index) : null })),
    output_url: data.outputKey ? media("output") : null,
    download_url: data.outputKey ? `${media("output")}&download=1` : null,
    estimate: { segments: data.segments.length, image_calls: data.imageCalls, video_coins: quote === null ? null : quote * data.segments.filter(s => !s.candidateKey).length },
  };
}

/** An expired claim is never placed back on the paid queue automatically. */
export async function claimJob(workerId: string, db: RepositoryDb = prisma): Promise<VideoJob | null> {
  const now = new Date();
  await db.videoJob.updateMany({
    where: { status: { in: ["preparing", "generating", "assembling"] }, lease_until: { lt: now } },
    data: { status: "attention", stage: "处理已中断，请核对已提交的任务", error: "工作进程租约过期；不会自动重复生成。", lease_owner: null, lease_until: null, revision: { increment: 1 } },
  });
  const candidates = await db.videoJob.findMany({ where: { status: "queued", lease_owner: null }, orderBy: { created_at: "asc" }, take: 10 });
  for (const candidate of candidates) {
    const claimed = await db.videoJob.updateMany({
      where: { id: candidate.id, status: "queued", revision: candidate.revision, lease_owner: null },
      data: { status: candidate.phase === "prepare" ? "preparing" : "generating", lease_owner: workerId,
        lease_until: new Date(Date.now() + LEASE_MS), revision: { increment: 1 }, error: null },
    });
    if (claimed.count === 1) return db.videoJob.findFirst({ where: { id: candidate.id, lease_owner: workerId } });
  }
  return null;
}

type JobPatch = { expectedRevision: number; status?: string; phase?: string; stage?: string; error?: string | null };
export async function patchJob(jobId: string, owner: string, patch: JobPatch, data?: VideoJobData, db: RepositoryDb = prisma): Promise<VideoJob> {
  const { expectedRevision, ...fields } = patch;
  const result = await db.videoJob.updateMany({
    where: { id: jobId, lease_owner: owner, lease_until: { gt: new Date() }, revision: expectedRevision },
    data: { ...fields, ...(data ? { data: data as unknown as Prisma.InputJsonValue } : {}), revision: { increment: 1 } },
  });
  if (result.count !== 1) throw new LeaseLostError();
  const refreshed = await db.videoJob.findFirst({ where: { id: jobId, lease_owner: owner, revision: expectedRevision + 1 } });
  if (!refreshed) throw new LeaseLostError();
  return refreshed;
}

export async function heartbeatLease(jobId: string, owner: string, db: RepositoryDb = prisma): Promise<void> {
  const result = await db.videoJob.updateMany({
    where: { id: jobId, lease_owner: owner, lease_until: { gt: new Date() } },
    data: { lease_until: new Date(Date.now() + LEASE_MS) },
  });
  if (result.count !== 1) throw new LeaseLostError();
}

export async function releaseJob(jobId: string, owner: string): Promise<void> {
  await prisma.videoJob.updateMany({ where: { id: jobId, lease_owner: owner }, data: { lease_owner: null, lease_until: null } });
}
