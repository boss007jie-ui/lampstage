"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LANG,
  type DictKey,
  type Lang,
  detectLangFromBrowser,
  t as translate,
} from "@/lib/brand";

const COOKIE = "lang";
const ONE_YEAR = 365 * 24 * 60 * 60;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"),
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
};

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({
  initialLang,
  children,
}: {
  initialLang?: Lang;
  children: ReactNode;
}) {
  // 服务器端用 initialLang；客户端 mount 后再根据 cookie / 浏览器语言修正
  const [lang, setLangState] = useState<Lang>(initialLang ?? DEFAULT_LANG);

  useEffect(() => {
    const fromCookie = readCookie(COOKIE) as Lang | null;
    if (fromCookie === "zh" || fromCookie === "en") {
      setLangState(fromCookie);
      return;
    }
    const detected = detectLangFromBrowser(
      typeof navigator !== "undefined" ? navigator.language : undefined,
    );
    setLangState(detected);
    writeCookie(COOKIE, detected);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    writeCookie(COOKIE, l);
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    }
  }, []);

  const toggle = useCallback(() => {
    setLang(lang === "zh" ? "en" : "zh");
  }, [lang, setLang]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      toggle,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang, toggle],
  );

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LangCtx);
  if (!ctx) {
    throw new Error("useLang must be used inside <LangProvider>");
  }
  return ctx;
}
