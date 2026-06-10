"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LangProvider";

export default function CasesPage() {
  const { t } = useLang();
  return (
    <main className="mx-auto flex min-h-screen max-w-[800px] flex-col items-start justify-center px-6">
      <h1 className="text-[36px] font-light tracking-[-1px]">{t("cases_title")}</h1>
      <p className="mt-3 text-[#64748d]">{t("cases_body")}</p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-[#d6d9fc] px-4 py-2 text-[#533afd]"
      >
        {t("cases_back")}
      </Link>
    </main>
  );
}
