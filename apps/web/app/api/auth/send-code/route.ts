import { NextRequest, NextResponse } from "next/server";
import { sendCode } from "@/lib/auth";

/**
 * POST /api/auth/send-code
 * body: { identifier: string }  (邮箱或手机号，自动判断)
 */
export async function POST(req: NextRequest) {
  let body: { identifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const identifier = typeof body.identifier === "string" ? body.identifier : "";
  if (!identifier) {
    return NextResponse.json({ error: "missing_identifier" }, { status: 400 });
  }

  const result = await sendCode(identifier);
  if (!result.sent) {
    return NextResponse.json(
      { error: result.reason || "send_failed" },
      { status: result.reason === "rate_limited" ? 429 : 400 },
    );
  }
  // dev 环境暴露明文验证码方便联调；生产环境不返回
  return NextResponse.json({
    sent: true,
    devCode: result.devCode,
  });
}
