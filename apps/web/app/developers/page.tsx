"use client";

import Link from "next/link";
import { ArrowRight, BracketsCurly, CheckCircle, Copy, Key, PlugsConnected } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";

const capabilities = [
  { icon: "image", zh: "图像生成", en: "Image generation", detailZh: "从产品图或参考图创建可交付的视觉素材。", detailEn: "Create deliverable visuals from product or reference images." },
  { icon: "video", zh: "视频生成", en: "Video generation", detailZh: "把参考视频、图片和提示词组合成视频任务。", detailEn: "Combine reference video, images and prompts into video jobs." },
  { icon: "copy", zh: "电商内容优化", en: "Commerce content optimization", detailZh: "生成标题、卖点、关键词和多语言商品描述。", detailEn: "Generate titles, selling points, keywords and localized product copy." },
];

export default function DevelopersPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return <><SiteHeader active="developers" /><main className="page-container" style={{ paddingTop: 40, paddingBottom: 40 }}>
    <section style={{ maxWidth: 820, marginBottom: 48 }}>
      <span className="section-kicker">{zh ? "开发者入口" : "DEVELOPER ACCESS"}</span>
      <h1 className="page-heading" style={{ margin: "14px 0" }}>{zh ? "把创境接入你的产品和工作流" : "Connect Lampstage to your product and workflow"}</h1>
      <p className="page-description">{zh ? "统一调用图像、视频和电商内容能力。网页工作台适合人工操作，API 与 WorkBuddy Expert 适合自动化和批量任务。" : "Call image, video and commerce content capabilities from one surface. Use the workspace for hands-on work, or the API and WorkBuddy Expert for automation and batch jobs."}</p>
      <div className="flex flex-wrap gap-3" style={{ marginTop: 24 }}><Link href="/workspace" className="btn btn-primary">{zh ? "打开工作台" : "Open workspace"}<ArrowRight size={18} /></Link><Link href="/account" className="btn btn-outline">{zh ? "生成 API 密钥" : "Create API key"}</Link><a href="#quickstart" className="btn btn-outline">{zh ? "查看快速开始" : "View quickstart"}</a></div>
    </section>

    <section className="grid gap-4 md:grid-cols-3" aria-label={zh ? "能力" : "Capabilities"}>
      {capabilities.map((item) => <article key={item.en} className="surface p-6">
        <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#f0f1e9] text-[var(--color-accent)]">{item.icon === "image" ? <BracketsCurly size={23} /> : item.icon === "video" ? <PlugsConnected size={23} /> : <Copy size={23} />}</div>
        <h2 className="text-lg font-semibold">{zh ? item.zh : item.en}</h2><p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{zh ? item.detailZh : item.detailEn}</p>
      </article>)}
    </section>

    <section id="quickstart" className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <div className="surface p-7"><div className="mb-4 flex items-center gap-3"><Key size={21} className="text-[var(--color-accent)]" /><h2 className="text-xl font-semibold">{zh ? "API 快速开始" : "API quickstart"}</h2></div>
        <p className="text-sm leading-7 text-[var(--color-muted)]">{zh ? "先在账户页生成一枚个人 API 密钥，再把它绑定到 WorkBuddy Expert。Expert 使用 Bearer 密钥调用网站 API，网站负责额度、任务状态和第三方图片/视频服务。" : "Create a personal API key on the account page, then bind it to the WorkBuddy Expert. The Expert sends a Bearer key to this API while the platform owns credits, job state and third-party image/video providers."}</p>
        <pre className="mt-5 overflow-x-auto rounded-xl bg-[#242a20] p-5 text-xs leading-6 text-[#e9eee1]"><code>{`curl https://lampstage.com/api/v1/capabilities -H "Authorization: Bearer $LAMPSTAGE_API_KEY"`}</code></pre>
        <p className="mt-4 text-xs leading-6 text-[var(--color-muted)]">{zh ? "每个用户绑定自己的 LAMPSTAGE_API_KEY；不要共享密钥，也不要把 Hypit 或其他供应商密钥放进浏览器。" : "Bind each user’s own LAMPSTAGE_API_KEY. Never share keys or put Hypit/provider credentials in the browser."}</p>
      </div>
      <div className="surface p-7"><div className="mb-4 flex items-center gap-3"><PlugsConnected size={21} className="text-[var(--color-accent)]" /><h2 className="text-xl font-semibold">{zh ? "WorkBuddy Expert" : "WorkBuddy Expert"}</h2></div>
        <p className="text-sm leading-7 text-[var(--color-muted)]">{zh ? "把产品理解、关键词优化、图片生成、视频生成和任务查询组合成一个 Expert。项目内的 workbuddy-expert/lampstage-commerce-creator 包含 manifest、MCP 配置和 Skills，可直接作为发布包继续配置。" : "Combine product understanding, keyword optimization, image generation, video generation and job polling in one Expert. The workbuddy-expert/lampstage-commerce-creator package contains the manifest, MCP config and Skills for continued setup."}</p>
        <ul className="mt-5 grid gap-3 text-sm"><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "多 Skill 协同" : "Multiple coordinated Skills"}</li><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "统一任务状态与素材引用" : "Unified job status and asset references"}</li><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "供应商密钥服务端托管" : "Provider keys stay server-side"}</li></ul>
      </div>
    </section>
  </main><SiteFooter /></>;
}
