/**
 * Xunhupay provider boundary.
 *
 * Create/callback signature: https://www.xunhupay.com/doc/api/pay.html
 * Query contract: https://www.xunhupay.com/doc/api/search.html
 * The published query example nests data but gives no canonical signature encoding
 * for that object. Query results are advisory and MUST NEVER credit an account.
 */
import crypto from "node:crypto";

const PRIMARY = "https://api.xunhupay.com/payment/do.html";
const BACKUP = "https://api.dpweixin.com/payment/do.html";
const RESPONSE_LIMIT = 16 * 1024;
const TIMEOUT_MS = 8_000;

export type CreateOrderInput = {
  appid: string;
  appsecret: string;
  orderNo: string;
  amountYuan: string;
  title: string;
  notifyUrl: string;
  returnUrl: string;
  gateway?: string;
  /** Retained for callers; this undocumented choice is not sent to the provider. */
  paymentType?: "wechat" | "alipay";
  plugins?: string;
};

export type CreateOrderResult =
  | { ok: true; payUrl: string | null; qrCodeUrl: string | null; providerOrderId: string | null }
  | { ok: false; kind: "rejected" | "unknown"; code: string };

export type QueryOrderInput = {
  appid: string;
  appsecret: string;
  orderNo: string;
  gateway?: string;
};

export type QueryOrderResult =
  | { ok: true; status: "OD" | "WP" | "CD"; responseSignatureVerified: false; advisoryOnly: true }
  | { ok: false; kind: "unavailable" | "invalid_response"; code: string };

export type NotifyPayload = Record<string, string>;
type Scalar = string | number | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeScalar(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** Exact documented hash algorithm: only the hash field is excluded. */
export function signXunhupay(params: Record<string, Scalar>, appsecret: string): string {
  if (typeof appsecret !== "string" || !appsecret) throw new TypeError("Invalid signing secret");
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "hash" || value === null || value === undefined || value === "") continue;
    if (!isSafeScalar(value)) throw new TypeError("Signed values must be flat scalars");
    entries.push([key, String(value)]);
  }
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const message = entries.map(([key, value]) => `${key}=${value}`).join("&") + appsecret;
  return crypto.createHash("md5").update(message, "utf8").digest("hex");
}

