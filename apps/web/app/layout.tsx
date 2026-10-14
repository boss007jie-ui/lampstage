import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LangProvider } from "@/components/i18n/LangProvider";
import { type Lang, t } from "@/lib/brand";
import { BrandMotionProvider } from "@/components/brand/BrandMotion";

function readLangFromCookies(): Lang {
  const v = cookies().get("lang")?.value;
  return v === "en" ? "en" : "zh";
}

export function generateMetadata(): Metadata {
  const lang = readLangFromCookies();
  return {
    title: t(lang, "meta_title"),
    description: t(lang, "meta_desc"),
    metadataBase: new URL("https://lampstage.com"),
    openGraph: {
      title: t(lang, "meta_title"),
      description: t(lang, "meta_desc"),
      url: "https://lampstage.com",
      siteName: "Lampstage / 创境",
      type: "website",
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = readLangFromCookies();
  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"}>
      <body className="antialiased">
        <LangProvider initialLang={lang}><BrandMotionProvider>{children}</BrandMotionProvider></LangProvider>
      </body>
    </html>
  );
}
