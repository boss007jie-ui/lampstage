/**
 * GET /api/admin/jobs?status=<failed|completed|all>
 * 列出生成任务（默认全部，可筛失败）。仅管理员。
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const where =
    status === "failed"
      ? { status: "failed" as const }
      : status === "completed"
        ? { status: "completed" as const }
        : undefined;

  const jobs = await prisma.generationJob.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: 80,
    select: {
      id: true,
      status: true,
      scene_kind: true,
      failure_reason: true,
      credit_cost: true,
      created_at: true,
      user: { select: { email: true } },
      _count: { select: { outputs: true } },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      scene_kind: j.scene_kind,
      failure_reason: j.failure_reason,
      credit_cost: j.credit_cost,
      created_at: j.created_at,
      email: j.user?.email ?? null,
      output_count: j._count.outputs,
    })),
  });
}
