"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/components/i18n/LangProvider";

export type Scene = {
  title: string;
  pitch: string;
  prompt_en: string;
  best_for: string[];
};

export type Template = {
  id: string;
  name: string;
  category: string;
  lamp_type: string;
  scene_space: string;
  preview_image_url: string;
  sort_order: number;
};

export type TemplateLoadState = "loading" | "error" | "ready" | "empty";

const STYLE_TAGS = [
  { zh: "温馨", en: "Cozy" },
  { zh: "现代", en: "Modern" },
  { zh: "极简", en: "Minimalist" },
  { zh: "工业风", en: "Industrial" },
  { zh: "北欧", en: "Scandinavian" },
  { zh: "日式", en: "Japanese" },
  { zh: "奢华", en: "Luxury" },
  { zh: "民宿", en: "Guesthouse" },
  { zh: "商业空间", en: "Commercial space" },
  { zh: "夜晚", en: "Nighttime" },
];

export function SceneSelector(props: {
  file: File | null;
  uploadedAssetId: string | null;
  templates: Template[];
  templateId: string | null;
  setTemplateId: (id: string | null) => void;
  templatesError: string | null;
  templatesState: TemplateLoadState;
  onRetryTemplates: () => void;
  sceneKind: "recommended" | "template" | "custom";
  setSceneKind: (k: "recommended" | "template" | "custom") => void;
  recommendedSceneIdx: number;
  setRecommendedSceneIdx: (i: number) => void;
  suggestions: Scene[];
  setSuggestions: (s: Scene[]) => void;
  suggesting: boolean;
  setSuggesting: (b: boolean) => void;
  suggestError: string | null;
  setSuggestError: (e: string | null) => void;
  customPrompt: string;
  setCustomPrompt: (s: string) => void;
}) {
  const { t, lang } = useLang();
  const {
    file,
    uploadedAssetId,
    templates,
    templateId,
    setTemplateId,
    templatesError,
    templatesState,
    onRetryTemplates,
    sceneKind,
    setSceneKind,
    recommendedSceneIdx,
    setRecommendedSceneIdx,
    suggestions,
    setSuggestions,
    suggesting,
    setSuggesting,
    suggestError,
    setSuggestError,
    customPrompt,
    setCustomPrompt,
  } = props;

  const activeAsset = useRef(uploadedAssetId);
  activeAsset.current = uploadedAssetId;
  const runSuggest = async () => {
    if (!uploadedAssetId) return;
    const requestAsset = uploadedAssetId;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const r = await fetch("/api/generation/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploaded_asset_id: uploadedAssetId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error === "provider_migration_required" ? "provider_migration_required" : "suggest_failed");
      }
      const data = (await r.json()) as { scenes: Scene[] };
      if (activeAsset.current !== requestAsset) return;
      setSuggestions(data.scenes || []);
      setRecommendedSceneIdx(0);
    } catch (e) {
      if (activeAsset.current === requestAsset) setSuggestError(e instanceof Error ? e.message : "suggest_failed");
    } finally {
      if (activeAsset.current === requestAsset) setSuggesting(false);
    }
  };

  useEffect(() => {
    if (
      sceneKind === "recommended" &&
      uploadedAssetId &&
      suggestions.length === 0 &&
      !suggesting &&
      !suggestError
    ) {
      void runSuggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKind, uploadedAssetId]);

  const tabs = [
    { value: "recommended", label: t("ws_tab_recommended") },
    { value: "template", label: t("ws_tab_template") },
    { value: "custom", label: t("ws_tab_custom") },
  ] as const;

  return (
    <div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {tabs.map((tab) => {
          const on = sceneKind === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-pressed={on}
              onClick={() => setSceneKind(tab.value)}
              className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                on ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {sceneKind === "recommended" && (
        <RecommendedScenes
          file={file}
          uploadedAssetId={uploadedAssetId}
          suggestions={suggestions}
          suggesting={suggesting}
          suggestError={suggestError}
          selectedIdx={recommendedSceneIdx}
          onSelect={setRecommendedSceneIdx}
          onRetry={runSuggest}
        />
      )}

      {sceneKind === "template" && (
        <>
          {templatesState === "loading" && <p role="status" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[13px] text-[var(--color-muted)]">{lang === "zh" ? "正在读取场景模板…" : "Loading scene templates…"}</p>}
          {templatesState === "error" && <div role="alert" className="rounded-xl border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4 text-[13px] text-[var(--color-danger)]"><p>{lang === "zh" ? "场景模板暂时无法读取，请重试。" : "Scene templates could not be loaded. Please retry."}</p>{templatesError && <p className="mt-1 break-words text-xs">{templatesError}</p>}<button type="button" onClick={onRetryTemplates} className="btn btn-outline mt-3">{lang === "zh" ? "重新读取模板" : "Retry loading templates"}</button></div>}
          {templatesState === "empty" && <div role="status" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[13px] text-[var(--color-muted)]"><p>{lang === "zh" ? "暂无可用模板，可切换智能推荐或自定义场景。" : "No templates are available. Try recommended or custom scenes."}</p><button type="button" onClick={onRetryTemplates} className="btn btn-outline mt-3">{lang === "zh" ? "刷新模板" : "Refresh templates"}</button></div>}
          {templatesState === "ready" && <TemplateGrid templates={templates} selectedId={templateId} onSelect={setTemplateId} />}
        </>
      )}

      {sceneKind === "custom" && (
        <CustomPromptEditor value={customPrompt} onChange={setCustomPrompt} />
      )}
    </div>
  );
}

function RecommendedScenes({
  file,
  uploadedAssetId,
  suggestions,
  suggesting,
  suggestError,
  selectedIdx,
  onSelect,
  onRetry,
}: {
  file: File | null;
  uploadedAssetId: string | null;
  suggestions: Scene[];
  suggesting: boolean;
  suggestError: string | null;
  selectedIdx: number;
  onSelect: (i: number) => void;
  onRetry: () => void;
}) {
  const { t, lang } = useLang();

  if (!file) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-[13px] text-[var(--color-muted)]">
        {t("ws_recommend_need_upload")}
      </div>
    );
  }
  if (!uploadedAssetId && suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-[13px] text-[var(--color-muted)]">
        {lang === "zh" ? "等待上传完成；如需登录，请先登录后继续。" : "Waiting for upload. Sign in first if prompted."}
      </div>
    );
  }
  if (suggesting) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <div className="mb-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
        <p className="text-[13px] text-[var(--color-muted)]">{t("ws_recommend_thinking")}</p>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          {lang === "zh" ? "正在根据商品图构思场景。" : "Planning scenes from your product image."}
        </p>
      </div>
    );
  }
  if (suggestError) {
    const message = suggestError.includes("provider_migration_required")
      ? lang === "zh" ? "图片服务账号已迁移，请管理员更新图片配置后重试。" : "The image service account has migrated. Please ask an administrator to update the image configuration, then retry."
      : lang === "zh" ? "场景推荐服务暂不可用，请稍后重试。" : "Scene recommendations are temporarily unavailable. Please try again later.";
    return (
      <div role="alert" className="rounded-xl border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-4 text-[13px] text-[var(--color-danger)]">
        <div>{message}</div>
        <button
          onClick={onRetry}
          className="mt-2 rounded-md border border-[var(--color-danger-border)] bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-danger)]"
        >
          {t("ws_recommend_retry")}
        </button>
      </div>
    );
  }
  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-[13px] text-[var(--color-muted)]">
        {t("ws_recommend_empty")}{" "}
        <button onClick={onRetry} className="ml-2 underline">
          {t("ws_recommend_retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {suggestions.map((s, i) => (
        <RecommendedSceneCard
          key={`${s.title}-${i}`}
          scene={s}
          assetId={uploadedAssetId!}
          idx={i}
          selected={i === selectedIdx}
          onSelect={() => onSelect(i)}
        />
      ))}
    </div>
  );
}

