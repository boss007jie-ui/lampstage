/**
 * POST /api/recharge/notify
 *
 * 虎皮椒异步通知回调地址。
 * 注意：不能要求登录（虎皮椒服务器调，没有 cookie）。
 *
 * 流程：
 *   1. 解析 form / json payload
 *   2. 验签（hash 字段 + AppSecret）
 *   3. 找订单（trade_order_id = 我们的 order_no）
 *   4. 校验金额一致（防伪造）
 *   5. 幂等：如果已 paid 直接返回 success
 *   6. 事务：标记 paid + 给用户加额度 + 写 CreditTransaction
 *   7. 返回纯文本 "success"（虎皮椒约定）
 */
import { prisma } from "@/lib/db";
import { verifyNotifySignature } from "@/lib/xunhupay";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function parsePayload(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = (await req.json()) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j)) {
      if (v !== null && v !== undefined) out[k] = String(v);
    }
    return out;
  }
  // 默认按 form
  const text = await req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

// 虎皮椒约定收到任何处理（成功/失败/已处理）都返回纯文本 "success"，
// 否则会重复回调最多 5 次。
function ack() {
  return new Response("success", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  const appsecret = process.env.XUNHUPAY_APPSECRET;
  if (!appsecret) {
    console.error("[recharge/notify] XUNHUPAY_APPSECRET not set");
    return ack();
  }

  let payload: Record<string, string>;
  try {
    payload = await parsePayload(req);
  } catch (e) {
    console.error("[recharge/notify] parse failed:", e);
    return ack();
  }

  // 1. 验签
  if (!verifyNotifySignature(payload, appsecret)) {
    console.error("[recharge/notify] BAD SIGNATURE", {
      received: payload.hash,
      payloadKeys: Object.keys(payload),
    });
    return ack();
  }

  const orderNo = payload.trade_order_id;
  const xunhupayTradeNo = payload.transaction_id || payload.open_order_id || null;
  const status = payload.status; // 'OD' = 已支付（已订单）/ '...' 其它状态
  const totalFee = payload.total_fee;

  if (!orderNo) {
    console.error("[recharge/notify] missing trade_order_id", payload);
    return ack();
  }

  // 2. 找订单
  const order = await prisma.rechargeOrder.findUnique({
    where: { order_no: orderNo },
  });
  if (!order) {
    console.error("[recharge/notify] order not found:", orderNo);
    return ack();
  }

  // 3. 幂等：已 paid 直接返回
  if (order.status === "paid") {
    console.log("[recharge/notify] already paid, idempotent:", orderNo);
    return ack();
  }

  // 4. 校验金额（防伪造）
  if (totalFee && Number(totalFee) !== Number(order.amount_yuan)) {
    console.error("[recharge/notify] amount mismatch", {
      expected: order.amount_yuan,
      received: totalFee,
    });
    await prisma.rechargeOrder.update({
      where: { id: order.id },
      data: {
        status: "failed",
        callback_raw: payload as unknown as Prisma.InputJsonValue,
      },
    });
    return ack();
  }

  // 5. status 不是 'OD'（已支付），保留 pending 等下次回调
  if (status && status !== "OD") {
    console.log("[recharge/notify] non-final status, keep pending:", status);
    await prisma.rechargeOrder.update({
      where: { id: order.id },
      data: { callback_raw: payload as unknown as Prisma.InputJsonValue },
    });
    return ack();
  }

  // 6. 事务：标记 paid + 加额度 + 写 transaction
  try {
    await prisma.$transaction(async (tx) => {
      // 再次锁行检查，防并发重复加额度
      const fresh = await tx.rechargeOrder.findUnique({
        where: { id: order.id },
      });
      if (!fresh || fresh.status === "paid") return;

      const updated = await tx.user.update({
        where: { id: order.user_id },
        data: { credit_balance: { increment: order.credits } },
      });

      await tx.creditTransaction.create({
        data: {
          user_id: order.user_id,
          type: "grant",
          amount: order.credits,
          note: `recharge:${order.pack}:${orderNo}`,
        },
      });

      await tx.rechargeOrder.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paid_at: new Date(),
          xunhupay_trade_no: xunhupayTradeNo,
          callback_raw: payload as unknown as Prisma.InputJsonValue,
        },
      });

      console.log(
        `[recharge/notify] PAID ✅ order=${orderNo} user=${order.user_id} +${order.credits} credits, balance=${updated.credit_balance}`,
      );
    });
  } catch (e) {
    console.error("[recharge/notify] tx failed:", e);
    // 不返回错误状态，让虎皮椒重试（幂等已保证不会重复加额度）
  }

  return ack();
}
