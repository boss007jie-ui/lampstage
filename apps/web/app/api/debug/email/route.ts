/**
 * Debug endpoint：直接调 Resend SDK，把真实错误暴露出来。
 * 调用：POST /api/debug/email { to: "..." }
 *
 * ⚠️ 安全：本端点**不做任何鉴权**，任何能访问到它的人都可以用部署方的 Resend
 * 账号给任意地址发信（消耗配额、可被当成垃圾邮件跳板）。因此
 *
 *   **生产环境（NODE_ENV=production）整体关闭：直接返回 404，且不解析请求体。**
 *
 * 只在本地 / 开发环境保留，用于排查 email_send_failed。
 * 如果将来确实需要在生产做发信自检，请另加 isAdmin() 鉴权，不要放开这里。
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 生产环境关停。Next.js 在构建期就会把 NODE_ENV 内联，所以这里是常量折叠。 */
const DISABLED_IN_PRODUCTION = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  if (DISABLED_IN_PRODUCTION) {
    // 返回 404 而不是 403：不向外暴露「这里曾经有个接口」。
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to : "";
  if (!to) return NextResponse.json({ error: "missing_to" }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  const env = {
    has_api_key: Boolean(apiKey),
    api_key_prefix: apiKey ? apiKey.slice(0, 5) : null,
    api_key_length: apiKey?.length ?? 0,
    resend_from: from ?? null,
    node_env: process.env.NODE_ENV,
  };

  if (!apiKey) {
    return NextResponse.json({ env, error: "no_api_key" }, { status: 500 });
  }

  try {
    const client = new Resend(apiKey);
    const r = await client.emails.send({
      from: from || "Lampstage <onboarding@resend.dev>",
      to,
      subject: "Lampstage debug ping",
      text: "If you got this, Resend is wired up correctly.",
    });
    return NextResponse.json({
      env,
      sdk_response: {
        data: r.data,
        error: r.error
          ? {
              name: r.error.name,
              message: r.error.message,
            }
          : null,
      },
    });
  } catch (e: unknown) {
    const err = e as Error;
    return NextResponse.json({
      env,
      thrown: {
        name: err.name,
        message: err.message,
        stack: err.stack?.split("\n").slice(0, 5),
      },
    });
  }
}
