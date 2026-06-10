import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth";

/**
 * POST /api/auth/sign-out
 * 删除当前 session 并清除 cookie。
 */
export async function POST() {
  await signOut();
  return NextResponse.json({ ok: true });
}
