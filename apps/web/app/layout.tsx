import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LangProvider } from "@/components/i18n/LangProvider";
import { type Lang, t } from "@/lib/brand";

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
      siteName: "Lampstage / 灯境",
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
      <body className="bg-white text-[#061b31] antialiased">
        <LangProvider initialLang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
