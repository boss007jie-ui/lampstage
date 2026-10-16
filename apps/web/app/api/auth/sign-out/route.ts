import { NextResponse } from "next/server";
import { authRoute } from "@/lib/auth-route";
import { signOut } from "@/lib/auth";

/**
 * POST /api/auth/sign-out
 * 删除当前 session 并清除 cookie。
 */
export async function POST(request: Request) {
  return authRoute(async () => {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const expectedOrigin = `${url.protocol}//${request.headers.get("host") || url.host}`;
    if (origin && origin !== expectedOrigin) {
      return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    await signOut();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
