"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Dialog } from "@/components/ui/Dialog";
import { useLang } from "@/components/i18n/LangProvider";
import { SCENE_EXAMPLES, type SceneExample } from "@/lib/scene-examples";

export default function CasesPage() {
  const { lang, t } = useLang();
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<SceneExample | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scene");
    if (id) setSelected(SCENE_EXAMPLES.find((scene) => scene.id === id) ?? null);
  }, []);
  const scenes = category === "all" ? SCENE_EXAMPLES : SCENE_EXAMPLES.filter((scene) => scene.category === category);
  return <><SiteHeader active="cases" /><main className="page-container cases-page">
    <div className="cases-heading"><div><span className="section-kicker">{t("hero_badge")}</span><h1 className="page-heading">{t("sample_label")}</h1><p className="page-description">{t("cases_intro")}</p></div><Link className="btn btn-primary" href="/workspace">{t("hero_cta_primary")}<ArrowRight size={18} /></Link></div>
    <div className="scene-filters" aria-label={t("sample_label")}><button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("cases_all")}</button>{SCENE_EXAMPLES.map((scene) => <button type="button" key={scene.id} aria-pressed={category === scene.category} onClick={() => setCategory(scene.category)}>{t(scene.title)}</button>)}</div>
    <div className="cases-grid">{scenes.map((scene) => <article key={scene.id}><button type="button" className="case-image" onClick={() => setSelected(scene)} aria-label={`${t(scene.title)} · ${t("cases_detail")}`}>
      <Image src={scene.src} alt={t(scene.title)} fill sizes="(max-width: 639px) 100vw, 50vw" /><span>{t("sample_label")}</span></button>
      <div className="case-caption"><div><h2>{t(scene.title)}</h2><p>{scene.detail[lang]}</p></div><button type="button" className="icon-button" aria-label={`${t(scene.title)} · ${t("cases_detail")}`} onClick={() => setSelected(scene)}><ArrowRight size={22} /></button></div></article>)}</div><p className="cases-note">{t("sample_note")}</p>
  </main><SiteFooter /><Dialog open={!!selected} onClose={() => setSelected(null)} titleId="scene-detail-title" className="scene-detail-dialog">
    {selected && <><div className="flex items-center justify-between gap-4 mb-4"><h2 id="scene-detail-title" className="text-xl font-semibold">{t(selected.title)}</h2><button type="button" className="icon-button" onClick={() => setSelected(null)} aria-label={t("login_close")}><X size={22} /></button></div>
      <Image className="scene-detail-image" src={selected.src} alt={t(selected.title)} width={selected.width} height={selected.height} sizes="(max-width: 639px) 100vw, 920px" /><p className="page-description mt-4">{selected.detail[lang]}</p><p className="scene-detail-note">{t("cases_design_note")}</p><div className="scene-detail-check"><h3>{t("cases_check_title")}</h3><p>{t("cases_check_body")}</p></div><Link className="btn btn-primary mt-5" href="/workspace">{t("hero_cta_primary")}<ArrowRight size={18} /></Link></>}
  </Dialog></>;
}
