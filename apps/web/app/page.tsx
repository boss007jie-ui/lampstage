"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowRight, UploadSimple, Cube, Image as ImageIcon } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { LeadCaptureModal } from "@/components/credits/LeadCaptureModal";
import { useLang } from "@/components/i18n/LangProvider";
import { SCENE_EXAMPLES } from "@/lib/scene-examples";

export default function HomePage() {
  const { t } = useLang();
  const [contactOpen, setContactOpen] = useState(false);
  return <><SiteHeader /><main>
    <section className="home-intro page-container">
      <div><span className="home-eyebrow">{t("hero_badge")}</span><h1>{t("hero_title")}</h1><p>{t("hero_subtitle")}</p></div>
      <Link href="/workspace" className="btn btn-primary home-upload">{t("hero_cta_primary")}<ArrowRight size={22} aria-hidden /></Link>
    </section>
    <section className="home-gallery" aria-label={t("sample_label")}>
      <div className="gallery-label">{t("sample_label")}</div>
      <div className="home-gallery-grid">{SCENE_EXAMPLES.slice(0, 3).map((scene, index) => <Link href={`/cases?scene=${scene.id}`} className={`scene-photo scene-photo-${index}`} key={scene.id} aria-label={`${t(scene.title)} · ${t("cases_detail")}`}>
        <Image src={scene.src} alt={t(scene.title)} fill priority={index === 0} sizes={index === 0 ? "(max-width: 639px) 100vw, 64vw" : "(max-width: 639px) 50vw, 36vw"} /><span className="scene-photo-label">{t(scene.title)}</span>
      </Link>)}</div>
    </section>
    <section id="how-it-works" className="home-how page-container">
      <div><h2>{t("how_title")}</h2><p>{t("sample_note")}</p></div>
      <ol><li><span className="step-icon"><UploadSimple size={24} aria-hidden /></span><span>{t("how_step1_title")}</span></li>
        <li><ArrowRight className="step-arrow" size={20} aria-hidden /><span className="step-icon"><Cube size={24} aria-hidden /></span><span>{t("how_step2_title")}</span></li>
        <li><ArrowRight className="step-arrow" size={20} aria-hidden /><span className="step-icon"><ImageIcon size={24} aria-hidden /></span><span>{t("how_step3_title")}</span></li></ol>
    </section>
    <section className="home-preparation page-container">
      <div><span className="section-kicker">{t("ws_step_upload")}</span><h2>{t("home_prepare_title")}</h2></div>
      <div><p>{t("home_prepare_body")}</p><Link href="/help#images" className="text-link">{t("home_prepare_link")}<ArrowRight size={17} aria-hidden /></Link></div>
    </section>
    <section className="home-start page-container"><div><h2>{t("home_bottom_title")}</h2><p>{t("home_bottom_body")}</p></div>
      <div className="home-start-actions"><Link href="/workspace" className="btn btn-primary">{t("hero_cta_primary")}<ArrowRight size={19} aria-hidden /></Link><button type="button" onClick={() => setContactOpen(true)} className="text-link">{t("home_contact")}</button></div>
    </section>
  </main><SiteFooter /><LeadCaptureModal open={contactOpen} source="homepage_cta" onClose={() => setContactOpen(false)} /></>;
}
