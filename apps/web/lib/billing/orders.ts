import { createHash, randomBytes } from "node:crypto";
import type { RechargeOrder } from "@prisma/client";
import { prisma } from "../db";
import { createXunhupayOrder, queryXunhupayOrder } from "../xunhupay";
import { BillingError, getPack, RECHARGE_PACKS } from "./catalog";
import { merchantConfig, paymentBaseUrl, rechargeAvailability } from "./config";
import type { BillingView, RechargeDisplayMode, RechargeOrderView } from "./contract";

const orderIdPattern = /^[a-zA-Z0-9_*-]{1,32}$/;
const requestKeyPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const QR_LIFETIME_MS = 5 * 60_000;

export function orderView(order: RechargeOrder, now = new Date()): RechargeOrderView {
  const expires = order.expires_at ?? new Date(order.created_at.getTime() + QR_LIFETIME_MS);
  const expired = order.status === "pending" && expires.getTime() <= now.getTime();
  const displayMode = order.display_mode === "desktop" ? "desktop" : "mobile";
  const knownCreation = ["creating", "ready", "unknown", "failed"].includes(order.creation_state)
    ? order.creation_state as RechargeOrderView["creation_state"] : order.pay_url ? "ready" : "unknown";
  const creationState = knownCreation === "creating" && now.getTime() - order.created_at.getTime() > 120_000 ? "unknown" : knownCreation;
  const proof = order.callback_raw && typeof order.callback_raw === "object" && !Array.isArray(order.callback_raw) ? order.callback_raw : {};
  const requiresReview = proof.requires_review === true || Boolean(proof.refund);
  const canResume = !requiresReview && order.status === "pending" && !expired && creationState === "ready" &&
    Boolean(displayMode === "desktop" ? order.qr_code_url : order.pay_url);
  return {
    order_no: order.order_no, pack: order.pack, amount: order.amount_yuan.toFixed(2), credits: order.credits,
    status: expired ? "expired" : order.status, creation_state: creationState, display_mode: displayMode,
    pay_url: canResume && displayMode === "mobile" ? order.pay_url : null,
    qr_code_url: canResume && displayMode === "desktop" ? order.qr_code_url : null,
    created_at: order.created_at.toISOString(), paid_at: order.paid_at?.toISOString() ?? null,
    expires_at: expires.toISOString(), can_resume: canResume, requires_review: requiresReview,
    provider_status_advisory: ["OD", "WP", "CD"].includes(order.provider_query_status ?? "")
      ? order.provider_query_status as "OD" | "WP" | "CD" : null,
  };
}

function createInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingError("invalid_request");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["pack", "idempotency_key", "display_mode"].includes(key)) ||
    typeof input.pack !== "string" || !/^[a-z_]{1,32}$/.test(input.pack) ||
    typeof input.idempotency_key !== "string" || !requestKeyPattern.test(input.idempotency_key) ||
    (input.display_mode !== "desktop" && input.display_mode !== "mobile")) throw new BillingError("invalid_request");
  return { pack: input.pack, requestKey: input.idempotency_key.toLowerCase(), displayMode: input.display_mode as RechargeDisplayMode };
}

/** A committed create identity is never submitted to the gateway twice. */
export async function createRechargeOrder(userId: string, value: unknown) {
  const input = createInput(value);
  const requestHash = createHash("sha256").update(JSON.stringify([input.pack, input.displayMode])).digest("hex");
  const prepared = await prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (!users.length) throw new BillingError("not_signed_in", 401);
    const existing = await tx.rechargeOrder.findUnique({ where: { user_id_request_key: { user_id: userId, request_key: input.requestKey } } });
    if (existing) {
      if (existing.request_hash !== requestHash) throw new BillingError("idempotency_conflict", 409);
      return { created: false as const, order: existing };
    }
    if (!rechargeAvailability().enabled) throw new BillingError("recharge_unavailable", 503);
    const config = merchantConfig();
    const base = paymentBaseUrl();
    const pack = getPack(input.pack);
    if (!pack) throw new BillingError("bad_pack");
    const now = new Date();
    const [recent, pending] = await Promise.all([
      tx.rechargeOrder.count({ where: { user_id: userId, created_at: { gte: new Date(now.getTime() - 15 * 60_000) } } }),
      tx.rechargeOrder.count({ where: { user_id: userId, status: "pending", expires_at: { gt: now } } }),
    ]);
    if (recent >= 10 || pending >= 3) throw new BillingError("too_many_payment_orders", 429);
    const order = await tx.rechargeOrder.create({ data: {
      order_no: `LP${Date.now()}${randomBytes(6).toString("hex")}`, user_id: userId, pack: input.pack,
      amount_yuan: pack.amountYuan, credits: pack.credits, status: "pending", creation_state: "creating",
      request_key: input.requestKey, request_hash: requestHash, display_mode: input.displayMode,
      provider_appid: config.appid, provider_gateway: config.gateway,
      expires_at: new Date(now.getTime() + QR_LIFETIME_MS),
    } });
    return { created: true as const, order, config, base, title: pack.title };
  });
  if (!prepared.created) return { order: orderView(prepared.order), httpStatus: 200 as const };

  const result = await createXunhupayOrder({ ...prepared.config, orderNo: prepared.order.order_no,
    amountYuan: prepared.order.amount_yuan.toFixed(2), title: prepared.title,
    notifyUrl: `${prepared.base}/api/recharge/notify`,
    returnUrl: `${prepared.base}/account?recharge_order=${prepared.order.order_no}`,
  });
  // A fast notification may have paid the order while create was awaiting its response.
  if (result.ok) {
    const usable = input.displayMode === "desktop" ? result.qrCodeUrl : result.payUrl;
    await prisma.rechargeOrder.updateMany({ where: { id: prepared.order.id, status: { not: "paid" } }, data: {
      pay_url: input.displayMode === "mobile" ? result.payUrl : null,
      qr_code_url: input.displayMode === "desktop" ? result.qrCodeUrl : null,
      provider_order_id: result.providerOrderId, creation_state: usable ? "ready" : "unknown",
    } });
  } else {
    await prisma.rechargeOrder.updateMany({ where: { id: prepared.order.id, status: { not: "paid" } }, data: {
      creation_state: result.kind === "rejected" ? "failed" : "unknown",
      ...(result.kind === "rejected" ? { status: "failed" as const } : {}),
    } });
  }
  const order = await prisma.rechargeOrder.findUniqueOrThrow({ where: { id: prepared.order.id } });
  const view = orderView(order);
  return { order: view, httpStatus: view.creation_state === "unknown" && view.status !== "paid" ? 202 as const : 201 as const };
}

