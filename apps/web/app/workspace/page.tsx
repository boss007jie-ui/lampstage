"use client";

import Link from "next/link";
import { ArrowRight, ArrowsOut, CheckCircle, DownloadSimple, ImageSquare, List, SpinnerGap, UploadSimple, X, WarningCircle } from "@phosphor-icons/react";
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
  type TemplateLoadState,
} from "@/components/workspace/SceneSelector";
import { BRAND } from "@/lib/brand";
import { downloadOutputImage } from "@/lib/download-output";
import { DEFAULT_IMAGE_MODEL, getImageModel, IMAGE_MODELS, type ImageModelId } from "@/lib/image-models";

type PlatformStyle = "domestic_ecommerce" | "brand_site";
type AspectRatio = "1_1";
type AccountState = "loading" | "unauthorized" | "error" | "ready";

type Phase = "idle" | "uploading" | "prechecking" | "planning" | "choosing_count" | "submitting" | "polling" | "completed" | "failed" | "uncertain";

const ACCEPT_TYPES = "image/jpeg,image/png,image/webp";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function WorkspacePage() {
  const { t } = useLang();
  const [credit, setCredit] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [accountState, setAccountState] = useState<AccountState>("loading");
  const [loginOpen, setLoginOpen] = useState(false);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refreshMe = async () => {
    setAccountState("loading");
    setCredit(null);
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (response.status === 401) {
        setSignedIn(false);
        setAccountState("unauthorized");
        return;
      }
      if (!response.ok) throw new Error("account_unavailable");
      const data = await response.json();
      if (typeof data.credit_balance !== "number" || !Number.isFinite(data.credit_balance)) {
        throw new Error("invalid_credit_balance");
      }
      setSignedIn(true);
      setCredit(data.credit_balance);
      setAccountState("ready");
    } catch {
      // A failed lookup cannot establish that the user's session has ended.
      setAccountState("error");
    }
  };

  useEffect(() => {
    refreshMe();
  }, []);

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#262924]">
      {/* 手机顶部条 */}
      <MobileTopBar
        credit={credit}
        onMenu={() => setDrawerOpen(true)}
      />

      {/* 桌面 sidebar + 主内容；手机抽屉覆盖在最上层 */}
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[216px_minmax(0,1fr)]">
        <DesktopSidebar credit={credit} signedIn={signedIn} />
        <Main signedIn={signedIn} accountState={accountState} credit={credit} onRefreshCredit={refreshMe} onRequireLogin={() => setLoginOpen(true)} />
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
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#5b6350] px-5 py-3 text-[13px] text-white shadow-2xl">
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
      <div className="text-[15px] font-semibold tracking-tight text-[#262924]">
        {lang === "zh" ? `${BRAND.en} · ${BRAND.cn}` : BRAND.en}
      </div>
    </div>
  );
}

