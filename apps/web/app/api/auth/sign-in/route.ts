/**
 * POST /api/auth/sign-in
 *
 * body: { email, password }
 *
 * 用密码登录（不需要验证码）。成功后写 session cookie。
 */
import { NextResponse } from "next/server";
import { signInWithPassword } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const result = await signInWithPassword(email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    user_id: result.userId,
    credit_balance: result.creditBalance,
  });
}
