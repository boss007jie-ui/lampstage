"use client";

import Link from "next/link";
import { useState } from "react";
import { List, X } from "@phosphor-icons/react";
import { FluidWordmark } from "@/components/brand/FluidWordmark";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";

export function SiteHeader({ active }: { active?: "cases" | "help" | "credits" | "my" | "video" | "developers" | "account" }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
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
          <Link href="/account" className="header-account">{t("nav_login")}</Link>
          <button type="button" className="icon-button mobile-menu-button" aria-label={open ? t("login_close") : (lang === "zh" ? "打开导航" : "Open navigation")}
            aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <List size={21} />}</button>
        </div>
      </div>
      {open && <nav id="mobile-navigation" className="mobile-navigation" aria-label={lang === "zh" ? "手机导航" : "Mobile navigation"}>
        {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        <Link href="/developers" className="mobile-workspace-link" onClick={() => setOpen(false)}>{t("nav_connect")}</Link>
      </nav>}
    </header>
  );
}
