"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoginModal } from "@/components/auth/LoginModal";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BRAND } from "@/lib/brand";

type Template = {
  id: string;
  name: string;
  category: string;
  lamp_type: string;
  scene_space: string;
  preview_image_url: string;
  sort_order: number;
};

type PlatformStyle = "domestic_ecommerce" | "brand_site";
type AspectRatio = "1_1" | "4_5" | "16_9";

const ACCEPT_TYPES = "image/jpeg,image/png,image/webp";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function WorkspacePage() {
  const { t } = useLang();
  const [credit, setCredit] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refreshMe = async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        setSignedIn(true);
        setCredit(data.credit_balance);
      } else {
        setSignedIn(false);
        setCredit(null);
      }
    } catch {
      setSignedIn(false);
      setCredit(null);
    }
  };

  useEffect(() => {
    refreshMe();
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f7f5]">
      {/* 手机顶部条 */}
      <MobileTopBar
        credit={credit}
        signedIn={signedIn}
        onMenu={() => setDrawerOpen(true)}
      />

      {/* 桌面 sidebar + 主内容；手机抽屉覆盖在最上层 */}
      <div className="md:grid md:min-h-screen md:grid-cols-[248px_1fr]">
        <DesktopSidebar credit={credit} signedIn={signedIn} />
        <Main signedIn={signedIn} onRequireLogin={() => setLoginOpen(true)} />
      </div>

      {drawerOpen && (
        <MobileDrawer
          credit={credit}
          signedIn={signedIn}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSignedIn={async ({ isNewUser, creditBalance }) => {
          setLoginOpen(false);
          setSignedIn(true);
          setCredit(creditBalance);
          setWelcome(
            t(isNewUser ? "ws_welcome_new" : "ws_welcome_back", {
              n: creditBalance,
            }),
          );
          window.setTimeout(() => setWelcome(null), 4000);
          await refreshMe();
        }}
      />
      {welcome && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#171717] px-5 py-3 text-[13px] text-white shadow-2xl">
          {welcome}
        </div>
      )}
    </div>
  );
}

function BrandLogo() {
  const { lang } = useLang();
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-7 w-7 rounded-[8px]"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, #fff1bc, #c88736 42%, #16110b 85%)",
          boxShadow: "0 8px 22px rgba(174,110,35,.25)",
        }}
      />
      <div className="text-[15px] font-semibold tracking-tight text-[#171717]">
        {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
      </div>
    </div>
  );
}

