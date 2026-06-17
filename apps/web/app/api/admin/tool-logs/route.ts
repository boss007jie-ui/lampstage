/**
 * GET /api/admin/tool-logs?tool=<all|lamp_profile|prompt_planner|nano-banana|gpt-image-2>&status=<all|ok|failed>
 * 列出最近的外部 AI 调用日志 + 汇总（成功率、平均耗时）。仅管理员。
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
  const tool = url.searchParams.get("tool") || "all";
  const status = url.searchParams.get("status") || "all";

  const where: Record<string, string> = {};
  if (tool !== "all") where.tool = tool;
  if (status !== "all") where.status = status;

  const logs = await prisma.toolCallLog.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: 100,
  });

  // 汇总最近 24h（不受筛选影响，给整体健康度）
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.toolCallLog.findMany({
    where: { created_at: { gte: since } },
    select: { tool: true, status: true, duration_ms: true },
  });
  const byTool: Record<
    string,
    { total: number; ok: number; failed: number; avgMs: number }
  > = {};
  for (const r of recent) {
    const t = (byTool[r.tool] ??= { total: 0, ok: 0, failed: 0, avgMs: 0 });
    t.total += 1;
    if (r.status === "ok") t.ok += 1;
    else t.failed += 1;
    t.avgMs += r.duration_ms ?? 0;
  }
  for (const k of Object.keys(byTool)) {
    byTool[k].avgMs = Math.round(byTool[k].avgMs / byTool[k].total);
  }

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      tool: l.tool,
      model: l.model,
      job_id: l.job_id,
      status: l.status,
      http_status: l.http_status,
      duration_ms: l.duration_ms,
      error: l.error,
      created_at: l.created_at,
    })),
    summary24h: byTool,
  });
}
