import type { PrismaClient } from "@prisma/client";
import { refundCredits } from "../lib/credits";

/** Called before this local instance starts accepting requests. Never replays a provider call. */
export async function recoverInterruptedLocalImages(prisma: PrismaClient, onlyJobIds?: string[]) {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/lampstage_local") throw new Error("Local recovery refused a non-local database.");
  const interrupted = await prisma.generationJob.findMany({ where: { status: "generating", ...(onlyJobIds ? { id: { in: onlyJobIds } } : {}) }, select: { id: true, user_id: true } });
  for (const job of interrupted) await prisma.$transaction(async tx => {
    const outputs = await tx.outputImage.count({ where: { job_id: job.id } });
    const changed = await tx.generationJob.updateMany({ where: { id: job.id, status: "generating" }, data: {
      status: outputs ? "completed" : "failed", stage_hint: null,
      failure_reason: outputs ? null : "本地服务意外中断，未获得结果；不会自动重试生成。上游任务可能仍会计费。",
    } });
    if (changed.count !== 1 || outputs) return;
    const ledger = await tx.creditTransaction.aggregate({ where: { related_job_id: job.id, user_id: job.user_id, type: { in: ["consume", "refund"] } }, _sum: { amount: true } });
    const outstanding = -(ledger._sum.amount || 0);
    if (outstanding > 0) await refundCredits(tx, job.user_id, outstanding, job.id, "local_interrupted_generation_refund");
  });
  return interrupted.length;
}
