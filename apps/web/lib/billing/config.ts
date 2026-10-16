import { BillingError } from "./catalog";

export type MerchantConfig = { appid: string; appsecret: string; gateway: string };
const gateways = new Set(["https://api.xunhupay.com/payment/do.html", "https://api.dpweixin.com/payment/do.html"]);

export function merchantConfig(): MerchantConfig {
  const appid = process.env.XUNHUPAY_APPID?.trim();
  const appsecret = process.env.XUNHUPAY_APPSECRET?.trim();
  const gateway = process.env.XUNHUPAY_GATEWAY?.trim() || "https://api.xunhupay.com/payment/do.html";
  if (!appid || appid.length > 32 || !appsecret || appsecret.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(appid + appsecret) || !gateways.has(gateway)) {
    throw new BillingError("recharge_unavailable", 503);
  }
  return { appid, appsecret, gateway };
}

export function paymentBaseUrl(): string {
  try {
    const value = process.env.PUBLIC_BASE_URL;
    if (!value) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { throw new BillingError("recharge_unavailable", 503); }
}

export function rechargeAvailability() {
  if (process.env.RECHARGE_ENABLED !== "true") return { enabled: false, unavailable_reason: "not_open" } as const;
  try {
    merchantConfig(); paymentBaseUrl();
    return { enabled: true, unavailable_reason: null } as const;
  } catch { return { enabled: false, unavailable_reason: "not_configured" } as const; }
}
