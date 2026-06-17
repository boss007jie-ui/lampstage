"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoginModal } from "@/components/auth/LoginModal";
import { LeadCaptureModal } from "@/components/credits/LeadCaptureModal";
import { LampProfileCard, type ProfileResp } from "@/components/workspace/LampProfileCard";
import { LangToggle } from "@/components/i18n/LangToggle";
import { useLang } from "@/components/i18n/LangProvider";
import { BrandMark } from "@/components/brand/BrandMark";
import {
  SceneSelector,
  type Scene,
  type Template,
} from "@/components/workspace/SceneSelector";
import { BRAND } from "@/lib/brand";

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
      <BrandMark size={30} onLight />
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
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [platformStyle, setPlatformStyle] =
    useState<PlatformStyle>("domestic_ecommerce");
  const [aspect, setAspect] = useState<AspectRatio>("4_5");

  // Scene selection (3 modes)
  const [sceneKind, setSceneKind] = useState<"recommended" | "template" | "custom">(
    "recommended",
  );
  const [uploadedAssetId, setUploadedAssetId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Scene[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [recommendedSceneIdx, setRecommendedSceneIdx] = useState<number>(0);
  const [customPrompt, setCustomPrompt] = useState<string>("");

  // 灯具档案 V1（NEW_LAMP_FLOW_ENABLED Feature Flag）
  // true → 用 LampProfileCard，不传 sceneKind，走档案驱动后端
  // false → 旧 SceneSelector，传 sceneKind 走旧路径
  const newLampFlow = process.env.NEXT_PUBLIC_NEW_LAMP_FLOW_ENABLED === "true";
  const [lampProfile, setLampProfile] = useState<ProfileResp | null>(null);

  // Pipeline state
  const [phase, setPhase] = useState<
    | "idle"
    | "uploading"
    | "prechecking"
    | "planning"
    | "choosing_count"
    | "submitting"
    | "polling"
    | "completed"
    | "failed"
  >("idle");
  // 构思完成后，记住已就绪的 asset，等顾客选完数量再发生成请求
  const [plannedAssetId, setPlannedAssetId] = useState<string | null>(null);
  // 点"场景构思"后收起左侧步骤2，让注意力集中到右侧
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [stageHint, setStageHint] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<{ id: string; image_url: string }[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [quotaExhaustedOpen, setQuotaExhaustedOpen] = useState(false);
  const [mismatch, setMismatch] = useState<{
    detected: string;
    template_lamp_type: string;
    onContinue: () => void;
  } | null>(null);

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

  const generating = phase !== "idle" && phase !== "completed" && phase !== "failed";
  // busy：构思/提交/生成进行中（禁用"场景构思"按钮）。choosing_count 是暂停态，
  // 不算 busy —— 顾客此时若展开设置，可以改完重新构思。
  const busy = generating && phase !== "choosing_count";
  const sceneReady = useMemo(() => {
    if (newLampFlow) return Boolean(lampProfile);
    if (sceneKind === "template") return Boolean(templateId);
    if (sceneKind === "recommended") return suggestions.length > 0 && Boolean(suggestions[recommendedSceneIdx]);
    if (sceneKind === "custom") return customPrompt.trim().length > 0;
    return false;
  }, [newLampFlow, lampProfile, sceneKind, templateId, suggestions, recommendedSceneIdx, customPrompt]);
  const canGenerate = useMemo(
    () => Boolean(file && sceneReady && !fileError && !generating),
    [file, sceneReady, fileError, generating],
  );

  const onPick = (f: File | null) => {
    setFileError(null);
    setUploadedAssetId(null);
    setSuggestions([]);
    setSuggestError(null);
    setOutputs([]);
    setErrMsg(null);
    setPhase("idle");
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
    // 选完文件立刻上传——智能推荐 Tab 需要 assetId 才能调 /api/generation/suggest
    void (async () => {
      try {
        setPhase("uploading");
        const fd = new FormData();
        fd.append("file", f);
        const upRes = await fetch("/api/uploads", { method: "POST", body: fd });
        if (!upRes.ok) {
          if (upRes.status === 401) {
            setPhase("idle"); // user not signed in; defer to generate-time login
            return;
          }
          setFileError(t("ws_err_upload_failed"));
          setPhase("failed");
          return;
        }
        const data = (await upRes.json()) as { id: string };
        setUploadedAssetId(data.id);
        setPhase("idle");
      } catch (e) {
        setFileError(String(e));
        setPhase("failed");
      }
    })();
  };

  const lampTypeLabel = (raw: string) => {
    const map: Record<string, { zh: string; en: string }> = {
      pendant: { zh: "吊灯", en: "pendant" },
      wall: { zh: "壁灯", en: "wall sconce" },
      table: { zh: "台灯", en: "table lamp" },
      floor: { zh: "落地灯", en: "floor lamp" },
      ceiling: { zh: "吸顶灯", en: "ceiling lamp" },
      unknown: { zh: "未知类型", en: "unknown type" },
    };
    if (map[raw]) return map[raw][lang];
    return raw;
  };

  // 第一步：点"场景构思" → 上传 + 构思（写好提示词存库）。新流程构思完停在
  // choosing_count 让顾客选张数；旧流程直接进入生成（默认 3 张）。
  const startPlanning = async () => {
    if (!canGenerate || !file) return;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    setErrMsg(null);
    setOutputs([]);
    setPlannedAssetId(null);

    try {
      // 1) Upload (only if not already uploaded for this file)
      let assetId = uploadedAssetId;
      if (!assetId) {
        setPhase("uploading");
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/uploads", { method: "POST", body: fd });
        if (!upRes.ok) {
          if (upRes.status === 401) {
            onRequireLogin();
            setPhase("idle");
            return;
          }
          throw new Error(t("ws_err_upload_failed"));
        }
        const data = (await upRes.json()) as { id: string };
        assetId = data.id;
        setUploadedAssetId(assetId);
      }

      // 2) Precheck — only when user picks an explicit template (recommended/custom 不需要)
      if (sceneKind === "template" && templateId) {
        setPhase("prechecking");
        const pcRes = await fetch("/api/generation/precheck", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            uploaded_asset_id: assetId,
            template_id: templateId,
          }),
        });
        const pc = await pcRes.json();
        if (pcRes.ok && pc.match === false) {
          await new Promise<void>((resolve, reject) => {
            setMismatch({
              detected: pc.detected_lamp_type,
              template_lamp_type: pc.template_lamp_type,
              onContinue: () => {
                setMismatch(null);
                resolve();
              },
            });
            (window as unknown as { __cancelMismatch?: () => void }).__cancelMismatch = () => {
              setMismatch(null);
              reject(new Error("user_cancelled_template"));
            };
          });
        }
      }

      // 3) Build submit body
      // 新流程（flag=on）：不传 scene_kind，让后端从 asset 档案算 3 个 prompt
      // 旧流程：按 sceneKind 分支传 template_id / recommended_prompt_en / custom_prompt
      const submitBody: Record<string, unknown> = {
        uploaded_asset_id: assetId,
        platform_style: platformStyle,
        aspect_ratio: aspect,
      };
      if (newLampFlow) {
        // 档案驱动：什么都不用传，后端读 UploadedAsset.size_class 等字段
      } else {
        submitBody.scene_kind = sceneKind;
        if (sceneKind === "template") {
          if (!templateId) throw new Error(t("ws_err_pick_template"));
          submitBody.template_id = templateId;
        } else if (sceneKind === "recommended") {
          const scene = suggestions[recommendedSceneIdx];
          if (!scene) throw new Error(t("ws_err_pick_scene"));
          submitBody.recommended_prompt_en = scene.prompt_en;
        } else if (sceneKind === "custom") {
          if (!customPrompt.trim()) throw new Error(t("ws_err_need_prompt"));
          submitBody.custom_prompt = customPrompt.trim();
        }
      }

      // 构思：新流程下让后端用 gpt 按当前产品卡写好 4 条提示词并存库（独立请求、
      // 有自己的 60s 预算）。提示词只存后端、不展示。失败不阻断，生成接口会
      // fallback 到本地规则。
      if (newLampFlow) {
        setSettingsCollapsed(true); // 收起左侧步骤2，注意力转右侧
        setPhase("planning");
        try {
          await fetch("/api/generation/plan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              uploaded_asset_id: assetId,
              platform_style: platformStyle,
              aspect_ratio: aspect,
            }),
          });
        } catch {
          // 构思失败也继续：生成接口走本地规则兜底
        }
        // 构思完成 → 记住 asset，让顾客选出图数量
        setPlannedAssetId(assetId);
        setPhase("choosing_count");
        return;
      }

      // 旧流程：无"选数量"步骤，沿用默认 3 张，直接生成
      await runGeneration(assetId, 3, submitBody);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "user_cancelled_template") {
        setErrMsg(msg);
      }
      setPhase("failed");
    }
  };

  // 第二步：顾客选完出图数量 → 发生成请求 + 轮询。
  const runGeneration = async (
    assetId: string,
    count: number,
    prebuiltBody?: Record<string, unknown>,
  ) => {
    try {
      const submitBody: Record<string, unknown> = prebuiltBody ?? {
        uploaded_asset_id: assetId,
        platform_style: platformStyle,
        aspect_ratio: aspect,
      };
      submitBody.image_count = count;

      // Submit job
      setPhase("submitting");
      const subRes = await fetch("/api/generation/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submitBody),
      });
      const subText = await subRes.text();
      let sub: { error?: string; job_id?: string; credit_balance?: number } = {};
      try {
        sub = subText ? JSON.parse(subText) : {};
      } catch {
        // Vercel/Next 500 有时会返回纯文本 "An error occurred..."，不能直接 res.json()
        sub = { error: subText.slice(0, 180) || "non_json_response" };
      }
      if (!subRes.ok) {
        if (sub.error === "insufficient_credits") {
          setQuotaExhaustedOpen(true);
          setPhase("idle");
          return;
        }
        throw new Error(sub.error || t("ws_err_generic"));
      }
      if (!sub.job_id) {
        throw new Error(sub.error || "missing_job_id");
      }
      const jobId: string = sub.job_id;

      // 4) Poll
      setPhase("polling");
      const finalJob = await pollJob(jobId, (hint) => setStageHint(hint));
      if (finalJob.status === "completed") {
        setOutputs(finalJob.output_images);
        setPhase("completed");
      } else {
        setErrMsg(
          (finalJob.failure_reason ? t("ws_failure_label") + finalJob.failure_reason : t("ws_failure_label")) +
            " · " +
            t("ws_failure_refunded"),
        );
        setPhase("failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "user_cancelled_template") {
        setErrMsg(msg);
      }
      setPhase("failed");
    }
  };

  const stageText = stageHint
    ? t(`ws_stage_${stageHint}` as never)
    : t("ws_stage_generating");

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

          <Step n={2} label={t("ws_step_scene")}>
            {newLampFlow && uploadedAssetId && settingsCollapsed ? (
              <button
                onClick={() => setSettingsCollapsed(false)}
                className="w-full rounded-2xl border border-[#e5edf5] bg-[#f8fafc] px-4 py-3 text-left text-[13px] text-[#64748b] transition-colors hover:bg-[#eef2f7]"
              >
                {lampProfile
                  ? `${lampTypeLabel(lampProfile.lamp_type)} · ${t("ws_expand_settings")}`
                  : t("ws_expand_settings")}
              </button>
            ) : newLampFlow && uploadedAssetId ? (
              <LampProfileCard
                assetId={uploadedAssetId}
                onReady={(p) => setLampProfile(p)}
              />
            ) : newLampFlow ? (
              <div className="rounded-2xl border border-[#e5edf5] bg-[#f8fafc] p-4 text-[13px] text-[#94a3b8]">
                上传灯具图后将自动识别档案
              </div>
            ) : (
              <SceneSelector
                file={file}
                uploadedAssetId={uploadedAssetId}
                templates={templates}
                templateId={templateId}
                setTemplateId={setTemplateId}
                templatesError={templatesError}
                sceneKind={sceneKind}
                setSceneKind={setSceneKind}
                recommendedSceneIdx={recommendedSceneIdx}
                setRecommendedSceneIdx={setRecommendedSceneIdx}
                suggestions={suggestions}
                setSuggestions={setSuggestions}
                suggesting={suggesting}
                setSuggesting={setSuggesting}
                suggestError={suggestError}
                setSuggestError={setSuggestError}
                customPrompt={customPrompt}
                setCustomPrompt={setCustomPrompt}
              />
            )}
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
            onClick={startPlanning}
            disabled={!canGenerate || busy}
            className="mt-2 w-full rounded-xl bg-[#171717] px-4 py-3 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
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
          <PreviewArea
            templateName={
              templates.find((t2) => t2.id === templateId)?.name ?? "—"
            }
            platformStyle={platformStyle}
            aspect={aspect}
            phase={phase}
            stageText={stageText}
            outputs={outputs}
            errMsg={errMsg}
            filePreview={filePreview}
            spaceCount={(lampProfile?.space_fit ?? []).length || 3}
            onChooseCount={(n) => {
              if (plannedAssetId) void runGeneration(plannedAssetId, n);
            }}
          />
        </Panel>
      </section>

      {mismatch && (
        <MismatchModal
          detected={lampTypeLabel(mismatch.detected)}
          template={lampTypeLabel(mismatch.template_lamp_type)}
          onContinue={mismatch.onContinue}
          onCancel={() => {
            const w = window as unknown as { __cancelMismatch?: () => void };
            w.__cancelMismatch?.();
          }}
        />
      )}
      <QuotaExhaustedDialog
        open={quotaExhaustedOpen}
        onClose={() => setQuotaExhaustedOpen(false)}
      />
    </main>
  );
}

