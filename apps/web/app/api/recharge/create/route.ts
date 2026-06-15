/**
 * POST /api/recharge/create
 *
 * body: { pack: "basic" | "business" | "factory", payment?: "wechat" | "alipay" }
 *
 * 1. 必须登录（要绑定到用户）
 * 2. 根据 pack 创建 RechargeOrder（pending）
 * 3. 调虎皮椒下单 → 拿到支付页 URL
 * 4. 保存 pay_url → 返回给前端跳转
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createXunhupayOrder, getPack } from "@/lib/xunhupay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicBase(req: Request): string {
  // 优先 PUBLIC_BASE_URL（自定义域名），否则用 request 的 origin
  return (
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    new URL(req.url).origin
  );
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body: { pack?: unknown; payment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const packKey = typeof body.pack === "string" ? body.pack : "";
  const pack = getPack(packKey);
  if (!pack) {
    return NextResponse.json({ error: "bad_pack" }, { status: 400 });
  }
  const paymentType =
    body.payment === "wechat" || body.payment === "alipay"
      ? body.payment
      : undefined;

  const appid = process.env.XUNHUPAY_APPID;
  const appsecret = process.env.XUNHUPAY_APPSECRET;
  if (!appid || !appsecret) {
    return NextResponse.json(
      { error: "xunhupay_not_configured" },
      { status: 500 },
    );
  }

  // 生成业务订单号：LP + 时间戳 + 随机短串
  const orderNo = `LP${Date.now()}${crypto.randomBytes(3).toString("hex")}`;

  // 先落库（pending 状态）
  const dbOrder = await prisma.rechargeOrder.create({
    data: {
      order_no: orderNo,
      user_id: user.id,
      pack: packKey,
      amount_yuan: pack.amountYuan,
      credits: pack.credits,
      channel: paymentType ?? null,
      status: "pending",
    },
  });

  const base = publicBase(req);
  const result = await createXunhupayOrder({
    appid,
    appsecret,
    orderNo,
    amountYuan: pack.amountYuan,
    title: pack.title,
    notifyUrl: `${base}/api/recharge/notify`,
    returnUrl: `${base}/credits?recharge=success&order=${orderNo}`,
    paymentType,
  });

  if (!result.ok) {
    // 下单失败：把订单标记 failed，返回错误
    await prisma.rechargeOrder.update({
      where: { id: dbOrder.id },
      data: { status: "failed", callback_raw: result.raw as never },
    });
    return NextResponse.json(
      { error: "xunhupay_order_failed", message: result.errmsg },
      { status: 502 },
    );
  }

  // 保存支付链接
  await prisma.rechargeOrder.update({
    where: { id: dbOrder.id },
    data: { pay_url: result.payUrl },
  });

  return NextResponse.json({
    ok: true,
    order_no: orderNo,
    pay_url: result.payUrl,
    amount: pack.amountYuan,
    credits: pack.credits,
  });
}
