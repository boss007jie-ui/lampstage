import { createHash } from "node:crypto";
import { prisma } from "../db";
import { verifyNotifySignature } from "../xunhupay";
import { BillingError, moneyCents } from "./catalog";
import { merchantConfig } from "./config";
import { readBoundedText } from "./http";

export async function parseRechargeNotification(request: Request): Promise<Record<string, string>> {
  const text = await readBoundedText(request, 16 * 1024);
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const result: Record<string, string> = Object.create(null);
  if (type === "application/json") {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new BillingError("invalid_notification"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BillingError("invalid_notification");
    // Parse each complete flat member as well: JSON.parse otherwise hides duplicate keys.
    const inner = text.trim().slice(1, -1);
    const member = /\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(,|$)/gy;
    const seen = new Set<string>();
    let offset = 0;
    while (offset < inner.length && inner.slice(offset).trim()) {
      member.lastIndex = offset;
      const match = member.exec(inner);
      if (!match) throw new BillingError("invalid_notification");
      const key = JSON.parse(match[1]) as string;
      if (seen.has(key)) throw new BillingError("invalid_notification");
      seen.add(key); offset = member.lastIndex;
    }
    for (const [key, value] of Object.entries(parsed)) {
      // Official callbacks are form scalars; JSON is accepted only without coercing nested values.
      if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new BillingError("invalid_notification");
      result[key] = String(value);
    }
  } else if (type === "application/x-www-form-urlencoded") {
    for (const [key, value] of new URLSearchParams(text)) {
      if (Object.prototype.hasOwnProperty.call(result, key)) throw new BillingError("invalid_notification");
      result[key] = value;
    }
  } else throw new BillingError("invalid_notification", 415);
  if (Object.keys(result).length > 40 || Object.entries(result).some(([key, value]) =>
    !/^[a-zA-Z0-9_]{1,64}$/.test(key) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))) throw new BillingError("invalid_notification");
  return result;
}

/** Valid signature plus an exact immutable order match authorizes one ledger credit. */
export async function processRechargeNotification(payload: Record<string, string>): Promise<{ applied: boolean }> {
  const config = merchantConfig();
  if (!verifyNotifySignature(payload, config.appsecret) || payload.appid !== config.appid ||
    !/^[a-zA-Z0-9_*-]{1,32}$/.test(payload.trade_order_id ?? "") ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.transaction_id ?? "") ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.open_order_id ?? "") ||
    !["OD", "CD", "RD", "UD"].includes(payload.status) || moneyCents(payload.total_fee ?? "") === null ||
    (payload.currency !== undefined && payload.currency !== "CNY")) throw new BillingError("invalid_notification");

  // Resolve owner before taking locks; financial writes always lock User before RechargeOrder.
  const known = await prisma.rechargeOrder.findUnique({ where: { order_no: payload.trade_order_id }, select: { id: true, user_id: true } });
  if (!known) throw new BillingError("unknown_order", 404);
  const proof = { status: payload.status, amount: payload.total_fee, transaction_id: payload.transaction_id,
    open_order_id: payload.open_order_id, received_at: new Date().toISOString() };
  const paymentKey = createHash("sha256").update(JSON.stringify([config.appid, payload.transaction_id])).digest("hex");
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string; credit_balance: number }>>`
      SELECT "id", "credit_balance" FROM "User" WHERE "id" = ${known.user_id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "RechargeOrder" WHERE "id" = ${known.id} FOR UPDATE`;
    const order = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: known.id } });
    if (!users.length || (order.provider_appid && order.provider_appid !== config.appid) ||
      (order.provider_gateway && order.provider_gateway !== config.gateway) ||
      moneyCents(order.amount_yuan.toFixed(2)) !== moneyCents(payload.total_fee) || order.credits <= 0) throw new BillingError("notification_mismatch");
    const previousProof = order.callback_raw && typeof order.callback_raw === "object" && !Array.isArray(order.callback_raw)
      ? order.callback_raw as Record<string, unknown> : {};
    const refund = previousProof.refund && typeof previousProof.refund === "object" && !Array.isArray(previousProof.refund)
      ? previousProof.refund as Record<string, unknown> : null;
    if (payload.status !== "OD") {
      // Refund accounting needs a separate operator decision, especially after Token consumption.
      // Preserve the signed event for review without treating it as a new purchase or spending Tokens.
      await tx.rechargeOrder.update({ where: { id: order.id }, data: { callback_raw: {
        ...(typeof previousProof.payment === "object" && previousProof.payment !== null ? { payment: previousProof.payment } : {}),
        requires_review: true, refund: refund?.status === "CD" ? refund : proof,
      } as never } });
      return { applied: false };
    }
    if (order.status === "paid") {
      if (order.provider_payment_key && order.provider_payment_key !== paymentKey) throw new BillingError("notification_mismatch");
      return { applied: false };
    }
    if (previousProof.requires_review === true || refund) throw new BillingError("payment_requires_review", 409);
    if (users[0].credit_balance > 2_147_483_647 - order.credits) throw new BillingError("payment_requires_review", 503);
    const claim = await tx.rechargeOrder.updateMany({ where: { id: order.id, status: { not: "paid" } }, data: {
      status: "paid", creation_state: "ready", paid_at: new Date(), provider_payment_key: paymentKey,
      xunhupay_trade_no: payload.transaction_id,
      callback_raw: { payment: proof, ...(refund ? { refund } : {}) } as never,
    } });
    if (!claim.count) return { applied: false };
    await tx.user.update({ where: { id: order.user_id }, data: { credit_balance: { increment: order.credits } } });
    const ledger = await tx.creditTransaction.create({ data: {
      user_id: order.user_id, type: "grant", amount: order.credits, note: `recharge:${order.pack}:${order.order_no}`,
    }, select: { id: true } });
    await tx.rechargeOrder.update({ where: { id: order.id }, data: { credit_transaction_id: ledger.id } });
    return { applied: true };
  });
}
