/**
 * Debug endpoint：直接调 Resend SDK，把真实错误暴露出来。
 * 仅用于诊断 lampstage.vercel.app 的 email_send_failed 问题。
 * 调用：POST /api/debug/email { to: "..." }
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
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
