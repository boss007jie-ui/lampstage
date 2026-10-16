"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import type { RechargeDisplayMode, RechargeOrderView, RechargePackView } from "@/lib/billing/contract";

type Props = {
  open: boolean; pack: RechargePackView | null; existingOrderNo?: string | null;
  onClose: () => void; onPaid?: () => void; onSessionExpired?: () => void;
};
type OrderResponse = { order?: RechargeOrderView; query_state?: "checked" | "rate_limited" | "unavailable"; error?: string };
const POLL_MS = 4000, LIMIT_MS = 600000, REFRESH_MS = 10000;

export function RechargeDialog({ open, pack, existingOrderNo, onClose, onPaid, onSessionExpired }: Props) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [order, setOrder] = useState<RechargeOrderView | null>(null);
  const [phase, setPhase] = useState<"loading" | "uncertain" | "error" | "order">("loading");
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [pollStopped, setPollStopped] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef<{ pack: string; key: string; mode: RechargeDisplayMode } | null>(null);
  const requestsByPackRef = useRef(new Map<string, { pack: string; key: string; mode: RechargeDisplayMode }>());
  const epochRef = useRef(0), inFlightRef = useRef(false), paidRef = useRef(false), lastRefreshRef = useRef(0), pollStartedRef = useRef(0);
  const callbacks = useRef({ onPaid, onSessionExpired });
  callbacks.current = { onPaid, onSessionExpired };
  const c = zh ? {
    title: "充值 Token", close: "关闭", loading: "正在读取订单…", creating: "正在创建支付订单…",
    amount: "支付金额", number: "订单号", scan: "请按二维码显示的渠道扫码支付", mobile: "打开支付页面",
    pending: "等待支付确认，到账以订单状态为准。", paid: "支付成功", paidHint: "Token 已到账。",
    failed: "订单未完成", expired: "订单已过期", unknown: "创建结果尚未确认。请用原请求恢复订单，勿重复付款。",
    unavailable: "支付信息暂不可用，请稍后查看当前订单。", recover: "使用原请求恢复订单",
    check: "我已支付 / 查询状态", checking: "查询中…", later: "查询过于频繁，请稍后再试。",
    advisory: "支付渠道查询仅供参考，仍需等待到账确认。", network: "暂时无法确认订单状态，请稍后重试。",
    noOrder: "无法读取此订单，请从订单列表重试。", timeout: "已暂停自动查询，可手动查询当前订单。", done: "完成",
    closed: "充值暂不可用，请返回账户页稍后再试。", rate: "当前订单较多，请稍后再试。", badPack: "此套餐已不可用，请返回账户页查看最新套餐。",
    rejected: "无法创建此订单，请返回账户页重试。", back: "返回账户", unchanged: "订单尚未确认到账。若已支付，请稍后再次查询。",
    review: "退款处理中，请联系客服核对余额。",
  } : {
    title: "Recharge Token", close: "Close", loading: "Loading order…", creating: "Creating payment order…",
    amount: "Amount", number: "Order", scan: "Scan with the payment channel shown in the QR code", mobile: "Open payment page",
    pending: "Waiting for confirmed payment. Tokens arrive when the order is paid.", paid: "Payment complete", paidHint: "Tokens have been credited.",
    failed: "Order not completed", expired: "Order expired", unknown: "Creation outcome is uncertain. Recover with the same request before paying again.",
    unavailable: "Payment details are unavailable. Check this order later.", recover: "Recover this request",
    check: "I've paid / Check status", checking: "Checking…", later: "Please wait before checking again.",
    advisory: "Provider query is advisory. Wait for confirmed credit.", network: "Could not confirm this order yet. Try again later.",
    noOrder: "Could not read this order. Try again from the order list.", timeout: "Automatic checks paused. You can still check manually.", done: "Done",
    closed: "Recharge is unavailable. Return to your account and try later.", rate: "Too many active orders. Please try later.", badPack: "This package is unavailable. Return to your account for current packages.",
    rejected: "Could not create this order. Return to your account and try again.", back: "Return to account", unchanged: "Payment is not confirmed yet. If you paid, check again later.",
    review: "Refund under review. Contact support to confirm your balance.",
  };
  const accept = useCallback((next: RechargeOrderView) => {
    setOrder(next); setPhase("order"); setMessage("");
    if (next.status !== "pending") requestsByPackRef.current.delete(next.pack);
    if (next.status === "paid" && !paidRef.current) { paidRef.current = true; callbacks.current.onPaid?.(); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const epoch = ++epochRef.current, controller = new AbortController();
    setOrder(null); setMessage(""); setPhase("loading"); setChecking(false); setPollStopped(false);
    paidRef.current = false; inFlightRef.current = false; lastRefreshRef.current = 0; pollStartedRef.current = 0;
    async function run() {
      if (existingOrderNo) {
        requestRef.current = null;
        try {
          const response = await fetch(`/api/recharge/${encodeURIComponent(existingOrderNo)}`, { cache: "no-store", signal: controller.signal });
          if (epoch !== epochRef.current) return;
          if (response.status === 401) { callbacks.current.onSessionExpired?.(); return; }
          const data = await response.json().catch(() => ({})) as OrderResponse;
          if (!response.ok || data.order?.order_no !== existingOrderNo) throw new Error("load");
          accept(data.order);
        } catch { if (epoch === epochRef.current) { setPhase("error"); setMessage(c.noOrder); } }
        return;
      }
      if (!pack) return;
      if (!requestRef.current || requestRef.current.pack !== pack.key) {
        requestRef.current = requestsByPackRef.current.get(pack.key) || {
          pack: pack.key, key: crypto.randomUUID(),
          mode: window.matchMedia?.("(max-width: 639px)").matches || window.innerWidth <= 639 ? "mobile" : "desktop",
        };
        requestsByPackRef.current.set(pack.key, requestRef.current);
      }
      const req = requestRef.current;
      try {
        const response = await fetch("/api/recharge/create", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ pack: req.pack, idempotency_key: req.key, display_mode: req.mode }), signal: controller.signal,
        });
        if (epoch !== epochRef.current) return;
        if (response.status === 401) { callbacks.current.onSessionExpired?.(); return; }
        const data = await response.json().catch(() => ({})) as OrderResponse;
        if (response.ok && data.order?.order_no && data.order.display_mode === req.mode) { accept(data.order); return; }
        const knownError = response.status === 429 || response.status === 400 || response.status === 403 ||
          (response.status === 503 && data.error === "recharge_unavailable") || response.status === 409;
        if (knownError) {
          requestsByPackRef.current.delete(req.pack); requestRef.current = null;
          setPhase("error");
          setMessage(response.status === 429 ? c.rate : data.error === "recharge_unavailable" ? c.closed :
            data.error === "bad_pack" ? c.badPack : c.rejected);
          return;
        }
      } catch { /* Network failure may have created an order. */ }
      if (epoch === epochRef.current) { setPhase("uncertain"); setMessage(c.unknown); }
    }
    // Skip Strict Mode's disposable effect pass.
    queueMicrotask(() => { if (epoch === epochRef.current) void run(); });
    return () => { epochRef.current++; controller.abort(); };
  // Retry reuses the original key and frozen display mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pack?.key, existingOrderNo, attempt, accept]);

  const check = useCallback(async (refresh: boolean) => {
    if (!order || order.status === "paid" || inFlightRef.current) return;
    const providerRefresh = refresh && order.status === "pending";
    if (providerRefresh && Date.now() - lastRefreshRef.current < REFRESH_MS) { setMessage(c.later); return; }
    if (providerRefresh) lastRefreshRef.current = Date.now();
    const epoch = epochRef.current;
    inFlightRef.current = true; setChecking(true);
    try {
      const response = await fetch(`/api/recharge/${encodeURIComponent(order.order_no)}${providerRefresh ? "/refresh" : ""}`, {
        method: providerRefresh ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
      });
      if (epoch !== epochRef.current) return;
      if (response.status === 401) { callbacks.current.onSessionExpired?.(); return; }
      const data = await response.json().catch(() => ({})) as OrderResponse;
      if (!response.ok || data.order?.order_no !== order.order_no) throw new Error("status");
      accept(data.order);
      if (providerRefresh && data.order.status === "pending") setMessage(data.query_state === "rate_limited" ? c.later : data.query_state === "unavailable" ? c.network : c.advisory);
      else if (refresh && data.order.status !== "paid") setMessage(c.unchanged);
    } catch { if (epoch === epochRef.current) setMessage(c.network); }
    finally { if (epoch === epochRef.current) { inFlightRef.current = false; setChecking(false); } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, accept, lang]);
  useEffect(() => {
    if (!open || order?.status !== "pending") return;
    if (!pollStartedRef.current) pollStartedRef.current = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - pollStartedRef.current >= LIMIT_MS) { window.clearInterval(timer); setPollStopped(true); return; }
      void check(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, order?.order_no, order?.status, check]);
  const close = () => { epochRef.current++; requestRef.current = null; onClose(); };
  const showPayment = order?.status === "pending" && order.creation_state === "ready" && !order.requires_review;
  return <Dialog open={open} onClose={close} titleId="recharge-dialog-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="recharge-dialog-title" className="text-xl font-semibold">{pack?.title || c.title}</h2>
        {(order || pack) && <p className="mt-2 text-sm text-[var(--color-muted)]">{c.amount} · <strong className="text-[var(--color-text)]">¥{order?.amount ?? pack?.amount}</strong> · {order?.credits ?? pack?.credits} Token</p>}</div>
      <button type="button" className="icon-button" onClick={close} aria-label={c.close}>×</button>
    </div>
    <div className="mt-6 grid min-h-[220px] place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 text-center">
      {phase === "loading" && <p role="status">{pack ? c.creating : c.loading}</p>}
      {(phase === "uncertain" || phase === "error") && <div role="alert"><p>{message}</p>{phase === "uncertain" ? <button type="button" className="btn btn-outline mt-4" onClick={() => setAttempt(n => n + 1)}>{c.recover}</button> : <button type="button" className="btn btn-outline mt-4" onClick={close}>{c.back}</button>}</div>}
      {order?.requires_review && <p role="status" className="text-sm">{c.review}</p>}
      {order?.status === "paid" && !order.requires_review && <div role="status"><p className="text-xl font-semibold">{c.paid} · +{order.credits} Token</p><p className="mt-2 text-sm text-[var(--color-muted)]">{c.paidHint}</p></div>}
      {order && !order.requires_review && (order.status === "failed" || order.status === "expired") && <p role="status">{order.status === "failed" ? c.failed : c.expired}</p>}
      {order?.status === "pending" && !order.requires_review && <div className="flex flex-col items-center gap-3">
        {showPayment && order.display_mode === "desktop" && order.qr_code_url && <img src={order.qr_code_url} width={190} height={190} alt={c.scan} referrerPolicy="no-referrer" className="rounded-lg bg-white p-3" />}
        {showPayment && order.display_mode === "mobile" && order.pay_url && <a href={order.pay_url} target="_blank" rel="noreferrer" className="btn btn-primary">{c.mobile}</a>}
        <p className="text-sm">{showPayment ? c.pending : order.creation_state === "unknown" ? c.unknown : c.unavailable}</p>
        {order.creation_state === "unknown" && !existingOrderNo && <button type="button" className="btn btn-outline" onClick={() => setAttempt(n => n + 1)}>{c.recover}</button>}
      </div>}
    </div>
    {order && <p className="mt-3 break-all text-xs text-[var(--color-muted)]">{c.number}: {order.order_no}</p>}
    {order && order.status !== "paid" && <div className="mt-4"><button type="button" className="btn btn-outline" disabled={checking} onClick={() => void check(true)}>{checking ? c.checking : c.check}</button>{pollStopped && <p className="mt-2 text-xs text-[var(--color-muted)]">{c.timeout}</p>}</div>}
    {message && phase === "order" && <p role="status" className="mt-3 text-sm text-[var(--color-muted)]">{message}</p>}
    {order?.status === "paid" && <button type="button" className="btn btn-primary mt-5 w-full" onClick={close}>{c.done}</button>}
  </Dialog>;
}
