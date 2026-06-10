"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  onSignedIn: (info: {
    userId: string;
    isNewUser: boolean;
    creditBalance: number;
  }) => void;
};

type Step = "identifier" | "code";

export function LoginModal({ open, onClose, onSignedIn }: Props) {
  const { t } = useLang();
  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!open) {
      setStep("identifier");
      setIdentifier("");
      setCode("");
      setDevCode(null);
      setPending(false);
      setError(null);
      setResendIn(0);
    }
  }, [open]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const tm = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(tm);
  }, [resendIn]);

  if (!open) return null;

  const send = async () => {
    setError(null);
    if (!identifier.trim()) {
      setError(t("login_err_no_id"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.error === "rate_limited") {
          setError(t("login_err_rate"));
        } else if (data.error === "invalid_identifier") {
          setError(t("login_err_invalid_id"));
        } else {
          setError(t("login_err_send_generic") + (data.error || r.status));
        }
        return;
      }
      setStep("code");
      setDevCode(data.devCode || null);
      setResendIn(60);
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("login_err_code_format"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), code }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg =
          data.error === "wrong_code"
            ? t("login_err_wrong")
            : data.error === "expired"
              ? t("login_err_expired")
              : data.error === "no_code"
                ? t("login_err_no_code")
                : t("login_err_verify_generic") + (data.error || r.status);
        setError(msg);
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: data.is_new_user,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">
              {t("login_title")}
            </h2>
            <p className="mt-1 text-[13px] text-[#64748d]">{t("login_desc")}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 rounded-full p-1 text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#061b31]"
            aria-label={t("login_close")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {step === "identifier" && (
          <>
            <label className="mb-2 block text-[13px] font-medium text-[#273951]">
              {t("login_label_id")}
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t("login_placeholder_id")}
              autoFocus
              className="w-full rounded-md border border-[#e5edf5] px-3 py-2.5 text-[14px] outline-none focus:border-[#533afd]"
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={send}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_sending") : t("login_btn_send")}
            </button>
            <p className="mt-3 text-[11px] text-[#94a3b8]">
              {t("login_dev_hint")}
            </p>
          </>
        )}

        {step === "code" && (
          <>
            <p className="mb-3 text-[13px] text-[#64748d]">
              {t("login_sent_to", { id: identifier.trim() })}
            </p>
            <label className="mb-2 block text-[13px] font-medium text-[#273951]">
              {t("login_label_code")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full rounded-md border border-[#e5edf5] px-3 py-2.5 text-center font-mono text-[18px] tracking-[0.4em] outline-none focus:border-[#533afd]"
              onKeyDown={(e) => e.key === "Enter" && verify()}
            />
            {devCode && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {t("login_dev_code")}{" "}
                <b className="font-mono">{devCode}</b>
              </p>
            )}
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={verify}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_verifying") : t("login_btn_verify")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  setStep("identifier");
                  setCode("");
                  setError(null);
                }}
                className="text-[#64748d] hover:underline"
              >
                {t("login_back")}
              </button>
              <button
                onClick={send}
                disabled={resendIn > 0 || pending}
                className="text-[#533afd] disabled:cursor-not-allowed disabled:text-[#94a3b8]"
              >
                {resendIn > 0
                  ? t("login_resend_in", { s: resendIn })
                  : t("login_resend")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
