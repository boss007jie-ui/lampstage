"use client";

import { useLang } from "./LangProvider";

/**
 * 简洁的 中 / EN 切换。两段标签整体宽度固定，避免布局抖动。
 */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  const base =
    "inline-flex items-center rounded-full border border-[var(--color-border)] bg-transparent text-[12px] font-medium overflow-hidden";
  const seg =
    "px-2.5 py-1 transition-colors";
  const on = "bg-[var(--color-accent)] text-[var(--color-on-accent)]";
  const off = "text-[var(--color-muted)] hover:text-[var(--color-text)]";
  return (
    <div className={`${base} ${className}`}>
      <button
        type="button"
        onClick={() => setLang("zh")}
        className={`${seg} ${lang === "zh" ? on : off}`}
        aria-pressed={lang === "zh"}
      >
        中
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={`${seg} ${lang === "en" ? on : off}`}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
    </div>
  );
}
