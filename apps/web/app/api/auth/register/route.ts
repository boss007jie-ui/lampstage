/**
 * POST /api/auth/register
 *
 * body: { email, password, code }
 *
 * 邮箱+密码+验证码注册，成功后写 session cookie。
 */
import { NextResponse } from "next/server";
import { registerWithPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code : "";

  const result = await registerWithPassword(email, password, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    user_id: result.userId,
    credit_balance: result.creditBalance,
  });
}
