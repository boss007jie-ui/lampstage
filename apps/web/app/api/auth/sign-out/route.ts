import { NextResponse } from "next/server";
import { authRoute } from "@/lib/auth-route";
import { signOut } from "@/lib/auth";

/**
 * POST /api/auth/sign-out
 * 删除当前 session 并清除 cookie。
 */
export async function POST() {
  return authRoute(async () => {
    await signOut();
    return NextResponse.json({ ok: true });
  });
}