function verifyFlatSignature(payload: unknown, appsecret: string): boolean {
  if (!isRecord(payload) || typeof payload.hash !== "string" || !/^[a-fA-F0-9]{32}$/.test(payload.hash)) return false;
  for (const value of Object.values(payload)) {
    if (value !== null && value !== undefined && !isSafeScalar(value)) return false;
  }
  try {
    const expected = Buffer.from(signXunhupay(payload as Record<string, Scalar>, appsecret), "hex");
    const received = Buffer.from(payload.hash, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

export function verifyNotifySignature(payload: NotifyPayload, appsecret: string): boolean {
  return verifyFlatSignature(payload, appsecret);
}

function gatewayUrl(gateway: string | undefined, operation: "do" | "query"): string | null {
  const base = gateway ?? PRIMARY;
  if (base !== PRIMARY && base !== BACKUP) return null;
  return base.replace("/payment/do.html", `/payment/${operation}.html`);
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeHttpsUrl(value: unknown): string | null {
  if (!safeText(value, 2048) || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return value;
  } catch {
    return null;
  }
}

function validCreateInput(input: CreateOrderInput): boolean {
  return safeText(input.appid, 32)
    && safeText(input.appsecret, 256)
    && typeof input.orderNo === "string" && /^[a-zA-Z0-9_*-]{1,32}$/.test(input.orderNo)
    && typeof input.amountYuan === "string" && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(input.amountYuan)
    && safeText(input.title, 127)
    && safeHttpsUrl(input.notifyUrl) !== null
    && safeHttpsUrl(input.returnUrl) !== null
    && (input.plugins === undefined || safeText(input.plugins, 128));
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("http_error");
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > RESPONSE_LIMIT) { await response.body?.cancel(); throw new Error("oversize"); }
  if (!response.body) throw new Error("empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) { await reader.cancel(); throw new Error("oversize"); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length);
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

async function postProvider(url: string, params: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return readBoundedResponse(response);
}

export async function createXunhupayOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const gateway = gatewayUrl(input.gateway, "do");
  if (!gateway || !validCreateInput(input)) return { ok: false, kind: "unknown", code: "invalid_input" };
  const params: Record<string, string> = {
    version: "1.1",
    appid: input.appid,
    trade_order_id: input.orderNo,
    total_fee: input.amountYuan,
    title: input.title,
    time: String(Math.floor(Date.now() / 1000)),
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    nonce_str: crypto.randomBytes(16).toString("hex"),
    plugins: input.plugins ?? "lampstage",
  };
  params.hash = signXunhupay(params, input.appsecret);
  let response: unknown;
  try {
    response = await postProvider(gateway, params);
  } catch {
    // A timed out create may have reached Xunhupay. Do not retry automatically.
    return { ok: false, kind: "unknown", code: "transport_error" };
  }
  if (!isRecord(response) || !verifyFlatSignature(response, input.appsecret)) {
    return { ok: false, kind: "unknown", code: "invalid_response" };
  }
  if (typeof response.errcode !== "number" || !Number.isInteger(response.errcode)) {
    return { ok: false, kind: "unknown", code: "invalid_response" };
  }
  if (response.errcode !== 0) return { ok: false, kind: "rejected", code: "provider_rejected" };
  const payUrl = response.url === undefined || response.url === null || response.url === "" ? null : safeHttpsUrl(response.url);
  const qrCodeUrl = response.url_qrcode === undefined || response.url_qrcode === null || response.url_qrcode === "" ? null : safeHttpsUrl(response.url_qrcode);
  if (!payUrl && !qrCodeUrl) return { ok: false, kind: "unknown", code: "invalid_response" };
  const providerOrderId = (typeof response.openid === "string" && safeText(response.openid, 64))
    || (typeof response.openid === "number" && Number.isSafeInteger(response.openid) && response.openid >= 0)
    ? String(response.openid)
    : null;
  return { ok: true, payUrl, qrCodeUrl, providerOrderId };
}

export async function queryXunhupayOrder(input: QueryOrderInput): Promise<QueryOrderResult> {
  const gateway = gatewayUrl(input.gateway, "query");
  if (!gateway || !safeText(input.appid, 32) || !safeText(input.appsecret, 256)
    || typeof input.orderNo !== "string" || !/^[a-zA-Z0-9_*-]{1,32}$/.test(input.orderNo)) {
    return { ok: false, kind: "unavailable", code: "invalid_input" };
  }
  const params: Record<string, string> = {
    appid: input.appid,
    out_trade_order: input.orderNo,
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: crypto.randomBytes(16).toString("hex"),
  };
  params.hash = signXunhupay(params, input.appsecret);
  let response: unknown;
  try {
    response = await postProvider(gateway, params);
  } catch {
    return { ok: false, kind: "unavailable", code: "transport_error" };
  }
  if (!isRecord(response) || response.errcode !== 0 || typeof response.errmsg !== "string"
    || typeof response.hash !== "string" || !/^[a-fA-F0-9]{32}$/.test(response.hash)
    || !isRecord(response.data)
    || (response.data.status !== "OD" && response.data.status !== "WP" && response.data.status !== "CD")) {
    return { ok: false, kind: "invalid_response", code: "invalid_response" };
  }
  // Deliberately no "verified" claim for the nested response. This must not drive credit.
  return { ok: true, status: response.data.status as "OD" | "WP" | "CD", responseSignatureVerified: false, advisoryOnly: true };
}

export { RECHARGE_PACKS, getPack } from "./billing/catalog";
export type { PackKey } from "./billing/catalog";
