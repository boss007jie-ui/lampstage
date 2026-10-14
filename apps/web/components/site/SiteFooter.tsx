"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";
import { Pause, Play } from "@phosphor-icons/react";
import { useBrandMotion } from "@/components/brand/BrandMotion";

export function SiteFooter() {
  const { t, lang } = useLang();
  const motion = useBrandMotion();
  return <footer className="site-footer">
    <div><strong>lampstage{lang === "zh" ? " · 创境" : ""}</strong><p>{t("gallery_footer")}</p></div>
    <nav aria-label={lang === "zh" ? "页脚导航" : "Footer navigation"}>
      <Link href="/developers">{t("nav_developers")}</Link><Link href="/help">{t("nav_help")}</Link><Link href="/account">{lang === "zh" ? "API 密钥" : "API keys"}</Link>
      <Link href="/privacy">{t("footer_privacy")}</Link><Link href="/terms">{t("footer_terms")}</Link>
    </nav>
    <div className="footer-base"><small>© {new Date().getFullYear()} {BRAND.en} · {BRAND.domain}</small>
      <button type="button" className="motion-control" onClick={motion.toggle} aria-pressed={motion.enabled}>
        {motion.enabled ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
        {t(motion.enabled ? "gallery_motion_pause" : "gallery_motion_play")}
      </button>
    </div>
  </footer>;
}
