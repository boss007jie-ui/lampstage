"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Coins, ArrowClockwise } from "@phosphor-icons/react";
import { LoginModal } from "@/components/auth/LoginModal";
import { RechargeDialog } from "@/components/credits/RechargeDialog";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";
import type { DictKey } from "@/lib/brand";

type Pack = "basic" | "business" | "factory";
type Tx = { id: string; type: "grant" | "consume" | "refund" | "manual_adjustment"; amount: number; related_job_id: string | null; note: string | null; created_at: string };
type LoadState = "loading" | "ready" | "unauth" | "error";
const PACKS: { key: Pack; name: DictKey; credits: number; yuan: number; desc: DictKey }[] = [
  { key: "basic", name: "plan_basic_name", credits: 100, yuan: 30, desc: "plan_basic_desc" },
  { key: "business", name: "plan_business_name", credits: 400, yuan: 99, desc: "plan_business_desc" },
  { key: "factory", name: "plan_factory_name", credits: 1500, yuan: 299, desc: "plan_factory_desc" },
];

export default function CreditsPage() {
  const { t, lang } = useLang();
  const [balance, setBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [loginOpen, setLoginOpen] = useState(false);
  const [rechargePack, setRechargePack] = useState<Pack | null>(null);
  const copy = lang === "zh" ? {
    intro: "按实际需求购买图片额度。在线支付完成后，额度自动到账。", loading: "正在读取账户…",
    loadError: "账户信息暂时无法加载，请检查网络后重试。", retry: "重试",
    signIn: "登录后查看余额与交易记录", freeIntro: "新用户注册可获赠 20 次额度。",
    freeAvailable: "注册即送", freeGranted: "已领取", topup: "在线充值",
    recent: "最近交易记录", historyError: "交易记录暂时无法加载。",
  } : {
    intro: "Buy image credits as needed. Online payments add credits automatically.", loading: "Loading account…",
    loadError: "Account information could not be loaded. Check your connection and retry.", retry: "Retry",
    signIn: "Sign in to view your balance and transactions", freeIntro: "New accounts receive 20 free credits.",
    freeAvailable: "On signup", freeGranted: "Granted", topup: "Top up online",
    recent: "Recent transactions", historyError: "Transaction history could not be loaded.",
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch("/api/my/credits", { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (response.status === 401) { setBalance(null); setTxs([]); setState("unauth"); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.credit_balance !== "number" || !Array.isArray(data.transactions)) throw new Error("Invalid credits response");
      if (signal?.aborted) return;
      setBalance(data.credit_balance);
      setTxs(data.transactions);
      setState("ready");
    } catch {
      if (!signal?.aborted) { setBalance(null); setTxs([]); setState("error"); }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const granted = state === "ready" && txs.some(tx => tx.type === "grant" && tx.amount === 20);
  const labelTx = (type: Tx["type"]) => type === "grant" ? t("credits_tx_grant") : type === "consume" ? t("credits_tx_consume") : type === "refund" ? t("credits_tx_refund") : t("credits_tx_manual");

  return <div className="flex min-h-screen flex-col bg-[#faf9f6]">
    <SiteHeader active="credits" />
    <main className="page-container flex-1 py-10 md:py-16">
      <div className="mb-8"><h1 className="page-heading">{t("credits_title")}</h1><p className="page-description mt-3">{copy.intro}</p></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,1fr)_2fr]">
        <section className="surface p-7" aria-labelledby="credits-balance-title">
          <Coins size={28} className="text-[#5b6350]" />
          <h2 id="credits-balance-title" className="mt-4 text-sm text-[#6b7066]">{t("credits_balance_label")}</h2>
          {state === "ready" ? <p className="mt-2 text-5xl font-semibold tracking-tight">{balance}<span className="ml-2 text-base font-normal text-[#6b7066]">{t("credits_balance_unit")}</span></p>
            : <p className="mt-3 text-sm text-[#6b7066]" role={state === "error" ? "alert" : "status"}>{state === "loading" ? copy.loading : state === "unauth" ? copy.signIn : copy.loadError}</p>}
          {state === "error" && <button type="button" onClick={() => void load()} className="btn btn-outline mt-4"><ArrowClockwise size={17} />{copy.retry}</button>}
          {state === "unauth" && <button type="button" onClick={() => setLoginOpen(true)} className="btn btn-primary mt-4">{t("nav_login")}</button>}
        </section>
        <section className="surface p-7" aria-labelledby="credits-plans-title">
          <h2 id="credits-plans-title" className="text-2xl font-semibold">{t("plans_title")}</h2>
          <p className="page-description mt-3">{t("plans_subtitle")}</p>
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-[#f0f2eb] p-4">
            <Check size={20} className="shrink-0 text-[#5b6350]" /><p className="text-sm">{copy.freeIntro} <span className="font-semibold text-[#5b6350]">{granted ? copy.freeGranted : copy.freeAvailable}</span></p>
          </div>
        </section>
      </div>
      <section className="mt-6 grid gap-4 md:grid-cols-3" aria-label={t("plans_title")}>
        {PACKS.map(pack => <article key={pack.key} className="surface flex flex-col p-6">
          <h3 className="text-sm font-semibold text-[#5b6350]">{t(pack.name)}</h3>
          <p className="mt-4 text-4xl font-semibold tracking-tight">¥{pack.yuan}</p>
          <p className="mt-2 text-sm text-[#6b7066]">{pack.credits} {lang === "zh" ? "次额度" : "credits"}</p>
          <p className="mt-5 flex-1 text-sm leading-6 text-[#6b7066]">{t(pack.desc)}</p>
          <button type="button" className="btn btn-primary mt-6 w-full disabled:opacity-50" disabled={state === "loading" || state === "error"} onClick={() => state === "unauth" ? setLoginOpen(true) : setRechargePack(pack.key)}>{copy.topup}</button>
        </article>)}
      </section>
      <section className="mt-12" aria-labelledby="credits-history-title">
        <h2 id="credits-history-title" className="text-xl font-semibold">{t("credits_history_title")}</h2>
        <p className="mt-1 text-sm text-[#6b7066]">{copy.recent}</p>
        <div className="surface mt-4 overflow-hidden">
          {state === "loading" && <p className="p-6 text-sm text-[#6b7066]" role="status">{copy.loading}</p>}
          {state === "unauth" && <p className="p-6 text-sm text-[#6b7066]">{copy.signIn}</p>}
          {state === "error" && <div className="p-6" role="alert"><p className="text-sm text-[#6b7066]">{copy.historyError}</p><button type="button" className="btn btn-outline mt-3" onClick={() => void load()}>{copy.retry}</button></div>}
          {state === "ready" && txs.length === 0 && <p className="p-6 text-sm text-[#6b7066]">{t("credits_history_empty")}</p>}
          {state === "ready" && txs.length > 0 && <ul className="divide-y divide-[#e5e5de]">{txs.map(tx => <li key={tx.id} className="flex items-center justify-between gap-4 px-6 py-4"><div><p className="text-sm font-medium">{labelTx(tx.type)}</p><p className="mt-1 text-xs text-[#6b7066]"><time dateTime={tx.created_at}>{new Date(tx.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</time>{tx.note && <> · {tx.note}</>}</p></div><strong className={`text-sm ${tx.amount >= 0 ? "text-[#5b6350]" : "text-[#262924]"}`}>{tx.amount > 0 ? "+" : ""}{tx.amount}</strong></li>)}</ul>}
        </div>
      </section>
    </main>
    <SiteFooter />
    <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSignedIn={() => { setLoginOpen(false); void load(); }} />
    <RechargeDialog open={rechargePack !== null} pack={rechargePack} onClose={() => setRechargePack(null)} onPaid={() => void load()} />
  </div>;
}
