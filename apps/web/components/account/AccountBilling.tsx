"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";
import { RechargeDialog } from "@/components/credits/RechargeDialog";
import type { BillingView, RechargeOrderView, RechargePackView } from "@/lib/billing/contract";
import type { AccountUsageView } from "@/lib/billing/usage";

type Props = { onSessionExpired: () => void };
type Selection = { pack: RechargePackView; orderNo?: never } | { pack?: never; orderNo: string };
function date(value: string, lang: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
}

export function AccountBilling({ onSessionExpired }: Props) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [usage, setUsage] = useState<AccountUsageView["totals"] | null>(null);
  const [usageState, setUsageState] = useState<"loading" | "ready" | "error">("loading");
  const [selection, setSelection] = useState<Selection | null>(null);
  const mounted = useRef(true), epoch = useRef(0), returnChecked = useRef(false);
  const expireRef = useRef(onSessionExpired);
  expireRef.current = onSessionExpired;
  const c = zh ? {
    title: "余额与充值", balance: "当前余额", recharge: "充值 Token", unavailable: "充值暂未开放。",
    unconfigured: "充值暂不可用，请稍后再试。", loading: "正在加载余额…", failed: "暂时无法加载余额。",
    retry: "重试", orders: "最近订单", transactions: "最近流水", emptyOrders: "暂无充值订单。",
    emptyTransactions: "暂无流水。", resume: "查看订单", time: "时间", amount: "金额", status: "状态",
    change: "变动", type: "类型", paid: "已支付", pending: "待确认", failedOrder: "未完成", expired: "已过期",
    grant: "入账", consume: "消耗", refund: "退回", manual_adjustment: "人工调整",
    review: "退款处理中，请联系客服核对余额。",
    internalAccount: "内部测试账号 · 不扣余额，任务用量照常记录", internalRecharge: "内部测试账号无需充值。",
    usage: "任务用量", imageJobs: "图片任务", deliveredImages: "已交付图片", videoJobs: "视频任务",
    usageLoading: "正在加载用量…", usageUnavailable: "暂时无法获取用量统计。",
    usageNote: "用量用于后续定价；实际费用仍需结合供应商账单核对。",
  } : {
    title: "Balance & recharge", balance: "Current balance", recharge: "Recharge Token", unavailable: "Recharge is not open yet.",
    unconfigured: "Recharge is temporarily unavailable.", loading: "Loading balance…", failed: "Could not load your balance.",
    retry: "Retry", orders: "Recent orders", transactions: "Recent activity", emptyOrders: "No recharge orders yet.",
    emptyTransactions: "No activity yet.", resume: "View order", time: "Time", amount: "Amount", status: "Status",
    change: "Change", type: "Type", paid: "Paid", pending: "Pending", failedOrder: "Not completed", expired: "Expired",
    grant: "Credit", consume: "Usage", refund: "Refund", manual_adjustment: "Adjustment",
    review: "Refund under review. Contact support to confirm your balance.",
    internalAccount: "Internal test account · No balance deducted; task usage is still recorded.", internalRecharge: "Internal test accounts do not need to recharge.",
    usage: "Task usage", imageJobs: "Image jobs", deliveredImages: "Delivered images", videoJobs: "Video jobs",
    usageLoading: "Loading usage…", usageUnavailable: "Usage statistics are temporarily unavailable.",
    usageNote: "Usage informs future pricing; actual costs still need to be checked against provider bills.",
  };
  const load = useCallback(async () => {
    const current = ++epoch.current;
    setState("loading");
    setUsage(null); setUsageState("loading");
    try {
      const response = await fetch("/api/account/billing", { cache: "no-store", credentials: "same-origin" });
      if (!mounted.current || current !== epoch.current) return;
      if (response.status === 401) { setBilling(null); setSelection(null); expireRef.current(); return; }
      if (!response.ok) throw new Error("billing");
      const data = await response.json() as BillingView;
      if (!mounted.current || current !== epoch.current) return;
      if (data.unit !== "Token" || typeof data.credits_unlimited !== "boolean" || !["standard", "internal_test"].includes(data.billing_mode) || !Array.isArray(data.orders) || !Array.isArray(data.transactions) || !Array.isArray(data.recharge?.packs)) throw new Error("billing");
      setBilling(data); setState("ready");
      void (async () => {
        try {
          const usageResponse = await fetch("/api/account/usage", { cache: "no-store", credentials: "same-origin" });
          if (!mounted.current || current !== epoch.current) return;
          if (usageResponse.status === 401) { setBilling(null); setSelection(null); expireRef.current(); return; }
          if (!usageResponse.ok) throw new Error("usage");
          const usageData = await usageResponse.json() as AccountUsageView;
          const totals = usageData?.totals;
          if (!totals || ![totals.image_jobs, totals.delivered_images, totals.video_jobs].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("usage");
          if (mounted.current && current === epoch.current) { setUsage(totals); setUsageState("ready"); }
        } catch { if (mounted.current && current === epoch.current) setUsageState("error"); }
      })();
      // A return URL is an order lookup hint only. It never creates or proves a payment.
      if (!returnChecked.current) {
        returnChecked.current = true;
        const orderNo = new URL(window.location.href).searchParams.get("recharge_order");
        if (orderNo && orderNo.length <= 128) setSelection({ orderNo });
      }
    } catch { if (mounted.current && current === epoch.current) setState("error"); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; epoch.current++; };
  }, [load]);
  const status = (order: RechargeOrderView) => order.status === "paid" ? c.paid : order.status === "pending" ? c.pending : order.status === "expired" ? c.expired : c.failedOrder;
  return <section id="billing" className="mt-10 scroll-mt-24">
    <h2 className="text-xl font-semibold">{c.title}</h2>
    {state === "loading" && <div className="surface mt-5 p-6" role="status">{c.loading}</div>}
    {state === "error" && <div className="surface mt-5 p-6" role="alert">{c.failed} <button type="button" className="btn btn-outline ml-3" onClick={() => void load()}>{c.retry}</button></div>}
    {billing && state === "ready" && <>
      <div className="mt-5 rounded-2xl bg-[#171a27] p-6 text-white shadow-lg">
        <p className="text-sm text-white/70">{c.balance}</p>
        <p className="mt-2 text-4xl font-semibold tabular-nums">{billing.credits_unlimited ? "∞" : billing.balance.toLocaleString()} <span className="text-lg text-white/70">Token</span></p>
        {billing.billing_mode === "internal_test" && <p className="mt-3 text-sm text-white/80">{c.internalAccount}</p>}
      </div>
      <div className="mt-6"><h3 className="text-lg font-semibold">{c.usage}</h3>
        {usageState === "loading" && <p className="surface mt-3 p-5 text-sm text-[var(--color-muted)]" role="status">{c.usageLoading}</p>}
        {usageState === "error" && <p className="surface mt-3 p-5 text-sm text-[var(--color-muted)]">{c.usageUnavailable}</p>}
        {usageState === "ready" && usage && <div className="surface mt-3 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {([[c.imageJobs, usage.image_jobs], [c.deliveredImages, usage.delivered_images], [c.videoJobs, usage.video_jobs]] as const).map(([label, count]) =>
              <div key={label}><p className="text-sm text-[var(--color-muted)]">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count.toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</p></div>)}
          </div>
          <p className="mt-4 text-xs text-[var(--color-muted)]">{c.usageNote}</p>
        </div>}
      </div>
      <div className="mt-6"><h3 className="text-lg font-semibold">{c.recharge}</h3>
        {billing.credits_unlimited ? <p className="mt-2 text-sm text-[var(--color-muted)]">{c.internalRecharge}</p> : !billing.recharge.enabled && <p className="mt-2 text-sm text-[var(--color-muted)]">{billing.recharge.unavailable_reason === "not_configured" ? c.unconfigured : c.unavailable}</p>}
        {!billing.credits_unlimited && billing.recharge.enabled && <div className="mt-3 grid gap-3 sm:grid-cols-3">{billing.recharge.packs.map(pack =>
          <button type="button" key={pack.key} className="surface p-5 text-left transition hover:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]" onClick={() => setSelection({ pack })}>
            <span className="block font-semibold">{pack.title}</span><span className="mt-2 block text-2xl font-semibold">{pack.credits.toLocaleString()} <small className="text-sm">Token</small></span>
            <span className="mt-2 block text-sm text-[var(--color-muted)]">¥{pack.amount}</span>
          </button>)}</div>}
      </div>
      <div className="mt-8"><h3 className="text-lg font-semibold">{c.orders}</h3>
        {billing.orders.length === 0 ? <p className="surface mt-3 p-5 text-sm text-[var(--color-muted)]">{c.emptyOrders}</p> :
          <div className="surface mt-3 divide-y divide-[var(--color-border)]">{billing.orders.slice(0, 20).map(order =>
            <div key={order.order_no} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0"><p className="break-all font-medium">{order.order_no}</p><p className="text-xs text-[var(--color-muted)]">{date(order.created_at, lang)}</p>
                {order.requires_review && <p className="mt-1 text-xs text-[var(--color-danger)]">{c.review}</p>}</div>
              <div className="flex items-center gap-3"><span>¥{order.amount} · {order.credits} Token</span><span>{status(order)}</span>
                <button type="button" className="btn btn-outline !min-h-0 !py-2" onClick={() => setSelection({ orderNo: order.order_no })}>{c.resume}</button></div>
            </div>)}</div>}
      </div>
      <div className="mt-8"><h3 className="text-lg font-semibold">{c.transactions}</h3>
        {billing.transactions.length === 0 ? <p className="surface mt-3 p-5 text-sm text-[var(--color-muted)]">{c.emptyTransactions}</p> :
          <div className="surface mt-3 divide-y divide-[var(--color-border)]">{billing.transactions.slice(0, 20).map(item =>
            <div key={item.id} className="flex items-center justify-between gap-4 p-4 text-sm"><div><p className="font-medium">{c[item.type]}</p><p className="text-xs text-[var(--color-muted)]">{date(item.created_at, lang)}</p></div>
              <strong className="tabular-nums">{item.amount > 0 ? "+" : ""}{item.amount} Token</strong></div>)}</div>}
      </div>
    </>}
    <RechargeDialog open={selection !== null} pack={selection?.pack || null} existingOrderNo={selection?.orderNo}
      onClose={() => setSelection(null)} onPaid={() => void load()} onSessionExpired={() => { epoch.current++; setBilling(null); setSelection(null); expireRef.current(); }} />
  </section>;
}
