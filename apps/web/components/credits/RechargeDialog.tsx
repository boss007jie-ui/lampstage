"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle, X } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";

type Pack = "basic" | "business" | "factory";
type Props = { open: boolean; pack: Pack | null; onClose: () => void; onPaid?: () => void };
type CreateResp = { ok?: boolean; order_no?: string; pay_url?: string; amount?: string; credits?: number; error?: string; message?: string };
type StatusResp = { order_no?: string; status?: "pending" | "paid" | "failed" | "expired"; amount?: string; credits?: number; paid_at?: string | null; error?: string };
type Phase = "creating" | "pending" | "paid" | "failed" | "expired" | "error";
const PACKS: Record<Pack, { zh: string; en: string; yuan: number; credits: number }> = {
  basic: { zh: "体验包", en: "Starter", yuan: 30, credits: 100 },
  business: { zh: "标准包", en: "Standard", yuan: 99, credits: 400 },
  factory: { zh: "大包", en: "Bulk", yuan: 299, credits: 1500 },
};

export function RechargeDialog({ open, pack, onClose, onPaid }: Props) {
  const { lang } = useLang();
  const [phase, setPhase] = useState<Phase>("creating");
  const [error, setError] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [pollError, setPollError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paidRef = useRef(onPaid);
  paidRef.current = onPaid;
  const paidNotified = useRef(false);
  const sessionRef = useRef(0);
  const openRef = useRef(false);
  const activeOrderRef = useRef<string | null>(null);
  const retryLockRef = useRef(false);
  const copy = lang === "zh" ? {
    close: "关闭", loading: "正在生成支付二维码…", pay: "请用微信或支付宝扫码支付",
    order: "订单号", pending: "等待支付确认，成功后额度会自动到账。", openPay: "在手机上打开支付页面",
    paid: "支付成功", paidHint: "额度已到账，可以继续生成。", failed: "支付失败",
    expired: "订单已过期", error: "暂时无法创建支付订单。", network: "网络异常，支付状态暂时无法确认。",
    retry: "重试", checkAgain: "重新查询支付状态", done: "完成", amount: "实际支付金额",
    count: "张图片额度", login: "请先登录后再充值。",
  } : {
    close: "Close", loading: "Creating your payment QR code…", pay: "Scan with WeChat or Alipay",
    order: "Order", pending: "Waiting for payment confirmation. Credits arrive automatically.", openPay: "Open the payment page on your phone",
    paid: "Payment complete", paidHint: "Credits have been added. You can keep creating.", failed: "Payment failed",
    expired: "Order expired", error: "Could not create the payment order.", network: "Network issue. Payment status could not be confirmed.",
    retry: "Retry", checkAgain: "Check payment status again", done: "Done", amount: "Amount payable",
    count: "image credits", login: "Sign in before topping up.",
  };
  const meta = pack ? PACKS[pack] : null;
  const reset = () => { paidNotified.current = false; setPhase("creating"); setError(null); setOrderNo(null); setPayUrl(null); setAmount(null); setCredits(null); setPollError(false); };
  useLayoutEffect(() => {
    sessionRef.current += 1;
    openRef.current = open && pack !== null;
    activeOrderRef.current = null;
    return () => {
      sessionRef.current += 1;
      openRef.current = false;
      activeOrderRef.current = null;
    };
  }, [open, pack]);
  const current = useCallback((session: number, id?: string) =>
    openRef.current && sessionRef.current === session && (!id || activeOrderRef.current === id), []);
  const close = () => {
    sessionRef.current += 1;
    openRef.current = false;
    activeOrderRef.current = null;
    onClose();
  };
  const retry = () => {
    if (retryLockRef.current) return;
    retryLockRef.current = true;
    sessionRef.current += 1;
    activeOrderRef.current = null;
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    if (!open || !pack) { reset(); return; }
    const session = ++sessionRef.current;
    retryLockRef.current = false;
    reset();
    const create = async () => {
      if (!current(session)) return;
      try {
        const response = await fetch("/api/recharge/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack }) });
        const data = await response.json().catch(() => ({})) as CreateResp;
        if (!current(session)) return;
        if (!response.ok || !data.ok || !data.order_no || !data.pay_url) {
          setError(response.status === 401 ? copy.login : (data.message || data.error || copy.error));
          setPhase("error");
          return;
        }
        activeOrderRef.current = data.order_no;
        setOrderNo(data.order_no); setPayUrl(data.pay_url);
        setAmount(data.amount || null); setCredits(typeof data.credits === "number" ? data.credits : null);
        setPhase("pending");
      } catch {
        if (current(session)) { setError(copy.network); setPhase("error"); }
      }
    };
    // Deferring the request prevents Strict Mode's disposable effect pass from creating an order.
    queueMicrotask(() => void create());
    return () => {
      sessionRef.current += 1;
      activeOrderRef.current = null;
    };
  // Recreating an order is intentional only when the pack or retry attempt changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pack, attempt]);

  const checkStatus = useCallback(async (id: string, session: number) => {
    if (!current(session, id)) return;
    try {
      const response = await fetch(`/api/recharge/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as StatusResp;
      if (!current(session, id) || (data.order_no && data.order_no !== id)) return;
      setPollError(false);
      if (data.status === "paid") {
        activeOrderRef.current = null;
        setPhase("paid");
        if (!paidNotified.current) { paidNotified.current = true; paidRef.current?.(); }
      } else if (data.status === "failed") {
        activeOrderRef.current = null;
        setPhase("failed");
      } else if (data.status === "expired") {
        activeOrderRef.current = null;
        setPhase("expired");
      }
    } catch {
      if (current(session, id)) setPollError(true);
    }
  }, [current]);
  useEffect(() => {
    if (!open || phase !== "pending" || !orderNo) return;
    const session = sessionRef.current;
    const id = window.setInterval(() => void checkStatus(orderNo, session), 2500);
    return () => window.clearInterval(id);
  }, [open, phase, orderNo, checkStatus]);

  if (!meta) return <Dialog open={false} onClose={close} titleId="recharge-dialog-title">{null}</Dialog>;
  const shownAmount = amount && Number.isFinite(Number(amount)) ? `¥${Number(amount).toFixed(2)}` : `¥${meta.yuan.toFixed(2)}`;
  return <Dialog open={open} onClose={close} titleId="recharge-dialog-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="recharge-dialog-title" className="text-xl font-semibold">{lang === "zh" ? meta.zh : meta.en}</h2><p className="mt-2 text-sm text-[var(--color-muted)]">{copy.amount} · <strong className="text-[var(--color-text)]">{shownAmount}</strong> · {credits ?? meta.credits} {copy.count}</p></div>
      <button type="button" className="icon-button" onClick={close} aria-label={copy.close}><X size={21} /></button>
    </div>
    <div className="mt-6 grid min-h-[250px] place-items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 text-center">
      {phase === "creating" && <p role="status" className="text-sm text-[var(--color-muted)]">{copy.loading}</p>}
      {phase === "pending" && payUrl && <div className="flex flex-col items-center gap-3">
        <div className="rounded-lg bg-white p-3"><QRCodeSVG value={payUrl} size={190} level="M" /></div>
        <p className="text-sm font-medium">{copy.pay}</p>
        <p className="text-xs text-[var(--color-muted)]">{copy.pending}</p>
        <p className="break-all text-xs text-[var(--color-muted)]">{copy.order}: {orderNo}</p>
      </div>}
      {phase === "paid" && <div><CheckCircle size={48} className="mx-auto text-[var(--color-accent)]" /><p className="mt-3 font-semibold">{copy.paid} · +{credits ?? meta.credits}</p><p className="mt-2 text-sm text-[var(--color-muted)]">{copy.paidHint}</p></div>}
      {(phase === "failed" || phase === "expired" || phase === "error") && <div role="alert"><p className="text-sm text-[var(--color-danger)]">{phase === "failed" ? copy.failed : phase === "expired" ? copy.expired : (error || copy.error)}</p><button type="button" className="btn btn-outline mt-4" onClick={retry}>{copy.retry}</button></div>}
    </div>
    {phase === "pending" && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <a href={payUrl || "#"} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-accent)] underline">{copy.openPay}</a>
      {pollError && <div className="w-full" role="alert"><p className="text-[var(--color-danger)]">{copy.network}</p><button type="button" className="btn btn-outline mt-2" onClick={() => orderNo && void checkStatus(orderNo, sessionRef.current)}>{copy.checkAgain}</button></div>}
    </div>}
    {phase === "paid" && <button type="button" className="btn btn-primary mt-5 w-full" onClick={close}>{copy.done}</button>}
  </Dialog>;
}
