import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/me
 * 返回当前会话用户的核心字段。未登录返回 401。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
    credit_balance: user.credit_balance,
    role: user.role,
  });
}
