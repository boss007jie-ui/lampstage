/**
 * GET  /api/admin/users?q=<search>   列出用户（可按邮箱搜索）
 * POST /api/admin/users              给用户加/扣额度
 *   body: { user_id, amount, note }   amount 正数加、负数扣
 *
 * 仅管理员。加额度走事务：更新 credit_balance + 写一条 CreditTransaction。
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
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const users = await prisma.user.findMany({
    where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      credit_balance: true,
      role: true,
      created_at: true,
      _count: { select: { jobs: true } },
    },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      credit_balance: u.credit_balance,
      role: u.role,
      created_at: u.created_at,
      job_count: u._count.jobs,
    })),
  });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { user_id?: unknown; amount?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  const amount =
    typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
  const note = typeof body.note === "string" ? body.note : "admin_adjust";

  if (!userId || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error("user_not_found");
      const newBalance = user.credit_balance + amount;
      if (newBalance < 0) throw new Error("would_go_negative");
      const updated = await tx.user.update({
        where: { id: userId },
        data: { credit_balance: newBalance },
      });
      await tx.creditTransaction.create({
        data: {
          user_id: userId,
          type: "grant",
          amount,
          note: `admin: ${note}`,
        },
      });
      return updated;
    });
    return NextResponse.json({
      ok: true,
      user_id: result.id,
      credit_balance: result.credit_balance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
