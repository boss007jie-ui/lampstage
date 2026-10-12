import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/auth-route";
import { verifyCodeAndSignIn } from "@/lib/auth";

/**
 * POST /api/auth/verify-code
 * body: { identifier: string, code: string }
 *
 * 成功后会写 lamp_session cookie。
 */
export async function POST(req: NextRequest) {
  return authRoute(async () => {
    let body: { identifier?: unknown; code?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const identifier = typeof body.identifier === "string" ? body.identifier : "";
    const code = typeof body.code === "string" ? body.code : "";
    if (!identifier || !code) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const result = await verifyCodeAndSignIn(identifier, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      user_id: result.userId,
      is_new_user: result.isNewUser,
      credit_balance: result.creditBalance,
    });
  });
}
