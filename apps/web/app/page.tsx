"use client";
import Link from "next/link";
import { ArrowRight, CheckCircle, Key, PlugsConnected, BracketsCurly } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";

const cards = [
  { icon: Key, title: { zh: "个人 API 密钥", en: "Personal API keys" }, body: { zh: "每个账号独立管理密钥、额度和调用记录，创建后只显示一次完整密钥。", en: "Each account manages its own keys, credits and usage history. The full key is shown only once." } },
  { icon: PlugsConnected, title: { zh: "WorkBuddy Expert 连接", en: "WorkBuddy Expert connection" }, body: { zh: "用 Bearer 鉴权绑定 Expert，让它发现 API 能力并按规则执行任务。", en: "Bind an Expert with Bearer authentication so it can discover capabilities and run governed jobs." } },
  { icon: BracketsCurly, title: { zh: "版本化 API 与任务", en: "Versioned APIs and jobs" }, body: { zh: "通过稳定的 v1 入口上传素材、创建异步任务、查询状态并取得结果。", en: "Use the stable v1 entry point to upload assets, create async jobs, poll status and retrieve results." } },
];

export default function HomePage() {
  const { t, lang } = useLang();
  const zh = lang === "zh";
  return <><SiteHeader /><main>
    <section className="home-intro page-container">
      <div><span className="home-eyebrow">{t("hero_badge")}</span><h1>{t("hero_title")}</h1><p>{t("hero_subtitle")}</p></div>
      <div className="flex flex-wrap gap-3"><Link href="/developers" className="btn btn-primary">{t("hero_cta_primary")}<ArrowRight size={22} aria-hidden /></Link><Link href="/account" className="btn btn-outline">{t("hero_cta_secondary")}</Link></div>
    </section>

    <section className="page-container py-10 md:py-16" aria-labelledby="api-capabilities-title">
      <div className="mb-7 max-w-2xl"><span className="section-kicker">{t("showcase_eyebrow")}</span><h2 id="api-capabilities-title" className="page-heading mt-3">{t("showcase_title")}</h2></div>
      <div className="grid gap-4 md:grid-cols-3">{cards.map(({ icon: Icon, title, body }) => <article className="surface p-6" key={title.en}><div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#f0f1e9] text-[var(--color-accent)]"><Icon size={23} /></div><h3 className="text-lg font-semibold">{zh ? title.zh : title.en}</h3><p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{zh ? body.zh : body.en}</p></article>)}</div>
    </section>
    <section id="how-it-works" className="home-how page-container">
      <div><h2>{t("how_title")}</h2><p>{zh ? "从创建密钥到任务查询，网站只保留接入 WorkBuddy 所需的关键路径。" : "From key creation to job polling, the site keeps the path focused on connecting WorkBuddy."}</p></div>
      <ol><li><span className="step-icon"><Key size={24} aria-hidden /></span><span>{t("how_step1_title")}</span></li><li><ArrowRight className="step-arrow" size={20} aria-hidden /><span className="step-icon"><PlugsConnected size={24} aria-hidden /></span><span>{t("how_step2_title")}</span></li><li><ArrowRight className="step-arrow" size={20} aria-hidden /><span className="step-icon"><CheckCircle size={24} aria-hidden /></span><span>{t("how_step3_title")}</span></li></ol>
    </section>
    <section className="home-preparation page-container">
      <div><span className="section-kicker">API v1</span><h2>{zh ? "为你的 Expert 准备一条清晰的接入路径。" : "Give your Expert a clear integration path."}</h2></div>
      <div><p>{zh ? "先创建个人 API Key，再把 https://lampstage.com/api/mcp 和 Bearer 密钥配置到 WorkBuddy Connector。开发者页提供发现接口、连接器约定和 Expert 包说明。" : "Create a personal API key, then configure https://lampstage.com/api/mcp and the Bearer secret in your WorkBuddy Connector. The Developers page has discovery endpoints, connector conventions and the Expert package details."}</p><Link href="/developers" className="text-link">{t("showcase_cta")}<ArrowRight size={17} aria-hidden /></Link></div>
    </section>
    <section className="home-start page-container"><div><h2>{zh ? "现在就把 WorkBuddy Expert 接上。" : "Connect your WorkBuddy Expert now."}</h2><p>{zh ? "创建密钥、导入 Expert，再从 API 目录开始第一次调用。" : "Create a key, import the Expert and make the first call from the API catalog."}</p></div>
      <div className="home-start-actions"><Link href="/developers" className="btn btn-primary">{t("hero_cta_primary")}<ArrowRight size={19} /></Link><Link href="/account" className="text-link">{t("hero_cta_secondary")}</Link></div>
    </section>
  </main><SiteFooter /></>;
}
