/**
 * GET /api/admin/overview
 * 管理后台总览：用户数、任务数、留资数、额度发放/消耗。仅管理员。
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [userCount, jobTotal, jobDone, jobFailed, leadCount] =
    await Promise.all([
      prisma.user.count(),
      prisma.generationJob.count(),
      prisma.generationJob.count({ where: { status: "completed" } }),
      prisma.generationJob.count({ where: { status: "failed" } }),
      prisma.contactLead.count(),
    ]);

  const grantAgg = await prisma.creditTransaction.aggregate({
    where: { type: "grant" },
    _sum: { amount: true },
  });
  const consumeAgg = await prisma.creditTransaction.aggregate({
    where: { type: "consume" },
    _sum: { amount: true },
  });

  return NextResponse.json({
    users: userCount,
    jobs: { total: jobTotal, completed: jobDone, failed: jobFailed },
    leads: leadCount,
    credits_granted: grantAgg._sum.amount ?? 0,
    credits_consumed: Math.abs(consumeAgg._sum.amount ?? 0),
  });
}
