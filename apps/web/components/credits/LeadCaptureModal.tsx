"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export type LeadSource =
  | "workspace_quota_modal"
  | "credits_page_basic"
  | "credits_page_business"
  | "credits_page_factory"
  | "homepage_cta"
  | "other";

type Props = {
  open: boolean;
  source: LeadSource;
  onClose: () => void;
};

export function LeadCaptureModal({ open, source, onClose }: Props) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [wechat, setWechat] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setWechat("");
      setPhone("");
      setMessage("");
      setPending(false);
      setError(null);
      setDone(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    if (!wechat.trim() && !phone.trim()) {
      setError(t("lead_err_need_contact"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/contact-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source,
          contact_type: wechat.trim() ? "wechat" : "phone",
          name: name.trim() || null,
          wechat: wechat.trim() || null,
          phone: phone.trim() || null,
          message: message.trim() || null,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(t("lead_err_generic") + (data.error || r.status));
        return;
      }
      setDone(true);
    } catch (e) {
      setError(t("lead_err_generic") + String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:m-4 sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!done ? (
          <>
            <h2 className="text-[20px] font-semibold tracking-tight">
              {t("lead_title")}
            </h2>
            <p className="mt-1 text-[13px] text-[#64748d]">{t("lead_subtitle")}</p>

            {/* 直接扫码加客服 */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#eee] bg-[#fafafa] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={BRAND.wechatQr}
                alt="WeChat QR"
                className="h-24 w-24 flex-none rounded-lg bg-white object-contain"
              />
              <div className="text-[13px] leading-relaxed text-[#374151]">
                <div className="font-semibold text-[#171717]">
                  {t("lead_scan_title")}
                </div>
                <div className="mt-0.5 text-[#64748d]">
                  {t("lead_scan_desc")}
                </div>
                <div className="mt-1 text-[12px] text-[#94a3b8]">
                  {t("lead_wechat_id")}：{BRAND.wechat}
                </div>
              </div>
            </div>

            <div className="my-4 flex items-center gap-3 text-[12px] text-[#aaa]">
              <span className="h-px flex-1 bg-[#eee]" />
              {t("lead_or_leave")}
              <span className="h-px flex-1 bg-[#eee]" />
            </div>

            <div className="space-y-3">
              <Field
                label={t("lead_label_name")}
                value={name}
                onChange={setName}
              />
              <Field
                label={t("lead_label_wechat")}
                value={wechat}
                onChange={setWechat}
              />
              <Field
                label={t("lead_label_phone")}
                value={phone}
                onChange={setPhone}
                inputMode="tel"
              />
              <div>
                <label className="mb-1 block text-[12px] font-medium text-[#273951]">
                  {t("lead_label_message")}
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("lead_placeholder_message")}
                  rows={3}
                  className="w-full rounded-md border border-[#e5edf5] px-3 py-2 text-[13px] outline-none focus:border-[#533afd]"
                />
              </div>
            </div>

            {error && (
              <p className="mt-3 text-[13px] text-red-600">{error}</p>
            )}
            <button
              onClick={submit}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("lead_btn_submitting") : t("lead_btn_submit")}
            </button>
          </>
        ) : (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-[18px] font-semibold tracking-tight">
              {t("lead_success_title")}
            </h2>
            <p className="mt-2 text-[13px] text-[#64748d]">
              {t("lead_success_body")}
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-md bg-[#171717] px-4 py-2.5 font-medium text-white"
            >
              {t("lead_success_close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  inputMode?: "tel" | "email" | "text";
}) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-[#273951]">
        {label}
      </label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[#e5edf5] px-3 py-2 text-[14px] outline-none focus:border-[#533afd]"
      />
    </div>
  );
}
