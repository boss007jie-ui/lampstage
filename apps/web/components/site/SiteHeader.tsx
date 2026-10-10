"use client";

import Link from "next/link";
import { useState } from "react";
import { List, X } from "@phosphor-icons/react";
import { BrandMark } from "@/components/brand/BrandMark";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export function SiteHeader({ active }: { active?: "cases" | "help" | "credits" | "my" | "video" | "developers" }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/cases", label: t("nav_showcase"), key: "cases" },
    { href: "/video-workspace", label: lang === "zh" ? "视频工作台" : "Video workspace", key: "video" },
    { href: "/developers", label: t("nav_developers"), key: "developers" },
    { href: "/#how-it-works", label: t("nav_product"), key: "how" },
    { href: "/credits", label: t("nav_pricing"), key: "credits" },
    { href: "/help", label: t("nav_help"), key: "help" },
  ];
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand-link" aria-label={lang === "zh" ? "创境首页" : "Lampstage home"}>
          <BrandMark size={30} onLight />
          <span>{lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}</span>
        </Link>
        <nav className="site-nav" aria-label={lang === "zh" ? "主导航" : "Main navigation"}>
          {links.map((link) => <Link key={link.href} href={link.href} aria-current={active === link.key ? "page" : undefined}>{link.label}</Link>)}
        </nav>
        <div className="site-header-actions">
          <LangToggle />
          <Link href="/workspace" className="btn btn-outline header-workspace">{t("nav_generate")}</Link>
          <button type="button" className="icon-button mobile-menu-button" aria-label={open ? t("login_close") : (lang === "zh" ? "打开导航" : "Open navigation")}
            aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <List size={21} />}</button>
        </div>
      </div>
      {open && <nav id="mobile-navigation" className="mobile-navigation" aria-label={lang === "zh" ? "手机导航" : "Mobile navigation"}>
        {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}
        <Link href="/my" onClick={() => setOpen(false)}>{t("my_title")}</Link>
        <Link href="/workspace" className="mobile-workspace-link" onClick={() => setOpen(false)}>{t("nav_generate")}</Link>
      </nav>}
    </header>
  );
}
