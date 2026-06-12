"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import {
  LeadCaptureModal,
  type LeadSource,
} from "@/components/credits/LeadCaptureModal";
import { BRAND, type DictKey } from "@/lib/brand";

type Tx = {
  id: string;
  type: "grant" | "consume" | "refund" | "manual_adjustment";
  amount: number;
  related_job_id: string | null;
  note: string | null;
  created_at: string;
};

export default function CreditsPage() {
  const { t, lang } = useLang();
  const [balance, setBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauth, setUnauth] = useState(false);
  const [leadOpen, setLeadOpen] = useState<LeadSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/credits", { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          setUnauth(true);
          setLoading(false);
          return;
        }
        if (!r.ok) {
          setLoading(false);
          return;
        }
        const data = await r.json();
        setBalance(data.credit_balance);
        setTxs(data.transactions || []);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-[#e8e5df] bg-white">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 md:px-6">
          <Link
            href="/"
            className="text-[18px] font-semibold tracking-tight md:text-[22px]"
          >
            {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
          </Link>
          <div className="flex items-center gap-3">
            <LangToggle />
            <Link
              href="/workspace"
              className="rounded-md bg-[#171717] px-4 py-2 text-[14px] text-white"
            >
              {t("nav_generate")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-6 md:py-10">
        <h1 className="text-[28px] font-light tracking-[-0.5px] md:text-[36px]">
          {t("credits_title")}
        </h1>

        {/* 余额 + 简短引导 */}
        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
          <BalanceCard
            balance={balance}
            loading={loading}
            unauth={unauth}
            unit={t("credits_balance_unit")}
            label={t("credits_balance_label")}
          />
          <PlansHero
            title={t("plans_title")}
            subtitle={t("plans_subtitle")}
          />
        </section>

        {/* 充值包 */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PlanCard
            nameKey="plan_free_name"
            priceKey="plan_free_price"
            quotaKey="plan_free_quota"
            unitKey="plan_free_unit"
            descKey="plan_free_desc"
            isFree
          />
          <PlanCard
            nameKey="plan_basic_name"
            priceKey="plan_basic_price"
            quotaKey="plan_basic_quota"
            unitKey="plan_basic_unit"
            descKey="plan_basic_desc"
            onContact={() => setLeadOpen("credits_page_basic")}
          />
          <PlanCard
            nameKey="plan_business_name"
            priceKey="plan_business_price"
            quotaKey="plan_business_quota"
            unitKey="plan_business_unit"
            descKey="plan_business_desc"
            onContact={() => setLeadOpen("credits_page_business")}
            highlight
          />
          <PlanCard
            nameKey="plan_factory_name"
            priceKey="plan_factory_price"
            quotaKey="plan_factory_quota"
            unitKey="plan_factory_unit"
            descKey="plan_factory_desc"
            onContact={() => setLeadOpen("credits_page_factory")}
          />
        </section>

        {/* 交易记录 */}
        <section className="mt-10">
          <h2 className="text-[18px] font-semibold tracking-tight">
            {t("credits_history_title")}
          </h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-[#e5edf5] bg-white">
            {loading && (
              <div className="p-6 text-center text-[#94a3b8]">…</div>
            )}
            {!loading && unauth && (
              <div className="p-6 text-center text-[#64748d]">
                {t("login_title")}
              </div>
            )}
            {!loading && !unauth && txs.length === 0 && (
              <div className="p-6 text-center text-[#94a3b8]">
                {t("credits_history_empty")}
              </div>
            )}
            {!loading && !unauth && txs.length > 0 && (
              <ul className="divide-y divide-[#f1f5f9]">
                {txs.map((tx) => (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div>
                      <div className="text-[14px] font-medium text-[#061b31]">
                        {labelTx(tx.type, t)}
                      </div>
                      <div className="text-[12px] text-[#94a3b8]">
                        {new Date(tx.created_at).toLocaleString()}
                        {tx.note ? ` · ${tx.note}` : ""}
                      </div>
                    </div>
                    <div
                      className={`font-mono text-[15px] ${
                        tx.amount >= 0 ? "text-emerald-600" : "text-[#061b31]"
                      }`}
                    >
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <LeadCaptureModal
        open={leadOpen !== null}
        source={leadOpen ?? "other"}
        onClose={() => setLeadOpen(null)}
      />
    </div>
  );
}

function labelTx(
  type: Tx["type"],
  t: (k: DictKey) => string,
): string {
  switch (type) {
    case "grant":
      return t("credits_tx_grant");
    case "consume":
      return t("credits_tx_consume");
    case "refund":
      return t("credits_tx_refund");
    case "manual_adjustment":
      return t("credits_tx_manual");
  }
}

function BalanceCard({
  balance,
  loading,
  unauth,
  unit,
  label,
}: {
  balance: number | null;
  loading: boolean;
  unauth: boolean;
  unit: string;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl border border-[#eadfcb] bg-gradient-to-br from-[#fbf6e7] to-[#fdf8e9] p-6"
      style={{ boxShadow: "0 18px 40px rgba(174,110,35,.08)" }}
    >
      <div className="text-[13px] text-[#876c3a]">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[44px] font-light tracking-[-1.5px] text-[#171717]">
          {loading ? "…" : unauth ? "—" : (balance ?? 0)}
        </span>
        <span className="text-[14px] text-[#876c3a]">{unit}</span>
      </div>
    </div>
  );
}

function PlansHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-2xl border border-[#e5edf5] bg-white p-6">
      <h2 className="text-[20px] font-semibold tracking-tight md:text-[22px]">
        {title}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-[#64748d]">
        {subtitle}
      </p>
    </div>
  );
}

function PlanCard({
  nameKey,
  priceKey,
  quotaKey,
  unitKey,
  descKey,
  onContact,
  isFree,
  highlight,
}: {
  nameKey: DictKey;
  priceKey: DictKey;
  quotaKey: DictKey;
  unitKey: DictKey;
  descKey: DictKey;
  onContact?: () => void;
  isFree?: boolean;
  highlight?: boolean;
}) {
  const { t } = useLang();
  return (
    <div
      className={`relative rounded-2xl border p-5 transition-shadow ${
        highlight
          ? "border-[#533afd] bg-white shadow-[0_18px_50px_rgba(83,58,253,.12)]"
          : "border-[#e5edf5] bg-white"
      }`}
    >
      <div className="text-[13px] uppercase tracking-[0.18em] text-[#94a3b8]">
        {t(nameKey)}
      </div>
      {/* 价格 */}
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[32px] font-semibold tracking-[-1px] text-[#061b31]">
          {t(priceKey)}
        </span>
        <span className="text-[14px] text-[#94a3b8]">/ {t(quotaKey)}</span>
      </div>
      {/* 单价 */}
      <div className="mt-1 text-[12px] font-medium text-[#876c3a]">
        {t(unitKey)}
      </div>
      <p className="mt-2 min-h-[42px] text-[13px] text-[#64748d]">
        {t(descKey)}
      </p>
      {isFree ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {t("plan_btn_active")}
        </div>
      ) : (
        <button
          onClick={onContact}
          className={`mt-4 w-full rounded-md px-4 py-2 text-[13px] font-medium transition-colors ${
            highlight
              ? "bg-[#533afd] text-white hover:bg-[#4434d4]"
              : "bg-[#171717] text-white hover:bg-black"
          }`}
        >
          {t("plan_btn_contact")}
        </button>
      )}
    </div>
  );
}
