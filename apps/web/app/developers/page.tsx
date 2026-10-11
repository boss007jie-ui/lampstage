"use client";

import Link from "next/link";
import { ArrowRight, BracketsCurly, CheckCircle, Key, PlugsConnected } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";

const capabilities = [
  { icon: "expert", zh: "WorkBuddy Expert", en: "WorkBuddy Expert", detailZh: "把产品理解、任务规则和结果核对组合成可复用的专家工作流。", detailEn: "Compose product understanding, task rules and result review into a reusable Expert workflow." },
  { icon: "api", zh: "版本化 API", en: "Versioned API", detailZh: "用公开的健康检查和能力目录发现接入边界，用 Bearer API Key 保护写入接口。", detailEn: "Discover the integration surface through public health and capability endpoints, then protect writes with a Bearer API key." },
  { icon: "jobs", zh: "素材与任务", en: "Assets and jobs", detailZh: "上传素材、创建异步任务、查询状态并取得可交付结果，供应商密钥留在服务端。", detailEn: "Upload assets, create async jobs, poll status and retrieve deliverables while provider keys stay server-side." },
];

export default function DevelopersPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return <><SiteHeader active="developers" /><main className="page-container" style={{ paddingTop: 40, paddingBottom: 40 }}>
    <section style={{ maxWidth: 820, marginBottom: 48 }}>
      <span className="section-kicker">{zh ? "WorkBuddy 专家接入" : "WORKBUDDY EXPERT ACCESS"}</span>
      <h1 className="page-heading" style={{ margin: "14px 0" }}>{zh ? "把你的业务 API 接入 WorkBuddy Expert" : "Connect your business API to a WorkBuddy Expert"}</h1>
      <p className="page-description">{zh ? "网站提供版本化 API、个人密钥和可导入的 Expert 包。网页只负责配置与发现，任务由 Expert 通过 Bearer 鉴权调用 /api/v1 完成。" : "The platform provides a versioned API, personal keys and an importable Expert package. Use the site to configure and discover the connection; the Expert calls /api/v1 with Bearer authentication."}</p>
      <div className="flex flex-wrap gap-3" style={{ marginTop: 24 }}><Link href="/account" className="btn btn-primary">{zh ? "生成 API 密钥" : "Create API key"}<ArrowRight size={18} /></Link><a href="#quickstart" className="btn btn-outline">{zh ? "查看快速开始" : "View quickstart"}</a></div>
    </section>

    <section className="grid gap-4 md:grid-cols-3" aria-label={zh ? "接入能力" : "Integration capabilities"}>
      {capabilities.map((item) => <article key={item.en} className="surface p-6">
        <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#f0f1e9] text-[var(--color-accent)]">{item.icon === "expert" ? <PlugsConnected size={23} /> : item.icon === "api" ? <BracketsCurly size={23} /> : <Key size={23} />}</div>
        <h2 className="text-lg font-semibold">{zh ? item.zh : item.en}</h2><p className="mt-2 text-sm leading-7 text-[var(--color-muted)]">{zh ? item.detailZh : item.detailEn}</p>
      </article>)}
    </section>

    <section id="quickstart" className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <div className="surface p-7"><div className="mb-4 flex items-center gap-3"><BracketsCurly size={21} className="text-[var(--color-accent)]" /><h2 className="text-xl font-semibold">{zh ? "API 快速开始" : "API quickstart"}</h2></div>
        <ol className="grid gap-3 text-sm leading-7 text-[var(--color-muted)]"><li><strong className="text-[var(--color-ink)]">1. {zh ? "注册并创建密钥" : "Register and create a key"}</strong> — {zh ? "在账户页生成个人 API Key，完整密钥只显示一次。" : "Create a personal API key on the account page; the full key is shown once."}</li><li><strong className="text-[var(--color-ink)]">2. {zh ? "配置连接器" : "Configure the connector"}</strong> — {zh ? "将 API 地址和 Bearer 密钥保存到 WorkBuddy 的 Expert secret。" : "Save the API base URL and Bearer secret in the WorkBuddy Expert connector."}</li><li><strong className="text-[var(--color-ink)]">3. {zh ? "发现并执行任务" : "Discover and run jobs"}</strong> — {zh ? "先请求 health/capabilities，再按返回目录调用素材和任务接口。" : "Call health/capabilities first, then use the returned catalog to call asset and job endpoints."}</li></ol>
        <pre className="mt-5 overflow-x-auto rounded-xl bg-[#242a20] p-5 text-xs leading-6 text-[#e9eee1]"><code>{`curl https://lampstage.com/api/v1/capabilities \\
  -H "Authorization: Bearer $LAMPSTAGE_API_KEY"`}</code></pre>
        <p className="mt-4 text-xs leading-6 text-[var(--color-muted)]">{zh ? "每个 WorkBuddy 用户绑定自己的密钥；不要共享密钥，也不要把任何供应商凭据放进 Expert 提示词。" : "Each WorkBuddy user should bind their own key. Never share keys or put provider credentials in Expert prompts."}</p>
      </div>
      <div className="surface p-7"><div className="mb-4 flex items-center gap-3"><PlugsConnected size={21} className="text-[var(--color-accent)]" /><h2 className="text-xl font-semibold">{zh ? "Expert 包" : "Expert package"}</h2></div>
        <p className="text-sm leading-7 text-[var(--color-muted)]">{zh ? "项目内的 workbuddy-expert/lampstage-commerce-creator 包含 manifest、MCP 配置、连接器约定和 Skills，可导入 WorkBuddy 后继续配置。" : "The workbuddy-expert/lampstage-commerce-creator package includes the manifest, MCP configuration, connector contract and Skills for import into WorkBuddy."}</p>
        <ul className="mt-5 grid gap-3 text-sm"><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "服务端 API Key 鉴权与任务归属" : "Server-side API key authentication and task ownership"}</li><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "异步任务状态与结果查询" : "Async job status and result polling"}</li><li className="flex gap-2"><CheckCircle size={18} className="mt-0.5 text-[var(--color-accent)]" />{zh ? "供应商密钥留在网站服务端" : "Provider credentials stay on the platform server"}</li></ul>
      </div>
    </section>
  </main><SiteFooter /></>;
}
