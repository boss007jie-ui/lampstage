"use client";

import { useEffect } from "react";
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

const STYLE_TAGS_ZH = [
  "温馨",
  "现代",
  "极简",
  "工业风",
  "北欧",
  "日式",
  "奢华",
  "民宿",
  "商业空间",
  "夜晚",
];

export function SceneSelector(props: {
  file: File | null;
  uploadedAssetId: string | null;
  templates: Template[];
  templateId: string | null;
  setTemplateId: (id: string | null) => void;
  templatesError: string | null;
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
  const { t } = useLang();
  const {
    file,
    uploadedAssetId,
    templates,
    templateId,
    setTemplateId,
    templatesError,
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

  const runSuggest = async () => {
    if (!uploadedAssetId) return;
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
        throw new Error(data.error || `${r.status}`);
      }
      const data = (await r.json()) as { scenes: Scene[] };
      setSuggestions(data.scenes || []);
      setRecommendedSceneIdx(0);
    } catch (e) {
      setSuggestError(String(e));
    } finally {
      setSuggesting(false);
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
      <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-xl border border-[#e5e1d8] bg-[#fafafa] p-1">
        {tabs.map((tab) => {
          const on = sceneKind === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSceneKind(tab.value)}
              className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                on ? "bg-[#171717] text-white" : "text-[#666] hover:text-[#171717]"
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
          {templatesError && (
            <p className="mb-2 text-[13px] text-red-600">
              {t("ws_err_template")}
              {templatesError}
            </p>
          )}
          <TemplateGrid
            templates={templates}
            selectedId={templateId}
            onSelect={setTemplateId}
          />
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
  const { t } = useLang();

  if (!file) {
    return (
      <div className="rounded-xl border border-dashed border-[#e7e1d7] bg-white p-6 text-center text-[13px] text-[#94a3b8]">
        {t("ws_recommend_need_upload")}
      </div>
    );
  }
  if (!uploadedAssetId && suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#e7e1d7] bg-white p-6 text-center text-[13px] text-[#94a3b8]">
        {t("ws_recommend_uploading")}
      </div>
    );
  }
  if (suggesting) {
    return (
      <div className="rounded-xl border border-[#e7e1d7] bg-white p-6 text-center">
        <div className="mb-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-[#171717] border-t-transparent" />
        <p className="text-[13px] text-[#666]">{t("ws_recommend_thinking")}</p>
        <p className="mt-1 text-[11px] text-[#94a3b8]">
          {t("ws_recommend_thinking_hint")}
        </p>
      </div>
    );
  }
  if (suggestError) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-700">
        <div>{t("ws_recommend_error")}</div>
        <div className="mt-1 text-[11px] opacity-80">{suggestError}</div>
        <button
          onClick={onRetry}
          className="mt-2 rounded-md border border-red-200 bg-white px-3 py-1 text-[12px] text-red-700"
        >
          {t("ws_recommend_retry")}
        </button>
      </div>
    );
  }
  if (suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#e7e1d7] bg-white p-6 text-center text-[13px] text-[#94a3b8]">
        {t("ws_recommend_empty")}{" "}
        <button onClick={onRetry} className="ml-2 underline">
          {t("ws_recommend_retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {suggestions.map((s, i) => {
        const on = i === selectedIdx;
        return (
          <button
            key={`${s.title}-${i}`}
            onClick={() => onSelect(i)}
            className={`rounded-2xl border bg-white p-3 text-left transition-all ${
              on
                ? "border-[#171717] shadow-[0_0_0_3px_rgba(23,23,23,.06)]"
                : "border-[#e7e1d7] hover:border-[#171717]"
            }`}
          >
            <div className="text-[14px] font-semibold text-[#171717]">
              {s.title}
            </div>
            <div className="mt-1 text-[12px] text-[#666]">{s.pitch}</div>
            {s.best_for.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.best_for.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#faf7ed] px-2 py-0.5 text-[11px] text-[#876c3a]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
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
        const sceneLabel =
          sceneLabelMap[tpl.scene_space]?.[lang] ?? tpl.scene_space;
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

function CustomPromptEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const { t } = useLang();
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("ws_custom_placeholder")}
        rows={4}
        className="w-full rounded-xl border border-[#e7e1d7] bg-white p-3 text-[13px] outline-none focus:border-[#171717]"
      />
      <div className="mt-2 text-[11px] text-[#94a3b8]">
        {t("ws_custom_tags_hint")}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STYLE_TAGS_ZH.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => {
              const sep =
                value.trim().length > 0 && !value.trim().endsWith("，")
                  ? "，"
                  : "";
              onChange(value + sep + tag);
            }}
            className="rounded-full border border-[#e5e1d8] bg-white px-2.5 py-1 text-[12px] text-[#666] hover:border-[#171717] hover:text-[#171717]"
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  );
}
