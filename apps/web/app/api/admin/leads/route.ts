/**
 * GET /api/admin/leads
 * 列出留资（想付费/联系的用户）。仅管理员。
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
  const leads = await prisma.contactLead.findMany({
    orderBy: { created_at: "desc" },
    take: 100,
    select: {
      id: true,
      source: true,
      wechat: true,
      phone: true,
      message: true,
      created_at: true,
      user: { select: { email: true } },
    },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      source: l.source,
      wechat: l.wechat,
      phone: l.phone,
      note: l.message,
      created_at: l.created_at,
      email: l.user?.email ?? null,
    })),
  });
}
