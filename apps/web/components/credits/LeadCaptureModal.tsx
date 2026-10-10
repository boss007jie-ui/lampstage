"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LangProvider";
import { Dialog } from "@/components/ui/Dialog";
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
  const { t, lang } = useLang();
  const [name, setName] = useState("");
  const [wechat, setWechat] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const session = useRef(0);
  const submitting = useRef(false);

  useEffect(() => {
    session.current += 1;
    submitting.current = false;
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

  const submit = async () => {
    if (submitting.current) return;
    setError(null);
    if (!wechat.trim() && !phone.trim()) {
      setError(t("lead_err_need_contact"));
      return;
    }
    setPending(true);
    submitting.current = true;
    const currentSession = session.current;
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
        if (currentSession === session.current) setError(t("lead_err_generic"));
        return;
      }
      if (currentSession === session.current) setDone(true);
    } catch {
      if (currentSession === session.current) setError(t("lead_err_generic"));
    } finally {
      if (currentSession === session.current) {
        setPending(false);
        submitting.current = false;
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} titleId="lead-title">
      <button type="button" className="icon-button absolute right-3 top-3" onClick={onClose} aria-label={lang === "zh" ? "关闭咨询" : "Close enquiry"}><X size={20} /></button>
        {!done ? (
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <h2 id="lead-title" className="pr-8 text-[22px] font-semibold tracking-tight">
              {t("lead_title")}
            </h2>
            <p className="mt-2 text-[14px] text-[#6b7066]">{t("lead_subtitle")}</p>

            {/* 直接扫码加客服 */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#e5e5de] bg-[#f5f5ef] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={BRAND.wechatQr}
                alt="WeChat QR"
                className="h-24 w-24 flex-none rounded-lg bg-white object-contain"
              />
              <div className="text-[13px] leading-relaxed text-[#454a40]">
                <div className="font-semibold text-[#262924]">
                  {t("lead_scan_title")}
                </div>
                <div className="mt-0.5 text-[#6b7066]">
                  {t("lead_scan_desc")}
                </div>
              </div>
            </div>

            <div className="my-4 flex items-center gap-3 text-[12px] text-[#6b7066]">
              <span className="h-px flex-1 bg-[#e5e5de]" />
              {t("lead_or_leave")}
              <span className="h-px flex-1 bg-[#e5e5de]" />
            </div>

            <div className="space-y-3">
              <Field
                id="lead-name"
                label={t("lead_label_name")}
                value={name}
                onChange={setName}
              />
              <Field
                id="lead-wechat"
                label={t("lead_label_wechat")}
                value={wechat}
                onChange={setWechat}
              />
              <Field
                id="lead-phone"
                label={t("lead_label_phone")}
                value={phone}
                onChange={setPhone}
                inputMode="tel"
              />
              <div>
                <label htmlFor="lead-message" className="mb-1 block text-[13px] font-medium text-[#262924]">
                  {t("lead_label_message")}
                </label>
                <textarea
                  id="lead-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("lead_placeholder_message")}
                  rows={3}
                  className="w-full rounded-lg border border-[#e5e5de] px-3 py-2 text-[14px] focus:border-[#5b6350]"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-[13px] text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="btn btn-primary mt-4 w-full disabled:opacity-50"
            >
              {pending ? t("lead_btn_submitting") : t("lead_btn_submit")}
            </button>
          </form>
        ) : (
          <div className="py-2 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <Check size={24} weight="bold" />
            </div>
            <h2 id="lead-title" className="text-[22px] font-semibold tracking-tight">
              {t("lead_success_title")}
            </h2>
            <p className="mt-2 text-[13px] text-[#6b7066]">
              {t("lead_success_body")}
            </p>
            <button
              onClick={onClose}
              className="btn btn-primary mt-5 w-full"
            >
              {t("lead_success_close")}
            </button>
          </div>
        )}
    </Dialog>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (s: string) => void;
  inputMode?: "tel" | "email" | "text";
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-[#262924]">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#e5e5de] px-3 py-2 text-[14px] focus:border-[#5b6350]"
      />
    </div>
  );
}
