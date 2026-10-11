"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export default function TermsPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <>
    <SiteHeader />
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-[13px] text-[#5b6350] hover:underline">
        ← {zh ? "返回首页" : "Back home"}
      </Link>
      <h1 className="mt-4 text-[34px] font-semibold tracking-tight">
        {zh ? "用户协议" : "Terms of Service"}
      </h1>
      <p className="mt-2 text-[13px] text-[#6b7066]">
        {zh ? "最后更新：2026 年 6 月" : "Last updated: June 2026"}
      </p>

      <div className="mt-8 space-y-6 text-[15px] leading-7 text-[#454a40]">
        <Section title={zh ? "服务说明" : "The service"}>
          {zh
            ? `${BRAND.cn}（${BRAND.en}）提供连接 WorkBuddy Expert 的 AI 内容 API。你可以通过个人密钥提交素材，调用图片、视频和电商内容任务。`
            : `${BRAND.en} provides an AI content API for WorkBuddy Experts. You can submit assets with a personal key and call image, video and commerce content tasks.`}
        </Section>

        <Section title={zh ? "账号与额度" : "Account & credits"}>
          {zh
            ? "新用户注册赠送免费体验额度。额度按任务规则消耗，不可转让、不可兑换现金。"
            : "New users receive free trial credits. Credits are consumed according to task rules, are non-transferable, and have no cash value."}
        </Section>

        <Section title={zh ? "你的内容与责任" : "Your content & responsibility"}>
          {zh
            ? "你须对上传的图片拥有合法权利，不得上传侵权、违法或违反公序良俗的内容。你对使用生成结果的方式负责。"
            : "You must own the rights to images you upload and must not upload infringing or illegal content. You are responsible for how you use the generated results."}
        </Section>

        <Section title={zh ? "生成结果" : "Generated results"}>
          {zh
            ? "AI 生成结果可能存在偏差或不完美，不保证每次都满足预期。你需要在发布前核对事实、素材一致性和渠道要求。"
            : "AI results may be imperfect and are not guaranteed to meet every expectation. Review facts, asset consistency and channel requirements before publishing."}
        </Section>

        <Section title={zh ? "付费与退款" : "Payment & refunds"}>
          {zh
            ? "付费套餐的具体权益以购买时页面说明为准。因 AI 生成的不确定性，已消耗的额度原则上不退；如遇系统故障导致扣额但未出图，我们会自动返还额度。"
            : "Paid plan benefits are as described at purchase. Due to the nature of AI generation, consumed credits are generally non-refundable; if a system failure consumes credits without producing images, credits are auto-refunded."}
        </Section>

        <Section title={zh ? "服务变更与终止" : "Changes & termination"}>
          {zh
            ? "我们可能调整或暂停服务功能。如你违反本协议，我们有权暂停或终止你的账号。"
            : "We may modify or pause features. We may suspend or terminate accounts that violate these terms."}
        </Section>

        <Section title={zh ? "联系我们" : "Contact"}>
          {zh
            ? `邮箱：${BRAND.email}　微信：${BRAND.wechat}`
            : `Email: ${BRAND.email}　WeChat: ${BRAND.wechat}`}
        </Section>
      </div>

      <p className="mt-10 text-[12px] text-[#6b7066]">
        <Link href="/privacy" className="text-[#5b6350] hover:underline">
          {zh ? "隐私政策" : "Privacy Policy"}
        </Link>
      </p>
    </main>
    <SiteFooter />
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1.5 text-[16px] font-semibold text-[#262924]">
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}