/** 手机端顶部条：紧凑、sticky，包含 logo + 额度 + 汉堡 */
function MobileTopBar({
  credit,
  onMenu,
}: {
  credit: number | null;
  onMenu: () => void;
}) {
  const { lang } = useLang();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#e5e5de] bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
      <Link href="/">
        <BrandLogo />
      </Link>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[#e5e5de] bg-[#f0f2eb] px-2.5 py-1 text-[12px]">
          <span className="font-mono font-semibold text-[#5b6350]">
            {credit ?? "—"}
          </span>
        </span>
        <button
          type="button"
          onClick={onMenu}
          aria-label={lang === "zh" ? "打开导航菜单" : "Open navigation menu"}
          className="grid h-9 w-9 place-items-center rounded-md border border-[#e5e5de] text-[#262924]"
        >
          <List size={20} />
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
    <aside className="hidden border-r border-[#e5e5de] bg-white p-5 lg:sticky lg:top-0 lg:block lg:h-screen">
      <Link href="/" className="mb-7 flex items-center gap-2">
        <BrandLogo />
      </Link>
      <nav className="text-[14px]">
        <NavItem href="/workspace" label={t("nav_generate")} active />
        <NavItem href="/my" label={t("nav_my_works")} />
        <NavItem href="/credits" label={t("nav_credits")} />
        <NavItem href="/help" label={t("nav_help")} />
      </nav>
      <div className="mt-7 rounded-2xl border border-[#e5e5de] bg-[#f0f2eb] p-4">
        <div className="text-[13px] text-[#6b7066]">
          {signedIn
            ? t("ws_credits_title_signed")
            : t("ws_credits_title_unsigned")}
        </div>
        <div className="text-[28px] font-semibold tracking-[-1px]">
          {credit ?? "—"}
        </div>
        <div className="text-[12px] text-[#6b7066]">
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
  const { t, lang } = useLang();
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      ref={drawerRef}
      aria-modal="true"
      aria-label={lang === "zh" ? "工作台导航" : "Workspace navigation"}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const focusable = drawerRef.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled])");
          if (!focusable?.length) return;
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}
      className="fixed inset-0 z-50 lg:hidden"
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
            aria-label={lang === "zh" ? "关闭导航菜单" : "Close navigation menu"}
            className="grid h-9 w-9 place-items-center rounded-md text-[#6b7066] hover:bg-[#f4f4ef]"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="text-[15px]">
          <NavItem href="/workspace" label={t("nav_generate")} active onClick={onClose} />
          <NavItem href="/my" label={t("nav_my_works")} onClick={onClose} />
          <NavItem href="/credits" label={t("nav_credits")} onClick={onClose} />
          <NavItem href="/help" label={t("nav_help")} onClick={onClose} />
        </nav>
        <div className="mt-5 rounded-2xl border border-[#e5e5de] bg-[#f0f2eb] p-4">
          <div className="text-[13px] text-[#6b7066]">
            {signedIn
              ? t("ws_credits_title_signed")
              : t("ws_credits_title_unsigned")}
          </div>
          <div className="text-[28px] font-semibold tracking-[-1px]">
            {credit ?? "—"}
          </div>
          <div className="text-[12px] text-[#6b7066]">
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
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`mb-1 block rounded-xl px-3 py-2.5 transition-colors ${
        active
          ? "bg-[#5b6350] text-white"
          : "text-[#6b7066] hover:bg-[#5b6350] hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function Main({
  signedIn,
  accountState,
  credit,
  onRefreshCredit,
  onRequireLogin,
}: {
  signedIn: boolean;
  accountState: AccountState;
  credit: number | null;
  onRefreshCredit: () => Promise<void>;
  onRequireLogin: () => void;
}) {
  const { t, lang } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesState, setTemplatesState] = useState<TemplateLoadState>("loading");
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [platformStyle, setPlatformStyle] =
    useState<PlatformStyle>("domestic_ecommerce");
  const aspect: AspectRatio = "1_1";
  const [imageModel, setImageModel] = useState<ImageModelId>(DEFAULT_IMAGE_MODEL);

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [requestedCount, setRequestedCount] = useState<number | null>(null);
  const [submittedSettings, setSubmittedSettings] = useState<{ aspect: AspectRatio; platformStyle: PlatformStyle; imageModel: ImageModelId } | null>(null);
  const [plannedBody, setPlannedBody] = useState<Record<string, unknown> | undefined>();
  const [planningNote, setPlanningNote] = useState<string | null>(null);
  const submitLock = useRef(false);
  const uploadVersion = useRef(0);
  const copy = (zh: string, en: string) => lang === "zh" ? zh : en;
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
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (["planning", "choosing_count", "submitting"].includes(phase) && window.innerWidth < 1440) {
      resultRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [phase]);
  // A changed input needs a fresh plan before its confirmation can be submitted.
  useEffect(() => {
    if (phase === "choosing_count") {
      setPhase("idle"); setPlannedAssetId(null); setPlannedBody(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformStyle, aspect, imageModel, sceneKind, templateId, recommendedSceneIdx, customPrompt, lampProfile, suggestions]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setTemplatesState("loading");
    setTemplatesError(null);
    fetch("/api/templates", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.templates)) throw new Error("invalid_template_response");
        return data.templates as Template[];
      })
      .then((templates) => {
        if (cancelled) return;
        const list = templates.slice().sort((a, b) => a.sort_order - b.sort_order);
        setTemplates(list);
        setTemplateId(current => list.some(template => template.id === current) ? current : list[0]?.id ?? null);
        setTemplatesState(list.length ? "ready" : "empty");
      })
      .catch((error) => {
        if (cancelled) return;
        setTemplates([]);
        setTemplateId(null);
        setTemplatesError(error instanceof Error ? error.message : "template_request_failed");
        setTemplatesState("error");
      });
    return () => { cancelled = true; controller.abort(); };
  }, [templatesAttempt]);

  const generating = phase !== "idle" && phase !== "completed" && phase !== "failed";
  // busy：构思/提交/生成进行中（禁用"场景构思"按钮）。choosing_count 是暂停态，
  // 不算 busy —— 顾客此时若展开设置，可以改完重新构思。
  const busy = generating && phase !== "choosing_count";
  const accountBlocked = accountState === "loading" || accountState === "error";
  const sceneReady = useMemo(() => {
    if (newLampFlow) return Boolean(lampProfile);
    if (sceneKind === "template") return templatesState === "ready" && Boolean(templateId);
    if (sceneKind === "recommended") return suggestions.length > 0 && Boolean(suggestions[recommendedSceneIdx]);
    if (sceneKind === "custom") return customPrompt.trim().length > 0;
    return false;
  }, [newLampFlow, lampProfile, sceneKind, templateId, templatesState, suggestions, recommendedSceneIdx, customPrompt]);
  const canGenerate = useMemo(
    () => Boolean(file && sceneReady && !fileError && !busy && !accountBlocked),
    [file, sceneReady, fileError, busy, accountBlocked],
  );

  const onPick = (f: File | null) => {
    if (busy) return;
    if (f && (!ACCEPT_TYPES.split(",").includes(f.type) || f.size > MAX_FILE_BYTES)) {
      setFileError(t(f.size > MAX_FILE_BYTES ? "ws_err_size" : "ws_err_format"));
      return;
    }
    const version = ++uploadVersion.current;
    setLampProfile(null);
    setPlannedAssetId(null);
    setPlannedBody(undefined);
    setSettingsCollapsed(false);
    setJobId(null);
    setRequestedCount(null);
    setSubmittedSettings(null);
    setFileError(null);
    setUploadedAssetId(null);
    setSuggestions([]);
    setSuggesting(false);
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
        if (version !== uploadVersion.current) return;
        if (!upRes.ok) {
          if (upRes.status === 401) {
            onRequireLogin();
            setPhase("idle"); // upload can be retried after login
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
        if (version !== uploadVersion.current) return;
        setFileError(String(e));
        setPhase("failed");
      }
    })();
  };

  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  // A file selected before sign-in still needs an uploaded asset for recognition.
  useEffect(() => {
    if (signedIn && file && !uploadedAssetId && phase === "idle") onPick(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

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
  // choosing_count 让顾客选张数；旧流程也确认默认 3 张及额度后再生成。
  const startPlanning = async () => {
    if (!canGenerate || !file) return;
    if (!signedIn) {
      onRequireLogin();
      return;
    }
    setErrMsg(null);
    setPlanningNote(null);
    setJobId(null);
    setSubmittedSettings(null);
    setOutputs([]);
    setRequestedCount(null);
    setStageHint(null);
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
      if (!newLampFlow && sceneKind === "template" && templateId) {
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
        image_model: imageModel,
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
          const planResponse = await fetch("/api/generation/plan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              uploaded_asset_id: assetId,
              platform_style: platformStyle,
              aspect_ratio: aspect,
            }),
          });
          if (!planResponse.ok) throw new Error("plan_unavailable");
        } catch {
          setPlanningNote(copy("场景构思服务暂不可用，将使用默认场景方案。", "Scene planning is unavailable. Generation will use the default scene plan."));
        }
        // 构思完成 → 记住 asset，让顾客选出图数量
        setPlannedAssetId(assetId);
        setPlannedBody(undefined);
        setPhase("choosing_count");
        return;
      }

      // 旧流程同样允许按张选择，在确认额度后提交原有请求体。
      setPlannedAssetId(assetId);
      setPlannedBody(submitBody);
      setPhase("choosing_count");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "user_cancelled_template") {
        setErrMsg(msg);
      }
      setPhase("failed");
    }
  };

  const checkJob = async (id: string) => {
    setPhase("polling");
    setErrMsg(null);
    try {
      const finalJob = await pollJob(id, setStageHint);
      setOutputs(finalJob.output_images);
      if (finalJob.status === "completed") setPhase("completed");
      else {
        setErrMsg(finalJob.failure_reason || copy("任务未完成，请查看额度记录。", "The job failed. Check your credit history."));
        setPhase("failed");
      }
      await onRefreshCredit();
    } catch {
      setPhase("uncertain");
      setErrMsg(copy("暂时无法确认任务状态。任务可能仍在处理，请重新查询或到我的作品查看。", "The job status is not confirmed. It may still be processing. Check again or open My works."));
    }
  };

  const runGeneration = async (assetId: string, count: number, prebuiltBody?: Record<string, unknown>) => {
    if (submitLock.current || phase !== "choosing_count" || accountBlocked) return;
    if (!signedIn) { onRequireLogin(); return; }
    submitLock.current = true;
    setRequestedCount(count);
    setSubmittedSettings({ aspect, platformStyle, imageModel });
    setJobId(null);
    setOutputs([]);
    setErrMsg(null);
    setStageHint(null);
    setPhase("submitting");
    try {
      const submitBody = { ...(prebuiltBody ?? { uploaded_asset_id: assetId, platform_style: platformStyle, aspect_ratio: aspect }), image_model: imageModel, image_count: count };
      const response = await fetch("/api/generation/jobs", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submitBody),
      });
      const sub = await response.json().catch(() => ({}));
      if (!response.ok && response.status < 500) {
        if (sub.error === "insufficient_credits") { setQuotaExhaustedOpen(true); setPhase("choosing_count"); return; }
        if (response.status === 401) { onRequireLogin(); setPhase("choosing_count"); return; }
        setErrMsg(sub.error || t("ws_err_generic"));
        setPhase("failed");
        return;
      }
      if (!response.ok || !sub.job_id) throw new Error("submission_unconfirmed");
      setJobId(sub.job_id);
      await checkJob(sub.job_id);
    } catch {
      setErrMsg(copy("提交结果暂未确认，请先到我的作品核对，避免重复提交。", "Submission is not confirmed. Check My works before submitting again."));
      setPhase("uncertain");
    } finally { submitLock.current = false; }
  };

  const knownStages = ["analyzing", "matching", "generating", "lighting", "finalizing"];
  const stageText = stageHint && knownStages.includes(stageHint)
    ? t(`ws_stage_${stageHint}` as never)
    : copy("正在查询任务状态", "Checking job status");

  return (
    <main className="min-w-0 px-4 py-6 sm:px-6 xl:px-8 xl:py-9">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.5px] sm:text-[28px] md:text-[32px] md:tracking-[-1px]">
            {copy("为你的素材，创造下一份内容", "Create the next piece of content for your asset")}
          </h1>
          <p className="mt-2 text-[14px] text-[#6b7066] md:text-[15px]">
            {copy("上传素材，确认任务信息，把内容构思变成可核对、可下载的结果。", "Upload your asset, confirm the task, then create content to review and download.")}
          </p>
        </div>
        <div className="hidden rounded-full border border-[#ddd] bg-white px-3 py-2 text-[13px] text-[#6b7066] md:block">
          {t("ws_mode_chip")}
        </div>
      </div>

      {accountState === "loading" && <div role="status" className="mb-5 flex items-center gap-2 rounded-xl border border-[#e5e5de] bg-white p-4 text-sm text-[#6b7066]"><SpinnerGap size={18} className="shrink-0 animate-spin" />{copy("正在读取账户与可用额度…", "Loading your account and available credits…")}</div>}
      {accountState === "error" && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm leading-6 text-amber-900">{copy("账户与额度暂时无法读取。请重试，读取成功后可继续生成。", "Your account and credits could not be loaded. Retry to continue generating.")}</p><button type="button" onClick={() => void onRefreshCredit()} className="btn btn-outline">{copy("重试读取账户", "Retry account lookup")}</button></div>}
      <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#6b7066]" aria-label={copy("生成流程", "Creation steps")}>
        {[copy("上传素材", "Upload"), copy("识别与确认", "Confirm details"), copy("选择模型与方图", "Model & square image"), copy("场景构思", "Plan scenes"), copy("确认数量", "Confirm count"), copy("生成", "Generate"), copy("核对与下载", "Review & download")].map((label, index) => <li key={label} className="flex items-center gap-2"><span className="grid h-5 w-5 place-items-center rounded-full border border-[#e5e5de] bg-white">{index + 1}</span>{label}</li>)}
      </ol>
      <section className="grid min-w-0 grid-cols-1 items-start gap-6 min-[1440px]:grid-cols-[minmax(0,500px)_minmax(0,1fr)]">
        <Panel title={t("ws_panel_settings")}>
          <fieldset disabled={busy} className="min-w-0 disabled:opacity-70">
          <Step n={1} label={copy("上传源素材", "Upload original source asset")}>
            <UploadZone
              fileInputRef={fileInputRef}
              file={file}
              filePreview={filePreview}
              error={fileError}
              onPick={onPick}
            />
          </Step>

          <Step n={2} label={newLampFlow ? copy("识别并确认任务信息", "Confirm task details") : t("ws_step_scene")}>
            {newLampFlow && uploadedAssetId && settingsCollapsed ? (
              <button
                onClick={() => setSettingsCollapsed(false)}
                className="w-full rounded-2xl border border-[#e5e5de] bg-[#f7f7f2] px-4 py-3 text-left text-[13px] text-[#6b7066] transition-colors hover:bg-[#eef2f7]"
              >
                {lampProfile
                  ? `${lampTypeLabel(lampProfile.lamp_type)} · ${t("ws_expand_settings")}`
                  : t("ws_expand_settings")}
              </button>
            ) : newLampFlow && uploadedAssetId ? (
              <LampProfileCard
                key={uploadedAssetId}
                assetId={uploadedAssetId}
                onReady={setLampProfile}
              />
            ) : newLampFlow ? (
              <div className="rounded-2xl border border-[#e5e5de] bg-[#f7f7f2] p-4 text-[13px] text-[#6b7066]">
                {copy("上传素材后识别信息；可确认内容事实、尺寸与视觉约束。", "Upload a source asset to recognize details. Confirm product facts, dimensions and visual constraints.")}
              </div>
            ) : (
              <SceneSelector
                file={file}
                uploadedAssetId={uploadedAssetId}
                templates={templates}
                templateId={templateId}
                setTemplateId={setTemplateId}
                templatesError={templatesError}
                templatesState={templatesState}
                onRetryTemplates={() => setTemplatesAttempt(value => value + 1)}
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

          <Step n={4} label={copy("图片模型", "Image model")}>
            <div role="radiogroup" aria-label={copy("图片模型", "Image model")} className="grid gap-2 sm:grid-cols-2">
              {IMAGE_MODELS.map(model => (
                <label key={model.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-[#5b6350] focus-within:ring-offset-2 ${imageModel === model.id ? "border-[#5b6350] bg-[#f0f2eb]" : "border-[#e5e5de] bg-white hover:border-[#9ca693]"}`}>
                  <input type="radio" name="image-model" value={model.id} checked={imageModel === model.id} onChange={() => setImageModel(model.id)} className="mt-1 accent-[#5b6350]" />
                  <span><span className="block text-sm font-medium text-[#262924]">{model.name}</span><span className="mt-1 block text-xs text-[#6b7066]">{copy(`最多 ${model.maxReferences} 张参考图`, `Up to ${model.maxReferences} reference ${model.maxReferences === 1 ? "image" : "images"}`)}</span></span>
                </label>
              ))}
            </div>
          </Step>

          <Step n={5} label={t("ws_step_aspect")}>
            <div className="rounded-xl border border-[#5b6350] bg-[#f0f2eb] px-3 py-2 text-sm font-medium text-[#262924]">{t("ws_aspect_1_1")}</div>
            <p className="mt-2 text-xs leading-5 text-[#6b7066]">{copy("当前两个模型提供方图，实际尺寸以成品为准。", "Both models currently provide square images. Actual dimensions depend on the finished image.")}</p>
          </Step>

          <button
            onClick={startPlanning}
            disabled={!canGenerate || busy}
            className="btn btn-primary mt-2 w-full gap-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {(busy && phase !== "uncertain") ? <SpinnerGap size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            {phase === "uncertain" ? copy("请先确认任务状态", "Check the job status first") : busy ? copy("处理中", "Processing") : copy("构思场景并继续", "Plan scenes & continue")}
          </button>
          {phase === "uncertain" && <p role="status" className="mt-2 text-xs text-amber-800">{copy("请先核对本次任务状态，再发起新的生成。", "Check the current job status before starting a new generation.")}</p>}
          <p className="mt-2 text-center text-[12px] text-[#6b7066]">
            {copy("下一步确认数量与预计额度，每张图片 1 额度。", "Confirm image count and estimated credits next. 1 credit per image.")}
          </p>
          </fieldset>
          {accountState === "unauthorized" && file && <button className="btn btn-outline mt-3 w-full" onClick={onRequireLogin}>{copy("登录并继续上传", "Sign in to continue uploading")}</button>}
        </Panel>

        <div ref={resultRef} className="min-w-0 scroll-mt-24">
        <Panel title={copy("结果预览", "Result preview")}>
          <PreviewArea
            platformStyle={submittedSettings?.platformStyle ?? platformStyle}
            aspect={submittedSettings?.aspect ?? aspect}
            imageModel={submittedSettings?.imageModel ?? imageModel}
            phase={phase}
            stageText={stageText}
            outputs={outputs}
            errMsg={errMsg}
            filePreview={filePreview}
            spaceCount={(lampProfile?.space_fit ?? []).length || 3}
            newLampFlow={newLampFlow}
            accountBlocked={accountBlocked}
            requestedCount={requestedCount}
            credit={credit}
            planningNote={planningNote}
            onCheck={jobId ? () => void checkJob(jobId) : undefined}
            onChooseCount={(n) => {
              if (plannedAssetId) void runGeneration(plannedAssetId, n, plannedBody);
            }}
          />
        </Panel>
        </div>
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

