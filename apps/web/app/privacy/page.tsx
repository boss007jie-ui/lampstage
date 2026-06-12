"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

export default function PrivacyPage() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link href="/" className="text-[13px] text-[#533afd] hover:underline">
        ← {zh ? "返回首页" : "Back home"}
      </Link>
      <h1 className="mt-4 text-[26px] font-semibold tracking-tight">
        {zh ? "隐私政策" : "Privacy Policy"}
      </h1>
      <p className="mt-2 text-[13px] text-[#888]">
        {zh ? "最后更新：2026 年 6 月" : "Last updated: June 2026"}
      </p>

      <div className="mt-8 space-y-6 text-[14px] leading-relaxed text-[#374151]">
        <Section title={zh ? "我们是谁" : "Who we are"}>
          {zh
            ? `${BRAND.cn}（${BRAND.en}，${BRAND.domain}）是一款帮助灯具卖家把商品图生成家居场景图的在线工具。`
            : `${BRAND.en} (${BRAND.domain}) is an online tool that helps lamp sellers turn product photos into home-scene images.`}
        </Section>

        <Section title={zh ? "我们收集哪些信息" : "What we collect"}>
          {zh
            ? "1) 你注册时提供的邮箱；2) 你上传的灯具图片与生成的场景图；3) 必要的使用日志（如生成次数、时间）。我们不收集与服务无关的个人信息。"
            : "1) The email you register with; 2) Lamp images you upload and the scenes we generate; 3) Minimal usage logs (e.g. generation count and time). We do not collect personal data unrelated to the service."}
        </Section>

        <Section title={zh ? "信息如何使用" : "How we use it"}>
          {zh
            ? "用于完成图片生成、保存你的作品、管理额度、以及通过邮箱向你发送登录验证码与重要通知。我们不会出售你的个人信息。"
            : "To generate images, store your works, manage credits, and email you sign-in codes and important notices. We never sell your personal data."}
        </Section>

        <Section title={zh ? "图片与数据存储" : "Image & data storage"}>
          {zh
            ? "上传图与生成图存储在云对象存储中；账户数据存储在数据库中。我们采取合理的技术措施保护数据安全。你可以联系我们删除你的账户与数据。"
            : "Uploaded and generated images are stored in cloud object storage; account data is kept in a database. We apply reasonable safeguards. You may contact us to delete your account and data."}
        </Section>

        <Section title={zh ? "第三方服务" : "Third-party services"}>
          {zh
            ? "我们使用第三方服务来运行本产品（云托管、对象存储、邮件发送、AI 图像生成）。这些服务仅在为你提供功能所必需的范围内处理数据。"
            : "We rely on third-party providers (hosting, object storage, email delivery, AI image generation) solely to deliver the service to you."}
        </Section>

        <Section title={zh ? "联系我们" : "Contact"}>
          {zh
            ? `邮箱：${BRAND.email}　微信：${BRAND.wechat}`
            : `Email: ${BRAND.email}　WeChat: ${BRAND.wechat}`}
        </Section>
      </div>

      <p className="mt-10 text-[12px] text-[#aaa]">
        <Link href="/terms" className="text-[#533afd] hover:underline">
          {zh ? "用户协议" : "Terms of Service"}
        </Link>
      </p>
    </main>
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
      <h2 className="mb-1.5 text-[16px] font-semibold text-[#171717]">
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}
