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

/**
 * 登录窗状态机:
 *   email-input  ─┬─ exists+hasPassword ─→ password-input          (登录)
 *                 ├─ exists+noPassword  ─→ register-set-password   (老 magic-link 用户升级)
 *                 └─ !exists            ─→ register-set-password   (新注册)
 *
 *   register-set-password ─→ register-verify-code (输入设置的密码 + 发送验证码 → 验证)
 *   password-input ─→ "忘记密码？" ─→ forgot-verify (走 magic-link 重置 / 直接登录)
 */
type Step =
  | "email-input"
  | "password-input"
  | "register-set-password"
  | "register-verify-code"
  | "forgot-verify";

export function LoginModal({ open, onClose, onSignedIn }: Props) {
  const { t } = useLang();
  const [step, setStep] = useState<Step>("email-input");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // 重置：modal 关闭时
  useEffect(() => {
    if (!open) {
      setStep("email-input");
      setEmail("");
      setPassword("");
      setCode("");
      setDevCode(null);
      setPending(false);
      setError(null);
      setResendIn(0);
    }
  }, [open]);

  // 重发倒计时
  useEffect(() => {
    if (resendIn <= 0) return;
    const tm = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(tm);
  }, [resendIn]);

  if (!open) return null;

  // ---------- Step 1: lookup email ----------
  const lookupEmail = async () => {
    setError(null);
    const id = email.trim();
    if (!id) {
      setError(t("login_err_no_id"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) {
      setError(t("login_err_invalid_id"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: id }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(t("login_err_send_generic") + (data.error || r.status));
        return;
      }
      if (data.exists && data.hasPassword) {
        setStep("password-input");
      } else {
        setStep("register-set-password");
      }
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  // ---------- Step 2a: sign in with password ----------
  const signInWithPassword = async () => {
    setError(null);
    if (!password) {
      setError(t("login_err_no_password"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg =
          data.error === "wrong_password"
            ? t("login_err_wrong_password")
            : data.error === "no_account"
              ? t("login_err_no_account")
              : t("login_err_verify_generic") + (data.error || r.status);
        setError(msg);
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: false,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  // ---------- Step 2b: registration -> set password + send code ----------
  const sendRegisterCode = async () => {
    setError(null);
    if (password.length < 6) {
      setError(t("login_err_weak_password"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
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
      setStep("register-verify-code");
      setDevCode(data.devCode || null);
      setResendIn(60);
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  // ---------- Step 3: verify code & finish registration ----------
  const verifyAndRegister = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("login_err_code_format"));
      return;
    }
    setPending(true);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, code }),
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
                : data.error === "weak_password"
                  ? t("login_err_weak_password")
                  : data.error === "already_registered"
                    ? t("login_err_already_registered")
                    : t("login_err_verify_generic") + (data.error || r.status);
        setError(msg);
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: true,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  // ---------- Forgot password: send code & verify magic-link login ----------
  const sendForgotCode = async () => {
    setError(null);
    setPending(true);
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.error === "rate_limited") {
          setError(t("login_err_rate"));
        } else {
          setError(t("login_err_send_generic") + (data.error || r.status));
        }
        return;
      }
      setStep("forgot-verify");
      setDevCode(data.devCode || null);
      setResendIn(60);
    } catch (e) {
      setError(t("login_err_network") + String(e));
    } finally {
      setPending(false);
    }
  };

  const verifyForgotCode = async () => {
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
        body: JSON.stringify({ identifier: email.trim(), code }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg =
          data.error === "wrong_code"
            ? t("login_err_wrong")
            : data.error === "expired"
              ? t("login_err_expired")
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

  // ---------- Header ----------
  const headerTitle =
    step === "email-input"
      ? t("login_title")
      : step === "password-input"
        ? t("login_title_signin")
        : step === "register-set-password" || step === "register-verify-code"
          ? t("login_title_register")
          : t("login_title_forgot");
  const headerDesc =
    step === "email-input"
      ? t("login_desc")
      : step === "password-input"
        ? `${t("login_signin_for")} ${email}`
        : step === "register-set-password"
          ? `${t("login_register_for")} ${email}`
          : step === "register-verify-code"
            ? t("login_sent_to", { id: email.trim() })
            : t("login_sent_to", { id: email.trim() });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center"
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:m-4 sm:max-w-md sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">
              {headerTitle}
            </h2>
            <p className="mt-1 break-all text-[13px] text-[#64748d]">
              {headerDesc}
            </p>
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

        {/* ---------- Step: email-input ---------- */}
        {step === "email-input" && (
          <>
            <label className="mb-2 block text-[13px] font-medium text-[#273951]">
              {t("login_label_id")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login_placeholder_id")}
              autoFocus
              className="w-full rounded-md border border-[#e5edf5] px-3 py-2.5 text-[14px] outline-none focus:border-[#533afd]"
              onKeyDown={(e) => e.key === "Enter" && lookupEmail()}
            />
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={lookupEmail}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_checking") : t("login_btn_continue")}
            </button>
            <p className="mt-3 text-[11px] text-[#94a3b8]">
              {t("login_hint_smart")}
            </p>
          </>
        )}

        {/* ---------- Step: password-input (existing user sign in) ---------- */}
        {step === "password-input" && (
          <>
            <label className="mb-2 block text-[13px] font-medium text-[#273951]">
              {t("login_label_password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login_placeholder_password")}
              autoFocus
              className="w-full rounded-md border border-[#e5edf5] px-3 py-2.5 text-[14px] outline-none focus:border-[#533afd]"
              onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
            />
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={signInWithPassword}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_signing_in") : t("login_btn_sign_in")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  setStep("email-input");
                  setPassword("");
                  setError(null);
                }}
                className="text-[#64748d] hover:underline"
              >
                {t("login_back_email")}
              </button>
              <button
                onClick={sendForgotCode}
                disabled={pending}
                className="text-[#533afd] hover:underline disabled:opacity-50"
              >
                {t("login_forgot_password")}
              </button>
            </div>
          </>
        )}

        {/* ---------- Step: register-set-password ---------- */}
        {step === "register-set-password" && (
          <>
            <label className="mb-2 block text-[13px] font-medium text-[#273951]">
              {t("login_label_set_password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login_placeholder_set_password")}
              autoFocus
              className="w-full rounded-md border border-[#e5edf5] px-3 py-2.5 text-[14px] outline-none focus:border-[#533afd]"
              onKeyDown={(e) => e.key === "Enter" && sendRegisterCode()}
            />
            <p className="mt-1.5 text-[11px] text-[#94a3b8]">
              {t("login_hint_password")}
            </p>
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={sendRegisterCode}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_sending") : t("login_btn_send")}
            </button>
            <button
              onClick={() => {
                setStep("email-input");
                setPassword("");
                setError(null);
              }}
              className="mt-3 w-full text-[12px] text-[#64748d] hover:underline"
            >
              {t("login_back_email")}
            </button>
          </>
        )}

        {/* ---------- Step: register-verify-code ---------- */}
        {step === "register-verify-code" && (
          <>
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
              onKeyDown={(e) => e.key === "Enter" && verifyAndRegister()}
            />
            {devCode && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {t("login_dev_code")}{" "}
                <b className="font-mono">{devCode}</b>
              </p>
            )}
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={verifyAndRegister}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_registering") : t("login_btn_register")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  setStep("register-set-password");
                  setCode("");
                  setError(null);
                }}
                className="text-[#64748d] hover:underline"
              >
                {t("login_back")}
              </button>
              <button
                onClick={sendRegisterCode}
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

        {/* ---------- Step: forgot-verify (magic-link fallback login) ---------- */}
        {step === "forgot-verify" && (
          <>
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
              onKeyDown={(e) => e.key === "Enter" && verifyForgotCode()}
            />
            {devCode && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {t("login_dev_code")}{" "}
                <b className="font-mono">{devCode}</b>
              </p>
            )}
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
            <button
              onClick={verifyForgotCode}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_verifying") : t("login_btn_verify")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  setStep("password-input");
                  setCode("");
                  setError(null);
                }}
                className="text-[#64748d] hover:underline"
              >
                {t("login_back")}
              </button>
              <button
                onClick={sendForgotCode}
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