async function pollJob(jobId: string, onStage: (stage: string) => void): Promise<{
  status: "completed" | "failed";
  failure_reason: string | null;
  output_images: { id: string; image_url: string }[];
}> {
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    try {
      const res = await fetch(`/api/generation/jobs/${jobId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const data = await res.json();
        if (data.stage_hint) onStage(data.stage_hint);
        if (data.status === "completed" || data.status === "failed") return {
          status: data.status, failure_reason: data.failure_reason ?? null,
          output_images: data.outputs ?? data.output_images ?? [],
        };
      }
    } catch { /* A network error does not establish the job's outcome. */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("status_unconfirmed");
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
        <p className="mt-2 text-[14px] leading-relaxed text-[#6b7066]">
          {t("ws_mismatch_body", { template, detected })}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-[#e5e5de] bg-white px-4 py-2 text-[14px] text-[#262924]"
          >
            {t("ws_mismatch_change")}
          </button>
          <button
            onClick={onContinue}
            className="rounded-md bg-[#5b6350] px-4 py-2 text-[14px] text-white"
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
      className="min-w-0 overflow-hidden rounded-[16px] border border-[#e5e5de] bg-white md:rounded-[18px]"
      style={{ boxShadow: "0 12px 40px rgba(30,20,10,.05)" }}
    >
      <h2 className="border-b border-[#e5e5de] p-3.5 text-[14px] font-semibold sm:p-4 sm:text-[15px]">
        {title}
      </h2>
      <div className="min-w-0 p-4 md:p-5">{children}</div>
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
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#5b6350] text-[12px] text-white">
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
  const { t, lang } = useLang();
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
        aria-label={lang === "zh" ? (file ? "更换源素材" : "上传源素材") : (file ? "Replace source asset" : "Upload source asset")}
        className="grid h-40 w-full place-items-center rounded-2xl border-[1.5px] border-dashed border-[#d9ddd2] bg-gradient-to-br from-white to-[#f7f7f2] px-3 text-center text-[#6b7066] transition-colors hover:border-[#5b6350] sm:h-44"
      >
        {filePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={filePreview}
            alt="uploaded source asset"
            className="max-h-36 max-w-full rounded-xl object-contain sm:max-h-40"
          />
        ) : (
          <div>
            <UploadSimple size={26} className="mx-auto mb-2" /><div className="font-semibold text-[#5b6350]">{lang === "zh" ? "上传你的素材" : "Upload your source asset"}</div>
            <div className="text-[12px] sm:text-[13px]">{t("ws_upload_hint")}</div>
            <div className="mt-1 text-[11px] text-[#6b7066]">
              {t("ws_upload_max")}
            </div>
          </div>
        )}
      </button>
      {file && (
        <div className="mt-2 flex items-center justify-between text-[12px] text-[#6b7066]">
          <span className="min-w-0 truncate pr-2">{file.name}</span><button type="button" onClick={() => fileInputRef.current?.click()} className="mr-3 shrink-0 underline">{lang === "zh" ? "更换" : "Replace"}</button>
          <button
            type="button"
            className="flex-none text-[#6b7066] underline-offset-2 hover:underline"
            onClick={() => {
              if (fileInputRef.current) fileInputRef.current.value = "";
              onPick(null);
            }}
          >
            {t("ws_upload_remove")}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12px] text-red-600">{error}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-[#6b7066]">
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
    <div className="flex rounded-xl border border-[#e5e5de] bg-[#fafafa] p-1">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-lg px-2 py-2 text-[12px] transition-colors sm:px-3 sm:text-[13px] ${
              on ? "bg-[#5b6350] text-white" : "text-[#6b7066] hover:text-[#5b6350]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PreviewArea({ platformStyle, aspect, imageModel, phase, stageText, outputs, errMsg, filePreview, spaceCount, newLampFlow, accountBlocked, requestedCount, credit, planningNote, onCheck, onChooseCount }: {
  platformStyle: PlatformStyle; aspect: AspectRatio; imageModel: ImageModelId; phase: Phase; stageText: string;
  outputs: { id: string; image_url: string }[]; errMsg: string | null; filePreview: string | null;
  spaceCount: number; newLampFlow: boolean; accountBlocked: boolean; requestedCount: number | null; credit: number | null;
  planningNote: string | null; onCheck?: () => void; onChooseCount: (n: number) => void;
}) {
  const { t, lang } = useLang();
  const copy = (zh: string, en: string) => lang === "zh" ? zh : en;
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewOriginal, setViewOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { setActiveIdx(0); setViewOriginal(false); }, [outputs]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (expanded) dialog?.showModal(); else dialog?.close();
  }, [expanded]);
  const aspectLabel = aspect.replace("_", ":");
  const modelName = getImageModel(imageModel).name;
  const active = outputs[Math.min(activeIdx, Math.max(0, outputs.length - 1))];
  const currentImage = viewOriginal ? filePreview : active?.image_url;
  const isWorking = ["uploading", "prechecking", "planning", "submitting", "polling"].includes(phase);
  const status = phase === "uploading" ? copy("正在上传素材", "Uploading source asset")
    : phase === "prechecking" ? copy("正在核对模板与素材类型", "Checking asset compatibility")
    : phase === "planning" ? copy("正在构思场景", "Planning scenes")
    : phase === "submitting" ? copy("生成请求处理中，等待服务返回", "Generation request is processing") : stageText;
  const displayErrMsg = errMsg && (
    errMsg.includes("provider_migration_required") ||
    errMsg.includes("图片服务账号已迁移") ||
    errMsg.includes("image service account has migrated")
  ) ? copy("图片服务账号已迁移，请管理员更新图片配置后重试。", "The image service account has migrated. Please ask an administrator to update the image configuration, then retry.") : errMsg;

  return <div className="min-w-0">
    <div className="mb-4 flex flex-wrap gap-2 text-xs text-[#6b7066]">
      <span className="rounded-full border border-[#e5e5de] px-2.5 py-1">{aspectLabel}</span>
      <span className="rounded-full border border-[#e5e5de] px-2.5 py-1">{modelName}</span>
      <span className="rounded-full border border-[#e5e5de] px-2.5 py-1">{platformStyle === "domestic_ecommerce" ? t("ws_platform_domestic") : t("ws_platform_brand")}</span>
    </div>
    {phase === "choosing_count" ? <CountSelector modelName={modelName} spaceCount={spaceCount} newLampFlow={newLampFlow} accountBlocked={accountBlocked} credit={credit} planningNote={planningNote} onChoose={onChooseCount} />
      : phase === "uncertain" || (phase === "failed" && errMsg) ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <WarningCircle size={28} className="mb-3 text-amber-700" />
        <h3 className="font-semibold">{phase === "uncertain" ? copy("任务状态待确认", "Job status unconfirmed") : copy("本次操作未完成", "This operation did not complete")}</h3>
        <p className="mt-2 break-words text-sm leading-6 text-[#6b7066]">{displayErrMsg}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {onCheck && <button onClick={onCheck} className="btn btn-primary">{copy("重新查询状态", "Check status again")}</button>}
          <Link href="/my" className="btn btn-outline">{t("nav_my_works")}</Link>
          <Link href="/credits" className="self-center text-sm underline">{copy("查看额度记录", "Credit history")}</Link>
        </div>
      </div> : phase === "completed" ? <div>
        <div role="status" className="mb-4 rounded-xl bg-[#f0f2eb] p-4">
          <div className="flex items-center gap-2 font-medium"><CheckCircle size={20} className="shrink-0 text-[#5b6350]" />{copy("任务已结束", "Job finished")} · {modelName} · {copy("已生成", "Generated")} {outputs.length}{requestedCount !== null ? ` / ${requestedCount}` : ""} {copy("张", "images")}</div>
          <p className="mt-2 text-xs leading-5 text-[#6b7066]">{copy("下载前，请对照源素材核对主体细节、比例、文字与任务要求。", "Before downloading, compare subject details, proportions, text and task requirements with your source.")}</p>
          {requestedCount !== null && outputs.length < requestedCount && <p className="mt-2 text-xs leading-5 text-amber-800">{copy("实际产出少于所选数量；请到额度记录核对本次扣费。", "Fewer images were returned than requested. Check this job’s charge in credit history.")} <Link href="/credits" className="underline">{copy("查看记录", "View history")}</Link></p>}
        </div>
        {active ? <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button className="btn btn-outline text-xs" aria-pressed={!viewOriginal} onClick={() => setViewOriginal(false)}>{copy("场景结果", "Scene result")}</button>
              {filePreview && <button className="btn btn-outline text-xs" aria-pressed={viewOriginal} onClick={() => setViewOriginal(true)}>{copy("对照原图", "Compare original")}</button>}
            </div>
            <button className="icon-button" aria-label={copy("放大当前图片", "Enlarge current image")} onClick={() => setExpanded(true)}><ArrowsOut size={20} /></button>
          </div>
          <button className="block w-full overflow-hidden rounded-xl bg-[#f4f3ef]" aria-label={copy("放大当前图片", "Enlarge current image")} onClick={() => setExpanded(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentImage ?? active.image_url} alt={viewOriginal ? copy("上传的源素材", "Original source asset") : copy(`场景结果 ${activeIdx + 1}`, `Scene result ${activeIdx + 1}`)} className="max-h-[640px] min-h-48 w-full object-contain" />
          </button>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">{outputs.map((output, index) => <button key={output.id} onClick={() => { setActiveIdx(index); setViewOriginal(false); }} aria-label={copy(`查看场景 ${index + 1}`, `View scene ${index + 1}`)} aria-pressed={index === activeIdx} className={`h-16 w-12 overflow-hidden rounded-md border-2 ${index === activeIdx ? "border-[#5b6350]" : "border-transparent"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={output.image_url} alt="" className="h-full w-full object-cover" />
            </button>)}</div>
            <DownloadBtn output={active} />
          </div>
          <dialog ref={dialogRef} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)} className="m-auto max-h-[95vh] w-[min(94vw,1100px)] rounded-2xl bg-[#faf9f6] p-4 backdrop:bg-black/60" aria-label={copy("图片放大查看", "Enlarged image")}>
            <div className="mb-3 flex justify-end"><button className="icon-button" onClick={() => setExpanded(false)} aria-label={copy("关闭放大图片", "Close image")}><X size={22} /></button></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentImage ?? active.image_url} alt={copy("当前核对图片", "Image being reviewed")} className="max-h-[80vh] w-full object-contain" />
          </dialog>
        </> : <p className="py-12 text-center text-sm text-[#6b7066]">{copy("服务未返回可显示的图片，请查看我的作品或额度记录。", "No images were returned. Check My works or credit history.")}</p>}
      </div> : isWorking ? <div role="status" aria-live="polite" className="grid min-h-[360px] place-items-center rounded-2xl border border-[#e5e5de] bg-[#f4f4ef] p-8 text-center">
        <div><SpinnerGap size={32} className="mx-auto mb-4 animate-spin text-[#5b6350] motion-reduce:animate-none" /><h3 className="font-medium">{status}</h3><p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-[#6b7066]">{copy("结果返回后会在这里显示。生成期间请保留当前页面。", "Results will appear here when returned. Keep this page open while the job is processing.")}</p>{requestedCount !== null && <p className="mt-4 text-xs text-[#6b7066]">{copy(`本次使用 ${modelName}，请求 ${requestedCount} 张`, `${requestedCount} images requested with ${modelName}`)}</p>}</div>
      </div> : <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-[#d9ddd2] bg-[#f7f7f2] p-6 text-center">
        <div className="max-w-sm"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-[#e5e5de] bg-white"><ImageSquare size={30} className="text-[#5b6350]" /></div><h3 className="text-lg font-medium">{copy("你的素材，准备进入新工作流", "Your asset, ready for a new workflow")}</h3><p className="mt-3 text-sm leading-6 text-[#6b7066]">{copy("先上传一份清晰素材。完成任务确认和内容构思后，在这里选择数量并开始生成。", "Start with a clear source asset. Confirm the task and plan content, then select a count here to generate.")}</p>{filePreview && <div className="mt-6 flex items-center justify-center gap-3 text-xs text-[#6b7066]">{/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={filePreview} alt={copy("已上传的源素材", "Uploaded source asset")} className="h-16 w-16 rounded-lg border border-[#e5e5de] bg-white object-contain" />{copy("原图已准备，继续确认设置", "Original ready. Continue with your settings.")}</div>}</div>
      </div>}
  </div>;
}

function CountSelector({ modelName, spaceCount, newLampFlow, accountBlocked, credit, planningNote, onChoose }: { modelName: string; spaceCount: number; newLampFlow: boolean; accountBlocked: boolean; credit: number | null; planningNote: string | null; onChoose: (n: number) => void }) {
  const { lang } = useLang();
  const copy = (zh: string, en: string) => lang === "zh" ? zh : en;
  const [count, setCount] = useState(newLampFlow ? Math.min(3, Math.max(1, spaceCount)) : 3);
  return <div className="rounded-2xl border border-[#e5e5de] bg-[#f7f7f2] p-5 sm:p-7">
    <h3 className="text-lg font-medium">{copy("确认本次生成", "Confirm generation")}</h3>
    <p className="mt-2 text-sm leading-6 text-[#6b7066]">{copy(`本次使用 ${modelName} 生成方图。选择图片数量，确认后开始生成。`, `This generation uses ${modelName} for square images. Choose an image count to continue.`)}</p>
    {planningNote && <p role="status" className="mt-3 text-xs leading-5 text-amber-800">{planningNote}</p>}
    <div className="my-6 grid grid-cols-4 gap-2">{[1, 2, 3, 4].map(n => <button key={n} onClick={() => setCount(n)} aria-pressed={n === count} className={`rounded-xl border py-4 text-lg font-medium ${n === count ? "border-[#5b6350] bg-[#5b6350] text-white" : "border-[#e5e5de] bg-white"}`}>{n}<span className="ml-1 text-xs">{copy("张", "img")}</span></button>)}</div>
    <div className="space-y-2 border-t border-[#e5e5de] pt-4 text-sm"><p className="flex justify-between gap-3"><span>{copy("预计使用额度", "Estimated credits")}</span><strong>{count}</strong></p><p className="flex justify-between gap-3 text-[#6b7066]"><span>{copy("当前可用额度", "Available credits")}</span><span>{credit === null ? copy("暂未获取", "Unavailable") : credit}</span></p></div>
    <p className="mt-3 text-xs text-[#6b7066]">{copy("每张图片使用 1 额度，可先生成 1 张试用效果。", "Each image uses 1 credit. Start with one image to check the result.")}</p>
    <button disabled={accountBlocked} onClick={() => onChoose(count)} className="btn btn-primary mt-6 w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50"><ArrowRight size={18} />{copy(`开始生成 ${count} 张图片`, `Generate ${count} images`)}</button>
  </div>;
}

function DownloadBtn({ output }: { output: { id: string; image_url: string } }) {
  const { t, lang } = useLang();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [output.id]);
  const onDownload = async () => {
    if (loading) return;
    setLoading(true); setError(false);
    try {
      await downloadOutputImage(output.id);
    } catch { setError(true); } finally { setLoading(false); }
  };
  return <div><button onClick={onDownload} disabled={loading} className="btn btn-primary gap-2 disabled:opacity-50">{loading ? <SpinnerGap size={18} className="animate-spin" /> : <DownloadSimple size={18} />}{t("ws_btn_download")}</button>{error && <p role="alert" className="mt-2 text-xs text-red-700">{lang === "zh" ? "下载失败，请重试。" : "Download failed. Please retry."}</p>}</div>;
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
          <p className="mt-2 text-[13px] leading-relaxed text-[#6b7066]">
            {t("quota_subtitle")}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => setLeadOpen(true)}
              className="w-full rounded-md bg-[#5b6350] px-4 py-2.5 font-medium text-white"
            >
              {t("plan_btn_contact")}
            </button>
            <Link
              href="/credits"
              className="w-full rounded-md border border-[#e5e5de] px-4 py-2.5 text-center text-[14px] text-[#5b6350]"
            >
              {t("quota_btn_topup")}
            </Link>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 text-[13px] text-[#6b7066]"
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