async function pollJob(
  jobId: string,
  onStage: (stage: string) => void,
): Promise<{
  status: "completed" | "failed";
  failure_reason: string | null;
  output_images: { id: string; image_url: string }[];
}> {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > 180_000) {
      return {
        status: "failed",
        failure_reason: "timeout",
        output_images: [],
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/generation/jobs/${jobId}`, {
      cache: "no-store",
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.stage_hint) onStage(data.stage_hint);
    if (data.status === "completed" || data.status === "failed") {
      return {
        status: data.status,
        failure_reason: data.failure_reason ?? null,
        output_images: data.outputs ?? data.output_images ?? [],
      };
    }
  }
}

function MismatchModal({
  detected,
  template,
  onContinue,
  onCancel,
}: {
  detected: string;
  template: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-[18px] font-semibold">{t("ws_mismatch_title")}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[#64748d]">
          {t("ws_mismatch_body", { template, detected })}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-[#e5edf5] bg-white px-4 py-2 text-[14px] text-[#273951]"
          >
            {t("ws_mismatch_change")}
          </button>
          <button
            onClick={onContinue}
            className="rounded-md bg-[#171717] px-4 py-2 text-[14px] text-white"
          >
            {t("ws_mismatch_continue")}
          </button>
        </div>
      </div>
    </div>
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

function PreviewArea({
  templateName,
  platformStyle,
  aspect,
  phase,
  stageText,
  outputs,
  errMsg,
  filePreview,
  spaceCount,
  onChooseCount,
}: {
  templateName: string;
  platformStyle: PlatformStyle;
  aspect: AspectRatio;
  phase:
    | "idle"
    | "uploading"
    | "prechecking"
    | "planning"
    | "choosing_count"
    | "submitting"
    | "polling"
    | "completed"
    | "failed";
  stageText: string;
  outputs: { id: string; image_url: string }[];
  errMsg: string | null;
  filePreview: string | null;
  spaceCount: number;
  onChooseCount: (n: number) => void;
}) {
  const { t } = useLang();
  const [activeIdx, setActiveIdx] = useState(0);

  const aspectLabel =
    { "1_1": "1:1", "4_5": "4:5", "16_9": "16:9" }[aspect] || aspect;
  const platformLabel =
    platformStyle === "domestic_ecommerce"
      ? t("ws_platform_domestic")
      : t("ws_platform_brand");
  const aspectRatioCss =
    aspect === "16_9" ? "16/9" : aspect === "1_1" ? "1/1" : "4/5";

  useEffect(() => {
    setActiveIdx(0);
  }, [outputs.length]);

  // ── 方向 B：大图轮播 + 缩略图条 ──
  if (phase === "completed" && outputs.length > 0) {
    const active = outputs[Math.min(activeIdx, outputs.length - 1)];
    return (
      <div>
        <div className="relative overflow-hidden rounded-2xl bg-black md:rounded-3xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={active.image_url}
            src={active.image_url}
            alt="generated scene"
            className="w-full object-cover"
            style={{ aspectRatio: aspectRatioCss, display: "block" }}
          />
          <div className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1.5 text-[11px] text-white backdrop-blur-sm">
            {templateName} · {platformLabel} · {aspectLabel}
          </div>
          <DownloadBtn output={active} />
        </div>
        {outputs.length > 1 && (
          <div className="mt-2.5 flex gap-2">
            {outputs.map((o, i) => (
              <button
                key={o.id}
                onClick={() => setActiveIdx(i)}
                className={`overflow-hidden rounded-lg transition-all ${
                  i === activeIdx
                    ? "opacity-100 ring-2 ring-[#533afd] ring-offset-1"
                    : "opacity-50 hover:opacity-80"
                }`}
                style={{ width: 56, flex: "none" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={o.image_url}
                  alt={`scene ${i + 1}`}
                  className="w-full object-cover"
                  style={{ aspectRatio: "4/5", display: "block" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── failed ──
  if (phase === "failed" && errMsg) {
    return (
      <div
        className="grid place-items-center rounded-2xl border border-red-100 bg-red-50 p-8 text-center md:rounded-3xl"
        style={{ minHeight: 280 }}
      >
        <p className="text-[13px] leading-relaxed text-red-700">{errMsg}</p>
      </div>
    );
  }

  // ── choosing_count: 构思完成，让顾客选出图数量 ──
  if (phase === "choosing_count") {
    return (
      <CountSelector
        spaceCount={spaceCount}
        aspectRatioCss={aspectRatioCss}
        onChoose={onChooseCount}
      />
    );
  }

  // ── generating: 深色背景 + 进度时间线 ──
  if (phase !== "idle") {
    return (
      <div
        className="grid place-items-center overflow-hidden rounded-2xl md:rounded-3xl"
        style={{
          minHeight: 320,
          background: "linear-gradient(160deg,#1a1a2e,#16213e)",
        }}
      >
        <ProgressTimeline phase={phase} stageHint={stageText} />
      </div>
    );
  }

  // ── idle / C 空态（写实舞台聚光灯）──
  return (
    <div
      className="relative grid place-items-center overflow-hidden rounded-2xl border border-[#2a2a38] md:rounded-3xl"
      style={{
        minHeight: 460,
        background:
          "radial-gradient(130% 90% at 50% -10%, #2c2c44 0%, #1c1c2e 45%, #14141f 100%)",
      }}
    >
      <style>{`
        @keyframes spotPulse {
          0%, 100% { opacity: .55; }
          50%      { opacity: 1; }
        }
        @keyframes spotBeam {
          0%, 100% { opacity: .4; }
          50%      { opacity: .72; }
        }
        @keyframes spotPool {
          0%, 100% { opacity: .5; transform: translateX(-50%) scale(.95); }
          50%      { opacity: .85; transform: translateX(-50%) scale(1.04); }
        }
        @keyframes floatY {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .spot-pulse, .spot-beam, .spot-pool, .lamp-float { animation: none !important; }
        }
      `}</style>

      {filePreview ? (
        <div
          className="lamp-float relative z-10 text-center"
          style={{ animation: "floatY 3.5s ease-in-out infinite" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={filePreview}
            alt="uploaded lamp"
            className="mx-auto h-28 w-28 rounded-2xl object-cover"
            style={{ boxShadow: "0 0 50px 8px rgba(255,210,120,.35)" }}
          />
          <p className="mt-4 text-[13px] font-medium" style={{ color: "#cbb78f" }}>
            {t("ws_idle_hint_uploaded")}
          </p>
        </div>
      ) : (
        <>
          {/* 光柱（体积光）：从光源圆点下边缘迸发，张角参考 logo，往下打开 */}
          <div
            className="spot-beam pointer-events-none absolute left-1/2 top-[60px]"
            style={{
              width: 360,
              height: 320,
              transform: "translateX(-50%)",
              background:
                "linear-gradient(to bottom, rgba(255,224,150,.62), rgba(255,214,130,.18) 58%, transparent 92%)",
              clipPath: "polygon(50% 0, 50% 0, 96% 100%, 4% 100%)",
              filter: "blur(7px)",
              animation: "spotBeam 4s ease-in-out infinite",
            }}
          />
          {/* 顶部灯具光源：B3 黑金工业吊灯 */}
          <div
            className="spot-pulse absolute left-1/2 top-0 z-10 flex flex-col items-center"
            style={{
              transform: "translateX(-50%)",
              animation: "spotPulse 4s ease-in-out infinite",
            }}
          >
            {/* 天花板固定座 */}
            <div
              style={{
                width: 18,
                height: 4,
                background: "#4a4a5c",
                borderRadius: "0 0 3px 3px",
              }}
            />
            {/* 吊线 */}
            <div
              style={{
                width: 2,
                height: 22,
                background: "linear-gradient(#6a6a7a,#3a3a48)",
              }}
            />
            {/* 黑金灯罩 */}
            <div
              className="relative"
              style={{
                width: 48,
                height: 30,
                background: "linear-gradient(165deg, #2a2a30, #16161c)",
                borderRadius: "24px 24px 6px 6px",
                boxShadow:
                  "inset 0 -2px 5px rgba(0,0,0,.5), 0 2px 5px rgba(0,0,0,.35)",
              }}
            >
              {/* 黄铜内圈 */}
              <div
                className="absolute left-1/2"
                style={{
                  bottom: -1,
                  transform: "translateX(-50%)",
                  width: 42,
                  height: 7,
                  borderRadius: "50%",
                  background: "linear-gradient(#e8c074,#b8862c)",
                  boxShadow: "0 0 6px rgba(232,192,116,.5)",
                }}
              />
              {/* 发光灯泡口 */}
              <div
                className="absolute left-1/2"
                style={{
                  bottom: -4,
                  transform: "translateX(-50%)",
                  width: 30,
                  height: 13,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(ellipse at 50% 25%, #fffae0, #ffcf66 50%, #e09a30)",
                  boxShadow: "0 0 30px 12px rgba(255,205,100,.88)",
                }}
              />
            </div>
          </div>
          {/* 地面光斑（被照亮的椭圆） */}
          <div
            className="spot-pool pointer-events-none absolute left-1/2"
            style={{
              bottom: 64,
              width: 300,
              height: 64,
              borderRadius: "50%",
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(255,220,150,.5), rgba(255,210,130,.12) 55%, transparent 75%)",
              filter: "blur(3px)",
              animation: "spotPool 4s ease-in-out infinite",
            }}
          />
          {/* 文字 */}
          <div className="relative z-10 mt-24 text-center">
            <div className="text-[14px] font-semibold uppercase tracking-[0.22em] text-[#e8dcc0]">
              Lampstage
            </div>
            <div
              style={{
                width: 44,
                height: 1,
                background: "rgba(232,220,192,.35)",
                margin: "12px auto",
              }}
            />
            <div className="text-[12px] text-[#bcae90]">{t("ws_idle_hint")}</div>
            <div className="mt-1 text-[11px] text-[#8c8268]">
              {t("ws_idle_sub")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DownloadBtn({
  output,
}: {
  output: { id: string; image_url: string };
}) {
  const { t } = useLang();
  const onDownload = async () => {
    const r = await fetch(`/api/output-images/${output.id}/download`, {
      method: "POST",
    });
    const data = await r.json().catch(() => ({}));
    const url = data.image_url || output.image_url;
    const a = document.createElement("a");
    a.href = url;
    a.download = url.split("/").pop() || "lampstage.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <button
      onClick={onDownload}
      className="absolute bottom-3 right-3 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-[#171717] shadow-md backdrop-blur-sm transition-colors hover:bg-white"
    >
      {t("ws_btn_download")} ↓
    </button>
  );
}

function QuotaExhaustedDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [leadOpen, setLeadOpen] = useState(false);
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 grid place-items-end bg-black/50 sm:place-items-center"
        onClick={onClose}
      >
        <div
          className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:m-4 sm:max-w-md sm:rounded-2xl sm:p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-[20px] font-semibold tracking-tight">
            {t("quota_title")}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#64748d]">
            {t("quota_subtitle")}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => setLeadOpen(true)}
              className="w-full rounded-md bg-[#533afd] px-4 py-2.5 font-medium text-white"
            >
              {t("plan_btn_contact")}
            </button>
            <Link
              href="/credits"
              className="w-full rounded-md border border-[#d6d9fc] px-4 py-2.5 text-center text-[14px] text-[#533afd]"
            >
              {t("quota_btn_topup")}
            </Link>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-[13px] text-[#94a3b8]"
            >
              {t("quota_btn_close")}
            </button>
          </div>
        </div>
      </div>
      <LeadCaptureModal
        open={leadOpen}
        source="workspace_quota_modal"
        onClose={() => {
          setLeadOpen(false);
          onClose();
        }}
      />
    </>
  );
}

/**
 * 出图数量选择器：构思完成后出现在右侧。顾客选 1-4 张，确认后才发生成请求扣费。
 * 深色背景与加载态一致，让注意力留在右侧。最适合空间优先呈现。
 */
function CountSelector({
  spaceCount,
  aspectRatioCss,
  onChoose,
}: {
  spaceCount: number;
  aspectRatioCss: string;
  onChoose: (n: number) => void;
}) {
  const { t } = useLang();
  const [count, setCount] = useState(Math.min(3, Math.max(1, spaceCount)));
  return (
    <div
      className="grid place-items-center overflow-hidden rounded-2xl px-5 md:rounded-3xl"
      style={{
        minHeight: 320,
        aspectRatio: aspectRatioCss,
        background: "linear-gradient(160deg,#1a1a2e,#16213e)",
      }}
    >
      <div className="w-full max-w-[360px] text-center">
        <div className="text-[16px] font-medium text-white sm:text-[18px]">
          {t("ws_count_title")}
        </div>
        <div className="mt-4 flex justify-center gap-2.5">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`grid h-12 w-12 place-items-center rounded-xl text-[17px] font-semibold transition-all sm:h-14 sm:w-14 ${
                count === n
                  ? "bg-white text-[#16213e] ring-2 ring-white ring-offset-2 ring-offset-[#16213e]"
                  : "bg-white/10 text-white/80 hover:bg-white/20"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-white/55">
          {t("ws_count_hint")}
        </p>
        <button
          onClick={() => onChoose(count)}
          className="mt-5 w-full rounded-xl bg-[#533afd] px-4 py-3 font-medium text-white transition-opacity hover:opacity-90"
        >
          {t("ws_count_confirm")} · {count} {t("ws_count_unit")}
        </button>
      </div>
    </div>
  );
}

/**
 * 工作流时间线：5 个阶段以勾选 / 当前 / 待办形式呈现，让用户清楚看到进展。
 *
 * Phase mapping:
 *   uploading    -> 客户端流程，不在这里展示（PreviewArea 顶部已经有 phase 文案）
 *   prechecking  -> stage[0] analyzing
 *   submitting   -> stage[1] matching
 *   polling      -> stageHint 真实告诉我们当前是 generating / lighting / finalizing
 */
function ProgressTimeline({
  phase,
  stageHint,
}: {
  phase:
    | "idle"
    | "uploading"
    | "prechecking"
    | "planning"
    | "choosing_count"
    | "submitting"
    | "polling"
    | "completed"
    | "failed";
  stageHint: string;
}) {
  const { t } = useLang();

  const STAGES: { key: string; label: string }[] = [
    { key: "analyzing", label: t("ws_stage_analyzing") },
    { key: "matching", label: t("ws_stage_matching") },
    { key: "generating", label: t("ws_stage_generating") },
    { key: "lighting", label: t("ws_stage_lighting") },
    { key: "finalizing", label: t("ws_stage_finalizing") },
  ];

  // map phase + stageHint to current stage index
  let currentIdx = 0;
  if (phase === "uploading" || phase === "planning") currentIdx = -1; // pre-stage
  else if (phase === "prechecking") currentIdx = 0;
  else if (phase === "submitting") currentIdx = 1;
  else if (phase === "polling") {
    // try to match stageHint (might be t() rendered, fall back by guessing)
    const lower = stageHint.toLowerCase();
    if (lower.includes("matching") || lower.includes("匹配")) currentIdx = 1;
    else if (lower.includes("lighting") || lower.includes("光影")) currentIdx = 3;
    else if (lower.includes("finalizing") || lower.includes("准备")) currentIdx = 4;
    else currentIdx = 2; // default to "generating"
  }

  return (
    <div className="w-full max-w-[420px] px-2 sm:px-4">
      {(phase === "uploading" || phase === "planning") && (
        <div className="mb-5 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          <div className="mt-2 text-[13px] sm:text-[15px] text-white/90">
            {phase === "planning" ? t("ws_stage_planning") : t("ws_uploading")}
          </div>
        </div>
      )}
      {phase !== "uploading" && phase !== "planning" && (
        <ol className="space-y-2.5 sm:space-y-3">
          {STAGES.map((stage, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            return (
              <li
                key={stage.key}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                  active
                    ? "bg-white/15"
                    : done
                      ? "opacity-90"
                      : "opacity-40"
                }`}
              >
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-semibold ${
                    done
                      ? "bg-emerald-400 text-emerald-950"
                      : active
                        ? "bg-white text-[#171717]"
                        : "bg-white/20 text-white/80"
                  }`}
                >
                  {done ? (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="4 11 8 15 16 6" />
                    </svg>
                  ) : active ? (
                    <span
                      className="h-2 w-2 animate-pulse rounded-full bg-[#171717]"
                      aria-hidden
                    />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </span>
                <span
                  className={`flex-1 text-left text-[13px] sm:text-[14px] ${
                    active ? "font-medium" : ""
                  }`}
                >
                  {stage.label}
                </span>
                {active && (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-4 text-center text-[11px] text-white/70 sm:text-[12px]">
        {t("ws_eta")}
      </div>
    </div>
  );
}
