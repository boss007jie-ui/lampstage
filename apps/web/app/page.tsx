"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Play, X } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import styles from "./home.module.css";

type Study = "image" | "product" | "motion";

export default function HomePage() {
  const { t, lang } = useLang();
  const [study, setStudy] = useState<Study | null>(null);
  const studyTitle = t(study === "motion" ? "gallery_motion_note" : study === "product" ? "gallery_product" : "gallery_images");

  return <>
    <SiteHeader />
    <main id="main-content" className={styles.home}>
      <section className={styles.intro} aria-labelledby="gallery-title">
        <h1 id="gallery-title" className={lang === "en" ? styles.englishTitle : undefined}>
          <span>{t("gallery_headline_first")}</span><span>{t("gallery_headline_second")}</span>
        </h1>
        <div className={styles.introSide}>
          <p>{t("gallery_intro")}</p>
          <div className={styles.actions}>
            <Link href="/developers" className={styles.primary}>{t("gallery_connect")}<ArrowUpRight size={20} aria-hidden /></Link>
            <Link href="/developers#quickstart" className={styles.secondary}>{t("gallery_read_guide")}<ArrowRight size={19} aria-hidden /></Link>
          </div>
        </div>
      </section>

      <section className={styles.gallery} aria-label={t("gallery_label")}>
        <figure className={styles.heroFigure}>
          <button type="button" className={styles.photo} onClick={() => setStudy("image")} aria-label={t("gallery_view_image")}>
            <Image src="/brand-gallery/campaign-bottle.webp" alt={t("gallery_bottle_alt")} fill priority sizes="(max-width: 700px) 92vw, 60vw" />
          </button>
          <figcaption><span><b>01</b>{t("gallery_label")}</span><span>/ &nbsp; {t("gallery_images")}</span></figcaption>
        </figure>
        <div className={styles.sideGallery}>
          <figure>
            <button type="button" className={styles.photo} onClick={() => setStudy("product")} aria-label={t("gallery_view_product")}>
              <Image src="/brand-gallery/sculptural-lamp.webp" alt={t("gallery_lamp_alt")} fill priority sizes="(max-width: 700px) 92vw, 36vw" />
            </button>
            <figcaption><span><b>02</b>{t("gallery_label")}</span><span>/ &nbsp; {t("gallery_product")}</span></figcaption>
          </figure>
          <figure>
            <button type="button" className={`${styles.photo} ${styles.motionPhoto}`} onClick={() => setStudy("motion")} aria-label={t("gallery_play_video")}>
              <Image src="/brand-gallery/lamp-film-poster.webp" alt={t("gallery_film_alt")} fill sizes="(max-width: 700px) 92vw, 36vw" />
              <span className={styles.play}><Play size={27} weight="fill" aria-hidden /></span>
              <span className={styles.duration} aria-hidden>00:08</span>
            </button>
            <figcaption><span><b>03</b>{t("gallery_film_label")}</span><span>/ &nbsp; {t("gallery_video")}</span></figcaption>
          </figure>
        </div>
      </section>

      <section id="how-it-works" className={styles.next}>
        <h2>{t("gallery_next_title")}</h2>
        <p>{t("gallery_next_body")}</p>
        <Link href="/developers#quickstart" className={styles.nextLink} aria-label={t("gallery_read_guide")}><ArrowUpRight size={32} aria-hidden /></Link>
      </section>
    </main>
    <SiteFooter />

    <Dialog open={study !== null} onClose={() => setStudy(null)} titleId="study-title" className={styles.studyDialog}>
      <div className={styles.studyHeading}>
        <div><span>{t(study === "motion" ? "gallery_film_label" : "gallery_label")}</span><h2 id="study-title">{studyTitle}</h2></div>
        <button type="button" className="icon-button" onClick={() => setStudy(null)} aria-label={t("gallery_close")}><X size={23} aria-hidden /></button>
      </div>
      {study === "motion" ? <video className={styles.studyVideo} src="/brand-gallery/lamp-day-to-light.mp4" poster="/brand-gallery/lamp-film-poster.webp" controls autoPlay muted playsInline tabIndex={0} aria-label={t("gallery_motion_note")} aria-describedby="study-note" /> :
        <Image src={study === "product" ? "/brand-gallery/sculptural-lamp.webp" : "/brand-gallery/campaign-bottle.webp"} alt={t(study === "product" ? "gallery_lamp_alt" : "gallery_bottle_alt")} width={study === "product" ? 1200 : 1322} height={study === "product" ? 800 : 1190} className={styles.studyImage} />}
      <p id="study-note" className={styles.studyNote}>{t(study === "motion" ? "gallery_motion_description" : "gallery_detail_note")}</p>
    </Dialog>
  </>;
}