/** 单卡：hover 0.5s 后按需触发缩略图生成；点击立即触发 + 选中。 */
function RecommendedSceneCard({
  scene,
  assetId,
  idx,
  selected,
  onSelect,
}: {
  scene: Scene;
  assetId: string;
  idx: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, lang } = useLang();
  const identity = JSON.stringify([assetId, idx, scene.prompt_en]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const [thumbnail, setThumbnail] = useState<{ identity: string; url: string } | null>(null);
  const thumbUrl = thumbnail?.identity === identity ? thumbnail.url : null;
  const pendingRequest = useRef<symbol | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    setThumbnail(null);
    setThumbLoading(false);
    setThumbError(false);
    return () => {
      mounted.current = false;
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      requestController.current?.abort();
      pendingRequest.current = null;
    };
  }, [identity]);

  const requestThumb = async () => {
    if (!mounted.current || currentIdentity.current !== identity || pendingRequest.current || (thumbUrl && !thumbError)) return;
    const request = Symbol("thumbnail");
    pendingRequest.current = request;
    const controller = new AbortController();
    requestController.current = controller;
    const isCurrent = () => mounted.current && currentIdentity.current === identity && pendingRequest.current === request;
    setThumbLoading(true);
    setThumbError(false);
    try {
      const response = await fetch("/api/generation/suggest/thumb", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploaded_asset_id: assetId, idx, prompt_en: scene.prompt_en }),
      });
      if (!response.ok) throw new Error("thumbnail_unavailable");
      const data = await response.json() as { thumb_url?: string };
      if (!data.thumb_url) throw new Error("missing_thumbnail");
      if (isCurrent()) setThumbnail({ identity, url: data.thumb_url + (data.thumb_url.includes("?") ? "&" : "?") + "t=" + Date.now() });
    } catch {
      if (isCurrent()) { setThumbnail(null); setThumbError(true); }
    } finally {
      if (isCurrent()) {
        pendingRequest.current = null;
        requestController.current = null;
        setThumbLoading(false);
      }
    }
  };

  const onMouseEnter = () => {
    if (thumbUrl || thumbError || pendingRequest.current) return;
    hoverTimer.current = window.setTimeout(() => {
      void requestThumb();
    }, 500);
  };
  const onMouseLeave = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handleClick = () => {
    onSelect();
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    // Explicit selection also retries a failed thumbnail.
    if (!thumbUrl || thumbError) {
      void requestThumb();
    }
  };

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`overflow-hidden rounded-2xl border bg-[var(--color-surface)] text-left transition-all ${
        selected
          ? "border-[var(--color-accent)] shadow-[0_0_0_3px_rgba(23,23,23,.06)]"
          : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
      }`}
    >
      <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-[var(--color-surface)] to-[var(--color-raised)] sm:h-36">
        {thumbUrl && !thumbError && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={scene.title}
            className="h-full w-full object-cover transition-opacity duration-500"
            style={{ opacity: thumbUrl ? 1 : 0 }}
            loading="lazy"
            onError={() => {
              if (mounted.current && currentIdentity.current === identity) { setThumbnail(null); setThumbError(true); }
            }}
          />
        )}
        {(!thumbUrl || thumbError) && (
          <div className="absolute inset-0 grid place-items-center">
            {thumbLoading ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                <span className="text-[11px] text-[var(--color-accent)]">{t("ws_recommend_thumb_loading")}</span>
              </div>
            ) : thumbError ? (
              <span role="status" className="px-3 text-center text-[11px] text-[var(--color-muted)]">{lang === "zh" ? "场景参考暂不可用，点击重试" : "Scene preview unavailable. Select to retry."}</span>
            ) : (
              <span className="text-[11px] text-[var(--color-accent)] opacity-70">
                {lang === "zh" ? "选择以查看场景参考" : "Select to preview this scene"}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-[14px] font-semibold text-[var(--color-accent)]">
          {scene.title}
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] text-[var(--color-muted)]">
          {scene.pitch}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{lang === "zh" ? "构思参考，尚未生成正式结果" : "Scene reference, not a generated result"}</p>
        {scene.best_for.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {scene.best_for.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--color-raised)] px-2 py-0.5 text-[11px] text-[var(--color-accent)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
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
  const { lang } = useLang();
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
        const sceneLabel =
          sceneLabelMap[tpl.scene_space]?.[lang] ?? tpl.scene_space;
        const cover = `/templates/${tpl.id}.jpg`;
        return (
          <button
            key={tpl.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(tpl.id)}
            className={`overflow-hidden rounded-2xl border bg-[var(--color-surface)] text-left transition-all ${
              selected
                ? "border-[var(--color-accent)] shadow-[0_0_0_3px_rgba(23,23,23,.06)]"
                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt={tpl.name}
              className="h-32 w-full object-cover sm:h-36"
              loading="lazy"
            />
            <div className="p-3">
              <div className="text-[13px] font-semibold text-[var(--color-accent)] sm:text-[14px]">
                {tpl.name}
              </div>
              <div className="text-[11px] text-[var(--color-muted)] sm:text-[12px]">
                {lampLabel} · {sceneLabel}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CustomPromptEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const { t, lang } = useLang();
  return (
    <div>
      <textarea
        aria-label={t("ws_tab_custom")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("ws_custom_placeholder")}
        rows={4}
        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="mt-2 text-[11px] text-[var(--color-muted)]">
        {t("ws_custom_tags_hint")}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STYLE_TAGS.map((tag) => (
          <button
            key={tag.en}
            type="button"
            onClick={() => {
              const trimmed = value.trimEnd();
              const sep = trimmed.length > 0 && !/[，,]$/.test(trimmed) ? (lang === "zh" ? "，" : ", ") : trimmed.length > 0 && lang === "en" ? " " : "";
              onChange(trimmed + sep + tag[lang]);
            }}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {tag[lang]}
          </button>
        ))}
      </div>
    </div>
  );
}
