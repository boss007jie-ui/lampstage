"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export function SiteFooter() {
  const { t, lang } = useLang();
  return <footer className="site-footer">
    <div><strong>lampstage{lang === "zh" ? " · 创境" : ""}</strong><p>{t("gallery_footer")}</p></div>
    <nav aria-label={lang === "zh" ? "页脚导航" : "Footer navigation"}>
      <Link href="/developers">{t("nav_developers")}</Link><Link href="/help">{t("nav_help")}</Link><Link href="/account">{lang === "zh" ? "API 密钥" : "API keys"}</Link>
      <Link href="/privacy">{t("footer_privacy")}</Link><Link href="/terms">{t("footer_terms")}</Link>
    </nav>
    <div className="footer-base"><small>© {new Date().getFullYear()} {BRAND.en} · {BRAND.domain}</small>
    </div>
  </footer>;
}
