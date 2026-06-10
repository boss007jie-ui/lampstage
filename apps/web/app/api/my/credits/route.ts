/**
 * GET /api/my/credits
 *
 * 返回当前用户的余额 + 最近 50 条 CreditTransaction。
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const [balance, txs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { credit_balance: true },
    }),
    prisma.creditTransaction.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" },
      take: 50,
    }),
  ]);
  return NextResponse.json({
    credit_balance: balance?.credit_balance ?? 0,
    transactions: txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      related_job_id: t.related_job_id,
      note: t.note,
      created_at: t.created_at.toISOString(),
    })),
  });
}
