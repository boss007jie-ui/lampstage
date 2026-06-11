/**
 * POST /api/auth/lookup
 *
 * body: { email }
 *
 * 返回 { exists, hasPassword }，让前端决定显示登录还是注册分支。
 */
import { NextResponse } from "next/server";
import { lookupAccountStatus } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email : "";
  const status = await lookupAccountStatus(email);
  return NextResponse.json(status);
}