/** 手机端顶部条：紧凑、sticky，包含 logo + 额度 + 汉堡 */
function MobileTopBar({
  credit,
  signedIn,
  onMenu,
}: {
  credit: number | null;
  signedIn: boolean;
  onMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#e8e5df] bg-white/95 px-4 py-3 backdrop-blur md:hidden">
      <Link href="/">
        <BrandLogo />
      </Link>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[#eadfcb] bg-[#faf7ed] px-2.5 py-1 text-[12px]">
          <span className="font-mono font-semibold text-[#171717]">
            {credit ?? (signedIn ? "—" : "20")}
          </span>
        </span>
        <button
          type="button"
          onClick={onMenu}
          aria-label="menu"
          className="grid h-9 w-9 place-items-center rounded-md border border-[#e5edf5] text-[#273951]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** 桌面 sidebar：md 以上显示，手机端隐藏 */
function DesktopSidebar({
  credit,
  signedIn,
}: {
  credit: number | null;
  signedIn: boolean;
}) {
  const { t } = useLang();
  return (
    <aside className="hidden border-r border-[#e8e5df] bg-white p-5 md:sticky md:top-0 md:block md:h-screen">
      <Link href="/" className="mb-7 flex items-center gap-2">
        <BrandLogo />
      </Link>
      <nav className="text-[14px]">
        <NavItem href="/workspace" label={t("nav_generate")} active />
        <NavItem href="/my" label={t("nav_my_works")} />
        <NavItem href="/credits" label={t("nav_credits")} />
        <NavItem href="/help" label={t("nav_help")} />
      </nav>
      <div className="mt-7 rounded-2xl border border-[#eadfcb] bg-[#faf7ed] p-4">
        <div className="text-[13px] text-[#888]">
          {signedIn
            ? t("ws_credits_title_signed")
            : t("ws_credits_title_unsigned")}
        </div>
        <div className="text-[28px] font-semibold tracking-[-1px]">
          {credit ?? "20"}
        </div>
        <div className="text-[12px] text-[#888]">
          {signedIn
            ? t("ws_credits_hint_signed")
            : t("ws_credits_hint_unsigned")}
        </div>
      </div>
      <div className="mt-5">
        <LangToggle />
      </div>
    </aside>
  );
}

/** 手机抽屉：从右滑出，遮罩 + 完整菜单 */
function MobileDrawer({
  credit,
  signedIn,
  onClose,
}: {
  credit: number | null;
  signedIn: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      onClick={onClose}
      role="dialog"
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute right-0 top-0 h-full w-[280px] bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <BrandLogo />
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="grid h-9 w-9 place-items-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="text-[15px]">
          <NavItem href="/workspace" label={t("nav_generate")} active onClick={onClose} />
          <NavItem href="/my" label={t("nav_my_works")} onClick={onClose} />
          <NavItem href="/credits" label={t("nav_credits")} onClick={onClose} />
          <NavItem href="/help" label={t("nav_help")} onClick={onClose} />
        </nav>
        <div className="mt-5 rounded-2xl border border-[#eadfcb] bg-[#faf7ed] p-4">
          <div className="text-[13px] text-[#888]">
            {signedIn
              ? t("ws_credits_title_signed")
              : t("ws_credits_title_unsigned")}
          </div>
          <div className="text-[28px] font-semibold tracking-[-1px]">
            {credit ?? "20"}
          </div>
          <div className="text-[12px] text-[#888]">
            {signedIn
              ? t("ws_credits_hint_signed")
              : t("ws_credits_hint_unsigned")}
          </div>
        </div>
        <div className="mt-5">
          <LangToggle />
        </div>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`mb-1 block rounded-xl px-3 py-2.5 transition-colors ${
        active
          ? "bg-[#171717] text-white"
          : "text-[#4d4d4d] hover:bg-[#171717] hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function Main({
  signedIn,
  onRequireLogin,
}: {
  signedIn: boolean;
  onRequireLogin: () => void;
}) {
  const { t } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [platformStyle, setPlatformStyle] =
    useState<PlatformStyle>("domestic_ecommerce");
  const [aspect, setAspect] = useState<AspectRatio>("4_5");
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: Template[] = (data.templates ?? [])
          .slice()
          .sort((a: Template, b: Template) => a.sort_order - b.sort_order);
        setTemplates(list);
        if (list.length > 0) setTemplateId(list[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplatesError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canGenerate = useMemo(
    () => Boolean(file && templateId && !fileError && !generating),
    [file, templateId, fileError, generating],
  );

  const onPick = (f: File | null) => {
    setFileError(null);
    if (!f) {
      setFile(null);
      setFilePreview(null);
      return;
    }
    if (!ACCEPT_TYPES.split(",").includes(f.type)) {
      setFileError(t("ws_err_format"));
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(t("ws_err_size"));
      return;
    }
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  };

  const onGenerate = () => {
    if (!canGenerate) return;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    setGenerating(true);
    window.setTimeout(() => {
      setGenerating(false);
      window.alert(
        t("ws_alert_dryrun") +
          "\n" +
          JSON.stringify(
            { templateId, platformStyle, aspect, fileName: file?.name },
            null,
            2,
          ),
      );
    }, 600);
  };

  return (
    <main className="px-4 py-5 md:px-8 md:py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.5px] sm:text-[28px] md:text-[32px] md:tracking-[-1px]">
            {t("ws_title")}
          </h1>
          <p className="mt-2 text-[14px] text-[#666] md:text-[15px]">
            {t("ws_subtitle")}
          </p>
        </div>
        <div className="hidden rounded-full border border-[#ddd] bg-white px-3 py-2 text-[13px] text-[#555] md:block">
          {t("ws_mode_chip")}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-[360px_1fr] md:gap-5">
        <Panel title={t("ws_panel_settings")}>
          <Step n={1} label={t("ws_step_upload")}>
            <UploadZone
              fileInputRef={fileInputRef}
              file={file}
              filePreview={filePreview}
              error={fileError}
              onPick={onPick}
            />
          </Step>

          <Step n={2} label={t("ws_step_template")}>
            {templatesError && (
              <p className="text-[13px] text-red-600">
                {t("ws_err_template")}
                {templatesError}
              </p>
            )}
            <TemplateGrid
              templates={templates}
              selectedId={templateId}
              onSelect={setTemplateId}
            />
          </Step>

          <Step n={3} label={t("ws_step_platform")}>
            <Segmented
              options={[
                { value: "domestic_ecommerce", label: t("ws_platform_domestic") },
                { value: "brand_site", label: t("ws_platform_brand") },
              ]}
              value={platformStyle}
              onChange={(v) => setPlatformStyle(v as PlatformStyle)}
            />
          </Step>

          <Step n={4} label={t("ws_step_aspect")}>
            <Segmented
              options={[
                { value: "1_1", label: t("ws_aspect_1_1") },
                { value: "4_5", label: t("ws_aspect_4_5") },
                { value: "16_9", label: t("ws_aspect_16_9") },
              ]}
              value={aspect}
              onChange={(v) => setAspect(v as AspectRatio)}
            />
          </Step>

          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className="mt-2 w-full rounded-xl bg-[#171717] px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating
              ? t("ws_btn_generating")
              : signedIn
                ? t("ws_btn_generate")
                : t("ws_btn_generate_loginfirst")}
          </button>
          <p className="mt-2 text-center text-[12px] text-[#888]">
            {t("ws_cost_hint")}
          </p>
        </Panel>

        <Panel title={t("ws_panel_preview")}>
          <PreviewCanvas
            templateName={
              templates.find((t2) => t2.id === templateId)?.name ?? "—"
            }
            platformStyle={platformStyle}
            aspect={aspect}
            generating={generating}
            filePreview={filePreview}
          />
        </Panel>
      </section>
    </main>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-[16px] border border-[#e8e4dc] bg-white md:rounded-[18px]"
      style={{ boxShadow: "0 12px 40px rgba(30,20,10,.05)" }}
    >
      <h2 className="border-b border-[#eee9df] p-3.5 text-[14px] font-semibold sm:p-4 sm:text-[15px]">
        {title}
      </h2>
      <div className="p-4 md:p-5">{children}</div>
    </div>
  );
}

function Step({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex gap-3">
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#171717] text-[12px] text-white">
        {n}
      </div>
      <div className="w-full min-w-0">
        <div className="mb-2 text-[14px] font-medium">{label}</div>
        {children}
      </div>
    </div>
  );
}

function UploadZone({
  fileInputRef,
  file,
  filePreview,
  error,
  onPick,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  file: File | null;
  filePreview: string | null;
  error: string | null;
  onPick: (f: File | null) => void;
}) {
  const { t } = useLang();
  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_TYPES}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="grid h-40 w-full place-items-center rounded-2xl border-[1.5px] border-dashed border-[#c9b89a] bg-gradient-to-br from-white to-[#fbf6ec] px-3 text-center text-[#6b5a3e] transition-colors hover:border-[#171717] sm:h-44"
      >
        {filePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={filePreview}
            alt="uploaded lamp"
            className="max-h-36 rounded-xl object-contain sm:max-h-40"
          />
        ) : (
          <div>
            <div className="font-semibold text-[#171717]">{t("ws_step_upload")}</div>
            <div className="text-[12px] sm:text-[13px]">{t("ws_upload_hint")}</div>
            <div className="mt-1 text-[11px] text-[#9b876b]">
              {t("ws_upload_max")}
            </div>
          </div>
        )}
      </button>
      {file && (
        <div className="mt-2 flex items-center justify-between text-[12px] text-[#666]">
          <span className="truncate pr-2">{file.name}</span>
          <button
            type="button"
            className="flex-none text-[#999] underline-offset-2 hover:underline"
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.value = "";
              onPick(null);
            }}
          >
            {t("ws_upload_remove")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-[#9b876b]">
        {t("ws_upload_warn")}
      </p>
    </div>
  );
}

function TemplateGrid({
  templates,
  selectedId,
  onSelect,
}: {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, lang } = useLang();
  if (templates.length === 0) {
    return <div className="text-[13px] text-[#888]">{t("ws_err_loading")}</div>;
  }
  const sceneLabelMap: Record<string, { zh: string; en: string }> = {
    dining: { zh: "餐厅", en: "Dining" },
    living: { zh: "客厅", en: "Living" },
    bedroom: { zh: "卧室", en: "Bedroom" },
    hotel: { zh: "酒店", en: "Hotel" },
    study: { zh: "书房", en: "Study" },
  };
  const lampTypeMap: Record<string, { zh: string; en: string }> = {
    吊灯: { zh: "吊灯", en: "Pendant" },
    壁灯: { zh: "壁灯", en: "Sconce" },
    台灯: { zh: "台灯", en: "Table" },
    落地灯: { zh: "落地灯", en: "Floor" },
    吸顶灯: { zh: "吸顶灯", en: "Ceiling" },
  };
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {templates.map((tpl) => {
        const selected = tpl.id === selectedId;
        const lampLabel = lampTypeMap[tpl.lamp_type]?.[lang] ?? tpl.lamp_type;
        const sceneLabel = sceneLabelMap[tpl.scene_space]?.[lang] ?? tpl.scene_space;
        return (
          <button
            key={tpl.id}
            onClick={() => onSelect(tpl.id)}
            className={`rounded-2xl border bg-white p-3 text-left transition-all ${
              selected
                ? "border-[#171717] shadow-[0_0_0_3px_rgba(23,23,23,.06)]"
                : "border-[#e7e1d7] hover:border-[#171717]"
            }`}
          >
            <div
              className="mb-2 h-14 rounded-[10px] sm:h-16"
              style={{
                background: "linear-gradient(135deg, #e9dfd0, #7f684d)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span
                aria-hidden
                className="absolute"
                style={{
                  left: "40%",
                  top: "16%",
                  width: 28,
                  height: 38,
                  borderRadius: "50% 50% 45% 45%",
                  background:
                    "radial-gradient(circle, #fff8cc, #e9a742 55%, #5e3715)",
                  boxShadow: "0 0 35px 9px rgba(244,185,72,.55)",
                }}
              />
            </div>
            <div className="text-[13px] font-semibold text-[#171717] sm:text-[14px]">
              {tpl.name}
            </div>
            <div className="text-[11px] text-[#888] sm:text-[12px]">
              {lampLabel} · {sceneLabel}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl border border-[#e5e1d8] bg-[#fafafa] p-1">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-lg px-2 py-2 text-[12px] transition-colors sm:px-3 sm:text-[13px] ${
              on ? "bg-[#171717] text-white" : "text-[#666] hover:text-[#171717]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PreviewCanvas({
  templateName,
  platformStyle,
  aspect,
  generating,
  filePreview,
}: {
  templateName: string;
  platformStyle: PlatformStyle;
  aspect: AspectRatio;
  generating: boolean;
  filePreview: string | null;
}) {
  const { t } = useLang();
  const aspectLabel =
    { "1_1": "1:1", "4_5": "4:5", "16_9": "16:9" }[aspect] || aspect;
  const platformLabel =
    platformStyle === "domestic_ecommerce"
      ? t("ws_platform_domestic")
      : t("ws_platform_brand");
  return (
    <div>
      <div
        className="relative h-[260px] overflow-hidden rounded-2xl sm:h-[360px] md:h-[460px] md:rounded-3xl"
        style={{
          background: "linear-gradient(140deg, #d9c8b3, #f3ece1 45%, #7b6a58)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)",
        }}
      >
        <div className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-white/80 px-2.5 py-1.5 text-[11px] backdrop-blur sm:left-4 sm:top-4 sm:px-3 sm:py-2 sm:text-[13px]">
          {templateName} · {platformLabel} · {aspectLabel}
        </div>
        <div
          aria-hidden
          className="absolute right-12 top-10 h-[64px] w-[48px] rounded-[28px_28px_12px_12px] sm:right-24 sm:top-14 sm:h-[90px] sm:w-[64px] md:right-32 md:top-16 md:h-[110px] md:w-[80px] md:rounded-[48px_48px_18px_18px]"
          style={{
            background:
              "radial-gradient(circle at 50% 30%, #fff7c8, #e2a23d 40%, #5c3518 75%)",
            boxShadow:
              "0 0 60px 24px rgba(255,210,101,.45), 0 14px 24px rgba(0,0,0,.18)",
          }}
        />
        <div
          aria-hidden
          className="absolute bottom-12 left-6 right-6 h-14 rounded-[20px_20px_10px_10px] bg-[#cab89f] sm:bottom-16 sm:left-10 sm:right-10 sm:h-20 md:bottom-20 md:left-12 md:right-12 md:h-24 md:rounded-[36px_36px_18px_18px]"
        />
        {filePreview && !generating && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={filePreview}
            alt="uploaded lamp"
            className="absolute right-3 top-3 h-14 w-14 rounded-lg border border-white/60 object-cover sm:right-4 sm:top-4 sm:h-20 sm:w-20 sm:rounded-xl"
          />
        )}
        {generating && (
          <div className="absolute inset-0 grid place-items-center bg-black/30 px-4 text-white">
            <div className="text-center">
              <div className="text-[16px] sm:text-[18px]">
                {t("ws_progress_placeholder")}
              </div>
              <div className="mt-1 text-[11px] opacity-80 sm:text-[12px]">
                {t("ws_progress_subtext")}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 sm:mt-4">
        <div className="text-[11px] text-[#888] sm:text-[12px]">
          {t("ws_preview_disclaimer")}
        </div>
        <div className="flex gap-2">
          <button
            disabled
            className="rounded-xl border border-[#e5e1d8] bg-white px-3 py-2 text-[12px] text-[#666] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-[13px]"
          >
            {t("ws_btn_regenerate")}
          </button>
          <button
            disabled
            className="rounded-xl bg-[#171717] px-3 py-2 text-[12px] text-white disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-[13px]"
          >
            {t("ws_btn_download")}
          </button>
        </div>
      </div>
    </div>
  );
}
