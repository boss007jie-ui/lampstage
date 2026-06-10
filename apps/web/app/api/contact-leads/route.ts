/**
 * POST /api/contact-leads
 *
 * 任何"想付费 / 想加额度 / 想批量定制"动作都打这里。
 * 用户已登录则关联 user_id；未登录也可写入（首页 CTA 也用得到）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const VALID_SOURCES = new Set([
  "workspace_quota_modal",
  "credits_page_basic",
  "credits_page_business",
  "credits_page_factory",
  "homepage_cta",
  "other",
]);

const VALID_CONTACT_TYPES = new Set([
  "wechat",
  "customer_service",
  "batch_request",
  "phone",
  "email",
]);

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source : "other";
  const contactType =
    typeof body.contact_type === "string" ? body.contact_type : "wechat";
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json({ error: "bad_source" }, { status: 400 });
  }
  if (!VALID_CONTACT_TYPES.has(contactType)) {
    return NextResponse.json({ error: "bad_contact_type" }, { status: 400 });
  }
  const cur = await getCurrentUser().catch(() => null);
  const userId = cur?.id ?? null;

  const lead = await prisma.contactLead.create({
    data: {
      user_id: userId,
      source,
      contact_type: contactType,
      name: typeof body.name === "string" ? body.name.slice(0, 100) : null,
      phone: typeof body.phone === "string" ? body.phone.slice(0, 50) : null,
      wechat: typeof body.wechat === "string" ? body.wechat.slice(0, 80) : null,
      email: typeof body.email === "string" ? body.email.slice(0, 200) : null,
      message:
        typeof body.message === "string" ? body.message.slice(0, 1000) : null,
    },
  });

  return NextResponse.json({ id: lead.id, ok: true });
}
