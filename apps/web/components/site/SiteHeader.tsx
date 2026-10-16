"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { List, UserCircle, X } from "@phosphor-icons/react";
import { FluidWordmark } from "@/components/brand/FluidWordmark";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { useSessionUser } from "@/components/auth/useSessionUser";
import { notifySessionExpired } from "@/components/auth/session-events";

export function SiteHeader({ active }: { active?: "cases" | "help" | "credits" | "my" | "video" | "developers" | "account" }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountMenuId = useId();
  const user = useSessionUser();
  const accountLabel = user === null ? t("nav_login") : (
    user?.name || user?.email?.split("@")[0] ||
    (user?.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : "") ||
    (lang === "zh" ? "我的账户" : "My account")
  );
  const accountTitle = user ? `${lang === "zh" ? "账户" : "Account"}: ${accountLabel}` : accountLabel;
  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: Event) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) throw new Error("sign_out_failed");
      notifySessionExpired();
      setAccountOpen(false);
      setOpen(false);
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }
  // Keep the public navigation focused on API setup and WorkBuddy integration.
  const links = [
    { href: "/developers", label: t("gallery_guide"), key: "developers" },
    { href: "/account", label: lang === "zh" ? "API 密钥" : "API keys", key: "account" },
    { href: "/help", label: t("nav_help"), key: "help" },
  ];
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand-link" aria-label={lang === "zh" ? "创境首页" : "Lampstage home"}>
          <FluidWordmark />
        </Link>
        <nav className="site-nav" aria-label={lang === "zh" ? "主导航" : "Main navigation"}>
          {links.map((link) => <Link key={link.href} href={link.href} aria-current={active === link.key ? "page" : undefined}>{link.label}</Link>)}
        </nav>
        <div className="site-header-actions">
          <LangToggle className="gallery-language" />
          {user === null ? <Link href="/account" className="header-account header-account-anonymous" title={accountTitle} aria-label={accountTitle}><span className="header-account-label">{accountLabel}</span><UserCircle className="header-account-icon" size={24} aria-hidden="true" /></Link> :
            <div className="header-account-control" ref={accountRef}>
              <button ref={accountTrigger} type="button" className="header-account" title={accountTitle}
                aria-label={`${accountTitle} · ${lang === "zh" ? "打开账户菜单" : "Open account menu"}`}
                aria-expanded={accountOpen} aria-controls={accountOpen ? accountMenuId : undefined}
                onClick={() => { setOpen(false); setSignOutError(false); setAccountOpen(value => !value); }}>
                <span className="header-account-label">{accountLabel}</span><UserCircle className="header-account-icon" size={24} aria-hidden="true" />
              </button>
              {accountOpen && <nav id={accountMenuId} className="account-popover" aria-label={lang === "zh" ? "账户菜单" : "Account menu"}>
                <Link href="/account" onClick={() => setAccountOpen(false)}>{lang === "zh" ? "账户中心" : "Account center"}</Link>
                <Link href="/account#billing" onClick={() => setAccountOpen(false)}>{lang === "zh" ? "余额与充值" : "Balance & recharge"}</Link>
                <button type="button" onClick={() => void signOut()} disabled={signingOut} aria-busy={signingOut}>
                  {signingOut ? (lang === "zh" ? "退出中…" : "Signing out…") : (lang === "zh" ? "退出登录" : "Sign out")}
                </button>
                {signOutError && <p role="alert" className="account-popover-error">{lang === "zh" ? "退出失败，请重试。" : "Could not sign out. Try again."}</p>}
              </nav>}
            </div>}
          <button type="button" className="icon-button mobile-menu-button" aria-label={open ? t("login_close") : (lang === "zh" ? "打开导航" : "Open navigation")}
            aria-expanded={open} aria-controls="mobile-navigation" onClick={() => { setAccountOpen(false); setOpen(!open); }}>{open ? <X size={21} /> : <List size={21} />}</button>
        </div>
      </div>
      {open && <nav id="mobile-navigation" className="mobile-navigation" aria-label={lang === "zh" ? "手机导航" : "Mobile navigation"}>
        {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        <Link href="/developers" className="mobile-workspace-link" onClick={() => setOpen(false)}>{t("nav_connect")}</Link>
      </nav>}
    </header>
  );
}
