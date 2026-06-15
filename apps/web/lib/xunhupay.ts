/**
 * 虎皮椒 V2 支付集成
 *
 * 网关：https://api.xunhupay.com/payment/do.html
 * 文档：https://www.xunhupay.com/doc/  (V2)
 *
 * 签名算法（V2）：
 *   1. 收集所有非空参数（hash / sign 字段除外）
 *   2. 按 key 字母序排列，拼成 key1=val1&key2=val2&... 形式
 *   3. 末尾拼接 AppSecret（不要再加 &）
 *   4. UTF-8 编码 → MD5 → 32 位小写（虎皮椒标准）
 *
 * 下单接口请求字段（最少必填）：
 *   - version: "1.1"
 *   - lang: "zh-cn"
 *   - plugins: "lampstage"   (来源标识)
 *   - appid: AppID
 *   - trade_order_id: 我们的订单号
 *   - total_fee: 金额（元，字符串，例 "30.00"）
 *   - title: 商品名
 *   - time: 时间戳（秒）
 *   - notify_url: 异步通知 URL
 *   - return_url: 同步跳转 URL
 *   - nonce_str: 随机字符串（防重放）
 *   - hash: 签名
 *
 * 异步通知验签：
 *   - POST 表单或 JSON 都要支持
 *   - 收到的 payload 里 hash 字段要剥离后用同样算法重新计算 → 比对
 */
import crypto from "node:crypto";

const GATEWAY = "https://api.xunhupay.com/payment/do.html";

export type CreateOrderInput = {
  appid: string;
  appsecret: string;
  orderNo: string;
  amountYuan: string; // "30.00"
  title: string;
  notifyUrl: string;
  returnUrl: string;
  /** wechat / alipay；不填让用户在虎皮椒页面选 */
  paymentType?: "wechat" | "alipay";
  /** 来源标识，方便对账 */
  plugins?: string;
};

export type CreateOrderResult =
  | { ok: true; payUrl: string; raw: Record<string, unknown> }
  | { ok: false; errcode: number; errmsg: string; raw: Record<string, unknown> };

export type NotifyPayload = Record<string, string>;

/** 生成虎皮椒签名（V2）。 */
export function signXunhupay(
  params: Record<string, string | number | undefined | null>,
  appsecret: string,
): string {
  // 排除 hash/sign 字段 + 排除空值
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== "hash" && k !== "sign" && v !== undefined && v !== null && String(v).length > 0)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  // 按 key 字母序
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const querystring = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const signStr = querystring + appsecret;
  return crypto.createHash("md5").update(signStr, "utf8").digest("hex");
}

/** 创建虎皮椒订单：返回支付页 URL（用户跳转扫码）。 */
export async function createXunhupayOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const params: Record<string, string> = {
    version: "1.1",
    lang: "zh-cn",
    plugins: input.plugins || "lampstage",
    appid: input.appid,
    trade_order_id: input.orderNo,
    total_fee: input.amountYuan,
    title: input.title,
    time: Math.floor(Date.now() / 1000).toString(),
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
    nonce_str: crypto.randomBytes(8).toString("hex"),
  };
  if (input.paymentType === "wechat") {
    params.payment = "wechat";
    params.type = "WAP"; // WAP / JSAPI / NATIVE，先用 WAP（H5）兼容性最广
  } else if (input.paymentType === "alipay") {
    params.payment = "alipay";
    params.type = "WAP";
  }

  const hash = signXunhupay(params, input.appsecret);
  const body = { ...params, hash };

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errcode: -1, errmsg: `非 JSON 响应: ${text.slice(0, 200)}`, raw: { text } };
  }

  // 虎皮椒成功响应：{ url, url_qrcode, openid, errcode: 0, errmsg: 'success', hash, ... }
  // 失败响应：{ errcode: <非0>, errmsg: '...' }
  const errcode = Number(raw.errcode ?? 0);
  if (errcode !== 0) {
    return {
      ok: false,
      errcode,
      errmsg: String(raw.errmsg || "unknown"),
      raw,
    };
  }
  // 优先 url（H5 跳转），没有再用 url_qrcode（PC 扫码图）
  const payUrl = String(raw.url || raw.url_qrcode || "");
  if (!payUrl) {
    return { ok: false, errcode: -2, errmsg: "响应里无 url 字段", raw };
  }
  return { ok: true, payUrl, raw };
}

/** 验证虎皮椒异步通知签名。返回 true 才能信任 payload。 */
export function verifyNotifySignature(
  payload: NotifyPayload,
  appsecret: string,
): boolean {
  const recv = String(payload.hash || "");
  if (!recv) return false;
  const expected = signXunhupay(payload, appsecret);
  // 虎皮椒返回的 hash 一般是小写，做大小写不敏感比较
  return recv.toLowerCase() === expected.toLowerCase();
}

/**
 * 充值包定义（金额、张数、标题）。
 * 必须和 /credits 页面 UI 上展示的一致。
 */
export const RECHARGE_PACKS = {
  basic: { amountYuan: "30.00", credits: 100, title: "灯境 · 体验包 100 张" },
  business: { amountYuan: "99.00", credits: 400, title: "灯境 · 标准包 400 张" },
  factory: { amountYuan: "299.00", credits: 1500, title: "灯境 · 大包 1500 张" },
} as const;

export type PackKey = keyof typeof RECHARGE_PACKS;

export function getPack(key: string): { amountYuan: string; credits: number; title: string } | null {
  if (key in RECHARGE_PACKS) {
    return RECHARGE_PACKS[key as PackKey];
  }
  return null;
}
