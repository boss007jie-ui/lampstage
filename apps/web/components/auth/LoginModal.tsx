"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye, EyeSlash, X } from "@phosphor-icons/react";
import { Dialog } from "@/components/ui/Dialog";
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

type JsonRecord = Record<string, unknown>;

async function readJsonRecord(response: Response): Promise<JsonRecord | null> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : null;
  } catch {
    return null;
  }
}

export function LoginModal({ open, onClose, onSignedIn }: Props) {
  const { t, lang } = useLang();
  const [step, setStep] = useState<Step>("email-input");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const sessionRef = useRef(0);
  const openRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // A closed or replaced dialog invalidates every outstanding response.
  useLayoutEffect(() => {
    sessionRef.current += 1;
    openRef.current = open;
    if (!open) {
      setStep("email-input");
      setEmail("");
      setPassword("");
      setCode("");
      setDevCode(null);
      setPending(false);
      pendingRef.current = false;
      setError(null);
      setResendIn(0);
    }
    return () => {
      sessionRef.current += 1;
      openRef.current = false;
      pendingRef.current = false;
    };
  }, [open]);
  const close = () => {
    sessionRef.current += 1;
    openRef.current = false;
    pendingRef.current = false;
    onClose();
  };
  const beginRequest = () => {
    if (!openRef.current || pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    return sessionRef.current;
  };
  const current = (session: number) => openRef.current && sessionRef.current === session;
  const finishRequest = (session: number) => {
    if (!current(session)) return;
    pendingRef.current = false;
    setPending(false);
  };
  const changeStep = (next: Step) => {
    sessionRef.current += 1;
    pendingRef.current = false;
    setPending(false);
    setError(null);
    setStep(next);
  };

  // 重发倒计时
  useEffect(() => {
    if (resendIn <= 0) return;
    const tm = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(tm);
  }, [resendIn]);

  // ---------- Step 1: lookup email ----------
  const lookupEmail = async () => {
    if (!openRef.current || pendingRef.current) return;
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
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: id }),
      });
      // 后端异常时可能给出非 JSON 或空 body；直接 r.json() 会抛
      // “Unexpected end of JSON input”，把真实原因盖掉。
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data || typeof data.exists !== "boolean" || typeof data.hasPassword !== "boolean") {
        setError(
          r.status === 503 || data?.error === "service_unavailable"
            ? t("login_err_service_unavailable")
            : t("login_err_send_generic") + (data?.error || r.status),
        );
        return;
      }
      if (data.exists && data.hasPassword) {
        setStep("password-input");
      } else {
        setStep("register-set-password");
      }
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
    }
  };

  // ---------- Step 2a: sign in with password ----------
  const signInWithPassword = async () => {
    if (!openRef.current || pendingRef.current) return;
    setError(null);
    if (!password) {
      setError(t("login_err_no_password"));
      return;
    }
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data) {
        const msg =
          r.status === 503 || data?.error === "service_unavailable"
            ? t("login_err_service_unavailable")
            : data?.error === "wrong_password"
              ? t("login_err_wrong_password")
              : data?.error === "no_account"
                ? t("login_err_no_account")
                : t("login_err_verify_generic") + (data?.error || r.status);
        setError(msg);
        return;
      }
      if (typeof data.user_id !== "string" || typeof data.credit_balance !== "number") {
        setError(t("login_err_network") + String(r.status));
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: false,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
    }
  };

  // ---------- Step 2b: registration -> set password + send code ----------
  const sendRegisterCode = async () => {
    if (!openRef.current || pendingRef.current) return;
    setError(null);
    if (password.length < 6) {
      setError(t("login_err_weak_password"));
      return;
    }
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data) {
        if (r.status === 503 || data?.error === "service_unavailable") {
          setError(t("login_err_service_unavailable"));
        } else if (data?.error === "rate_limited") {
          setError(t("login_err_rate"));
        } else if (data?.error === "invalid_identifier") {
          setError(t("login_err_invalid_id"));
        } else {
          setError(t("login_err_send_generic") + (data?.error || r.status));
        }
        return;
      }
      if (data.sent !== true) {
        setError(t("login_err_network") + String(r.status));
        return;
      }
      setStep("register-verify-code");
      setDevCode(typeof data.devCode === "string" ? data.devCode : null);
      setResendIn(60);
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
    }
  };

  // ---------- Step 3: verify code & finish registration ----------
  const verifyAndRegister = async () => {
    if (!openRef.current || pendingRef.current) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("login_err_code_format"));
      return;
    }
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, code }),
      });
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data) {
        const msg =
          r.status === 503 || data?.error === "service_unavailable"
            ? t("login_err_service_unavailable")
            : data?.error === "wrong_code"
              ? t("login_err_wrong")
              : data?.error === "expired"
                ? t("login_err_expired")
                : data?.error === "no_code"
                  ? t("login_err_no_code")
                  : data?.error === "weak_password"
                    ? t("login_err_weak_password")
                    : data?.error === "already_registered"
                      ? t("login_err_already_registered")
                      : t("login_err_verify_generic") + (data?.error || r.status);
        setError(msg);
        return;
      }
      if (typeof data.user_id !== "string" || typeof data.credit_balance !== "number") {
        setError(t("login_err_network") + String(r.status));
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: true,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
    }
  };

  // ---------- Forgot password: send code & verify magic-link login ----------
  const sendForgotCode = async () => {
    if (!openRef.current || pendingRef.current) return;
    setError(null);
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim() }),
      });
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data) {
        if (r.status === 503 || data?.error === "service_unavailable") {
          setError(t("login_err_service_unavailable"));
        } else if (data?.error === "rate_limited") {
          setError(t("login_err_rate"));
        } else {
          setError(t("login_err_send_generic") + (data?.error || r.status));
        }
        return;
      }
      if (data.sent !== true) {
        setError(t("login_err_network") + String(r.status));
        return;
      }
      setStep("forgot-verify");
      setDevCode(typeof data.devCode === "string" ? data.devCode : null);
      setResendIn(60);
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
    }
  };

  const verifyForgotCode = async () => {
    if (!openRef.current || pendingRef.current) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("login_err_code_format"));
      return;
    }
    const session = beginRequest();
    if (session === null) return;
    try {
      const r = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: email.trim(), code }),
      });
      const data = await readJsonRecord(r);
      if (!current(session)) return;
      if (!r.ok || !data) {
        const msg =
          r.status === 503 || data?.error === "service_unavailable"
            ? t("login_err_service_unavailable")
            : data?.error === "wrong_code"
              ? t("login_err_wrong")
              : data?.error === "expired"
                ? t("login_err_expired")
                : t("login_err_verify_generic") + (data?.error || r.status);
        setError(msg);
        return;
      }
      if (typeof data.user_id !== "string" || typeof data.credit_balance !== "number" || typeof data.is_new_user !== "boolean") {
        setError(t("login_err_network") + String(r.status));
        return;
      }
      onSignedIn({
        userId: data.user_id,
        isNewUser: data.is_new_user,
        creditBalance: data.credit_balance,
      });
    } catch (e) {
      if (current(session)) setError(t("login_err_network") + String(e));
    } finally {
      finishRequest(session);
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
    <Dialog open={open} onClose={close} titleId="login-modal-title">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="login-modal-title" className="text-[20px] font-semibold tracking-tight">
              {headerTitle}
            </h2>
            <p className="mt-1 break-all text-[13px] text-[#6b7066]">
              {headerDesc}
            </p>
          </div>
          <button
            onClick={close}
            className="icon-button ml-3 text-[#6b7066]"
            aria-label={t("login_close")}
          >
            <X size={20} />
          </button>
        </div>

        {/* ---------- Step: email-input ---------- */}
        {step === "email-input" && (
          <>
            <label htmlFor="login-email" className="mb-2 block text-[13px] font-medium text-[#262924]">
              {t("login_label_id")}
            </label>
            <input
              id="login-email"
              name="email"
              autoComplete="email"
              type="email"
              value={email}
              disabled={pending}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login_placeholder_id")}
              autoFocus
              className="w-full rounded-md border border-[#e5e5de] px-3 py-2.5 text-[14px] outline-none focus:border-[#5b6350]"
              onKeyDown={(e) => e.key === "Enter" && lookupEmail()}
            />
            {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
            <button
              onClick={lookupEmail}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_checking") : t("login_btn_continue")}
            </button>
            <p className="mt-3 text-[11px] text-[#6b7066]">
              {t("login_hint_smart")}
            </p>
          </>
        )}

        {/* ---------- Step: password-input (existing user sign in) ---------- */}
        {step === "password-input" && (
          <>
            <label htmlFor="login-password" className="mb-2 block text-[13px] font-medium text-[#262924]">
              {t("login_label_password")}
            </label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={pending}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login_placeholder_password")}
                autoFocus
                className="w-full rounded-md border border-[#e5e5de] px-3 py-2.5 pr-10 text-[14px] outline-none focus:border-[#5b6350]"
                onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#6b7066] hover:text-[#5b6350]"
                aria-label={showPassword ? (lang === "zh" ? "隐藏密码" : "Hide password") : (lang === "zh" ? "显示密码" : "Show password")}
              >
                {showPassword ? <Eye size={18} /> : <EyeSlash size={18} />}
              </button>
            </div>
            {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
            <button
              onClick={signInWithPassword}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_signing_in") : t("login_btn_sign_in")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  changeStep("email-input");
                  setPassword("");
                }}
                disabled={pending}
                className="text-[#6b7066] hover:underline"
              >
                {t("login_back_email")}
              </button>
              <button
                onClick={sendForgotCode}
                disabled={pending}
                className="text-[#5b6350] hover:underline disabled:opacity-50"
              >
                {t("login_forgot_password")}
              </button>
            </div>
          </>
        )}

        {/* ---------- Step: register-set-password ---------- */}
        {step === "register-set-password" && (
          <>
            <label htmlFor="register-password" className="mb-2 block text-[13px] font-medium text-[#262924]">
              {t("login_label_set_password")}
            </label>
            <div className="relative">
              <input
                id="register-password"
                name="new-password"
                autoComplete="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={pending}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("login_placeholder_set_password")}
                autoFocus
                className="w-full rounded-md border border-[#e5e5de] px-3 py-2.5 pr-10 text-[14px] outline-none focus:border-[#5b6350]"
                onKeyDown={(e) => e.key === "Enter" && sendRegisterCode()}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#6b7066] hover:text-[#5b6350]"
                aria-label={showPassword ? (lang === "zh" ? "隐藏密码" : "Hide password") : (lang === "zh" ? "显示密码" : "Show password")}
              >
                {showPassword ? <Eye size={18} /> : <EyeSlash size={18} />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-[#6b7066]">
              {t("login_hint_password")}
            </p>
            {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
            <button
              onClick={sendRegisterCode}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_sending") : t("login_btn_send")}
            </button>
            <button
              onClick={() => {
                changeStep("email-input");
                setPassword("");
              }}
              disabled={pending}
              className="mt-3 w-full text-[12px] text-[#6b7066] hover:underline"
            >
              {t("login_back_email")}
            </button>
          </>
        )}

        {/* ---------- Step: register-verify-code ---------- */}
        {step === "register-verify-code" && (
          <>
            <label htmlFor="register-code" className="mb-2 block text-[13px] font-medium text-[#262924]">
              {t("login_label_code")}
            </label>
            <input
              id="register-code"
              name="one-time-code"
              autoComplete="one-time-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              disabled={pending}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full rounded-md border border-[#e5e5de] px-3 py-2.5 text-center font-mono text-[18px] tracking-[0.4em] outline-none focus:border-[#5b6350]"
              onKeyDown={(e) => e.key === "Enter" && verifyAndRegister()}
            />
            {devCode && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {t("login_dev_code")}{" "}
                <b className="font-mono">{devCode}</b>
              </p>
            )}
            {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
            <button
              onClick={verifyAndRegister}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_registering") : t("login_btn_register")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  changeStep("register-set-password");
                  setCode("");
                }}
                disabled={pending}
                className="text-[#6b7066] hover:underline"
              >
                {t("login_back")}
              </button>
              <button
                onClick={sendRegisterCode}
                disabled={resendIn > 0 || pending}
                className="text-[#5b6350] disabled:cursor-not-allowed disabled:text-[#6b7066]"
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
            <label htmlFor="forgot-code" className="mb-2 block text-[13px] font-medium text-[#262924]">
              {t("login_label_code")}
            </label>
            <input
              id="forgot-code"
              name="one-time-code"
              autoComplete="one-time-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              disabled={pending}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              autoFocus
              className="w-full rounded-md border border-[#e5e5de] px-3 py-2.5 text-center font-mono text-[18px] tracking-[0.4em] outline-none focus:border-[#5b6350]"
              onKeyDown={(e) => e.key === "Enter" && verifyForgotCode()}
            />
            {devCode && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {t("login_dev_code")}{" "}
                <b className="font-mono">{devCode}</b>
              </p>
            )}
            {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
            <button
              onClick={verifyForgotCode}
              disabled={pending}
              className="mt-4 w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
            >
              {pending ? t("login_btn_verifying") : t("login_btn_verify")}
            </button>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button
                onClick={() => {
                  changeStep("password-input");
                  setCode("");
                }}
                disabled={pending}
                className="text-[#6b7066] hover:underline"
              >
                {t("login_back")}
              </button>
              <button
                onClick={sendForgotCode}
                disabled={resendIn > 0 || pending}
                className="text-[#5b6350] disabled:cursor-not-allowed disabled:text-[#6b7066]"
              >
                {resendIn > 0
                  ? t("login_resend_in", { s: resendIn })
                  : t("login_resend")}
              </button>
            </div>
          </>
        )}
    </Dialog>
  );
}
