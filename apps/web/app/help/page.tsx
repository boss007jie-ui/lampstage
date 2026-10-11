"use client";
import Link from "next/link";
import { ArrowRight, Key, PlugsConnected, CheckCircle, CaretDown } from "@phosphor-icons/react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";

const copy = {
  zh: {
    title: "连接 WorkBuddy Expert，从这里开始", intro: "网站提供 API 密钥、能力目录和接入说明。Expert 负责理解任务，并通过 API 执行和查询。",
    prepare: "接入前准备好这三项", body: "创建个人 API 密钥，导入 Expert 包，再为连接器配置 API 地址和密钥。不要把完整密钥写入公开提示词或文档。",
    requirements: ["一个可登录的网站账号和个人 API Key", "WorkBuddy 中导入的 Expert 与 MCP 连接器", "API 地址：https://lampstage.com/api/v1"],
    steps: ["创建个人 API Key", "绑定 WorkBuddy 连接器", "查询能力并执行任务"],
    descriptions: ["在账户页生成并保存密钥，完整密钥只在创建时显示一次。", "使用 API 地址和 Authorization: Bearer 密钥配置 Expert 的 secret。", "先检查 health 和 capabilities，再提交素材与任务，按 job_id 跟踪结果。"],
    review: "任务状态是后续动作的依据", reviewBody: "提交后保存 job_id，先查询任务状态再决定是否重试。请求超时不等于任务停止；不确定时继续查询，避免重复执行或扣费。",
    faq: "常见接入问题", questions: ["API Key 在哪里生成？", "一个密钥可以给其他人使用吗？", "哪些接口无需密钥？", "health 返回 503 怎么办？", "网站还需要直接操作素材生成吗？"],
    answers: ["登录账户页后创建 API 密钥。完整密钥只显示一次，请保存到 WorkBuddy 的 Expert secret 或安全的密钥管理工具。", "每个用户应创建自己的密钥，以保持任务归属与额度独立。密钥泄露后应在账户页撤销并重新生成。", "API 发现入口、health 和 capabilities 是公开接口。素材写入、任务创建和用户任务查询需要有效的 Bearer API Key。", "这表示服务依赖尚未就绪。先检查健康响应并联系平台管理员，暂缓创建新任务；页面可访问不代表后端任务服务已经可用。", "当前产品以 WorkBuddy Expert 与 API 为主要入口。网站用于创建密钥和查阅接入说明，业务任务由 Expert 发起。"],
    next: "准备好绑定 Expert 了？", nextBody: "从开发者页查看接入约定，或登录账户创建个人 API 密钥。", docs: "查看接入文档", keys: "管理 API 密钥",
  },
  en: {
    title: "Start connecting your WorkBuddy Expert", intro: "The site provides API keys, a capability catalog and integration guidance. Your Expert understands the request and runs or polls jobs through the API.",
    prepare: "Prepare these three things", body: "Create a personal API key, import the Expert package, then configure the connector with the API URL and key. Keep full keys out of public prompts and documents.",
    requirements: ["A signed-in account and personal API key", "An imported Expert and MCP connector in WorkBuddy", "API base URL: https://lampstage.com/api/v1"],
    steps: ["Create a personal API key", "Bind the WorkBuddy connector", "Discover capabilities and run jobs"],
    descriptions: ["Create and store your key on the account page. The full key is shown only once.", "Configure the Expert secret with the API base URL and Authorization: Bearer key.", "Check health and capabilities first, then submit assets and jobs and track results by job_id."],
    review: "Let task status guide your next action", reviewBody: "Save the job_id after submission and query its state before retrying. A request timeout does not mean the job stopped. When uncertain, keep polling to avoid duplicate execution or charges.",
    faq: "Common integration questions", questions: ["Where do I create an API key?", "Can I share a key with another person?", "Which endpoints do not require a key?", "What if health returns 503?", "Do I need to operate generation from the site?"],
    answers: ["Sign in to the account page and create a key. The full key is shown once; save it in the WorkBuddy Expert secret or a secure key manager.", "Each user should create their own key to keep task ownership and credits separate. Revoke and replace a leaked key on the account page.", "The API entry point, health and capabilities are public. Asset writes, job creation and user job retrieval require a valid Bearer API key.", "A service dependency is not ready. Check the response and contact the platform administrator before starting new jobs. Accessible pages do not prove that task services are ready.", "WorkBuddy Experts and the API are the main product entry points. Use the site for key creation and integration guidance, and let the Expert start business tasks."],
    next: "Ready to bind your Expert?", nextBody: "Read the integration contract on the Developers page or sign in to create a personal API key.", docs: "Read integration guide", keys: "Manage API keys",
  },
};

export default function HelpPage() {
  const { lang, t } = useLang();
  const c = copy[lang];
  const icons = [Key, PlugsConnected, CheckCircle];
  return <><SiteHeader active="help" /><main className="page-container help-page">
    <div className="help-heading"><span className="section-kicker">{t("nav_help")}</span><h1 className="page-heading">{c.title}</h1><p className="page-description">{c.intro}</p></div>
    <section id="connection" className="help-images"><div><h2>{c.prepare}</h2><p>{c.body}</p><Link href="/account" className="btn btn-primary mt-5">{c.keys}<ArrowRight size={18} /></Link></div><ul>{c.requirements.map(item => <li key={item}>{item}</li>)}</ul></section>
    <ol className="help-steps">{c.steps.map((step, index) => { const Icon = icons[index]; return <li key={step}><Icon size={28} aria-hidden /><span className="section-kicker">0{index + 1}</span><h2>{step}</h2><p>{c.descriptions[index]}</p></li>; })}</ol>
    <section className="help-review"><h2>{c.review}</h2><p>{c.reviewBody}</p></section>
    <section className="help-faq"><h2>{c.faq}</h2>{c.questions.map((question, index) => <details key={question}><summary>{question}<CaretDown size={18} aria-hidden /></summary><p>{c.answers[index]}</p></details>)}</section>
    <section className="help-contact"><div><h2>{c.next}</h2><p>{c.nextBody}</p></div><div className="flex flex-wrap gap-3"><Link href="/developers" className="btn btn-primary">{c.docs}</Link><Link className="btn btn-outline" href="/account">{c.keys}</Link></div></section>
  </main><SiteFooter /></>;
}