async function ownedOrder(userId: string, orderNo: string) {
  if (!orderIdPattern.test(orderNo)) throw new BillingError("not_found", 404);
  const order = await prisma.rechargeOrder.findFirst({ where: { order_no: orderNo, user_id: userId } });
  if (!order) throw new BillingError("not_found", 404);
  return order;
}

export async function getOwnedRechargeOrder(userId: string, orderNo: string) { return orderView(await ownedOrder(userId, orderNo)); }

/** Query responses are advisory; only the signed notification path can credit. */
export async function refreshRechargeOrder(userId: string, orderNo: string) {
  const order = await ownedOrder(userId, orderNo);
  if (order.status === "paid") return { order: orderView(order), query_state: "checked" as const };
  const config = merchantConfig();
  if ((order.provider_appid && order.provider_appid !== config.appid) ||
    (order.provider_gateway && order.provider_gateway !== config.gateway)) throw new BillingError("recharge_unavailable", 503);
  const now = new Date();
  const claimed = await prisma.rechargeOrder.updateMany({ where: { id: order.id,
    OR: [{ provider_query_at: null }, { provider_query_at: { lte: new Date(now.getTime() - 10_000) } }] },
    data: { provider_query_at: now } });
  if (!claimed.count) return { order: orderView(order), query_state: "rate_limited" as const };
  const result = await queryXunhupayOrder({ ...config, orderNo });
  if (result.ok) await prisma.rechargeOrder.updateMany({ where: { id: order.id, provider_query_at: now },
    data: { provider_query_status: result.status } });
  return { order: await getOwnedRechargeOrder(userId, orderNo), query_state: result.ok ? "checked" as const : "unavailable" as const };
}

export async function getBilling(userId: string): Promise<BillingView> {
  const availability = rechargeAvailability();
  return prisma.$transaction(async tx => {
    const [user, orders, transactions] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { credit_balance: true, credits_unlimited: true } }),
      tx.rechargeOrder.findMany({ where: { user_id: userId }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 20 }),
      tx.creditTransaction.findMany({ where: { user_id: userId }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 20,
        select: { id: true, type: true, amount: true, created_at: true, recharge_order: { select: { order_no: true } } } }),
    ]);
    if (!user) throw new BillingError("not_signed_in", 401);
    return { balance: user.credit_balance, credits_unlimited: user.credits_unlimited,
      billing_mode: user.credits_unlimited ? "internal_test" : "standard", unit: "Token", recharge: { ...availability,
      packs: availability.enabled ? Object.entries(RECHARGE_PACKS).map(([key, pack]) => ({ key,
        title: pack.title, amount: pack.amountYuan, credits: pack.credits, currency: "CNY" as const })) : [] },
      orders: orders.map(order => {
        // The overview never sends live payment links. Resume uses the owner-only detail endpoint.
        const view = orderView(order); return { ...view, pay_url: null, qr_code_url: null };
      }),
      transactions: transactions.map(txn => ({ id: txn.id, type: txn.type, amount: txn.amount,
        recharge_order_no: txn.recharge_order?.order_no ?? null, created_at: txn.created_at.toISOString() })),
    };
  }, { isolationLevel: "RepeatableRead" });
}
