"use client";

/**
 * LampProfileCard —— 灯具档案卡（V1）
 *
 * 工作流：
 *   1. mount 时调 POST /api/uploads/[id]/profile 触发 AI 推断
 *   2. AI 给默认值，渲染 4 个可改字段（类型/尺寸/色温/客群）
 *   3. 用户改任一字段 → PATCH 同步 DB（防抖 600ms）
 *   4. 父组件读 onReady 回调拿 profile，传给生成接口
 *
 * 失败兜底：推断超时/失败 → 用 DEFAULT_PROFILE 显示，提示"AI 识别暂时不可用"。
 */
import { useEffect, useRef, useState } from "react";

export type ProfileResp = {
  asset_id: string;
  lamp_type: "pendant" | "wall" | "table" | "floor" | "ceiling" | "unknown";
  size_class: "small" | "medium" | "large";
  size_hint_cm: number;
  color_temp: "warm_3000k" | "neutral_4000k" | "cool_5000k" | "tunable";
  target_audience:
    | "modern_luxury"
    | "nordic"
    | "wabi_sabi"
    | "industrial"
    | "new_chinese"
    | "french";
  ai_inferred_at: string | null;
};

type Props = {
  assetId: string;
  onReady?: (p: ProfileResp) => void;
};

const LAMP_LABEL: Record<ProfileResp["lamp_type"], string> = {
  pendant: "吊灯",
  wall: "壁灯",
  table: "台灯",
  floor: "落地灯",
  ceiling: "吸顶灯",
  unknown: "未识别",
};

const SIZE_LABEL: Record<ProfileResp["size_class"], string> = {
  small: "小",
  medium: "中",
  large: "大",
};

const SIZE_RANGE: Record<
  ProfileResp["lamp_type"],
  Record<ProfileResp["size_class"], string>
> = {
  pendant: { small: "≤30cm 直径", medium: "30-60cm 直径", large: "≥60cm 直径" },
  wall: { small: "≤25cm 出墙", medium: "25-40cm 出墙", large: "≥40cm 出墙" },
  table: { small: "≤35cm 高", medium: "35-55cm 高", large: "≥55cm 高" },
  floor: { small: "≤140cm 高", medium: "140-170cm 高", large: "≥170cm 高" },
  ceiling: { small: "≤40cm 直径", medium: "40-70cm 直径", large: "≥70cm 直径" },
  unknown: { small: "小", medium: "中", large: "大" },
};

const TEMP_LABEL: Record<ProfileResp["color_temp"], string> = {
  warm_3000k: "暖光 3000K",
  neutral_4000k: "中性 4000K",
  cool_5000k: "冷白 5500K",
  tunable: "多档可调",
};

const AUD_LABEL: Record<ProfileResp["target_audience"], string> = {
  modern_luxury: "现代轻奢",
  nordic: "北欧极简",
  wabi_sabi: "侘寂日式",
  industrial: "工业 LOFT",
  new_chinese: "新中式",
  french: "法式优雅",
};

const LAMP_OPTIONS: ProfileResp["lamp_type"][] = [
  "pendant",
  "wall",
  "table",
  "floor",
  "ceiling",
];
const SIZE_OPTIONS: ProfileResp["size_class"][] = ["small", "medium", "large"];
const TEMP_OPTIONS: ProfileResp["color_temp"][] = [
  "warm_3000k",
  "neutral_4000k",
  "cool_5000k",
  "tunable",
];
const AUD_OPTIONS: ProfileResp["target_audience"][] = [
  "modern_luxury",
  "nordic",
  "wabi_sabi",
  "industrial",
  "new_chinese",
  "french",
];

export function LampProfileCard({ assetId, onReady }: Props) {
  const [profile, setProfile] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
  const patchTimer = useRef<number | null>(null);

  // mount 时触发推断
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrMsg(null);
    fetch(`/api/uploads/${assetId}/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          setErrMsg("请先登录");
          setLoading(false);
          return;
        }
        const data = (await r.json()) as ProfileResp & { error?: string };
        if (data.error || !data.asset_id) {
          setErrMsg("AI 识别暂时不可用，已使用通用默认值。可手动调整。");
          setUsingDefault(true);
          setProfile({
            asset_id: assetId,
            lamp_type: "unknown",
            size_class: "medium",
            size_hint_cm: 40,
            color_temp: "warm_3000k",
            target_audience: "modern_luxury",
            ai_inferred_at: null,
          });
        } else {
          setProfile(data);
          if (data.lamp_type === "unknown") {
            setUsingDefault(true);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErrMsg("AI 识别超时，已使用通用默认值。可手动调整。");
        setUsingDefault(true);
        setProfile({
          asset_id: assetId,
          lamp_type: "unknown",
          size_class: "medium",
          size_hint_cm: 40,
          color_temp: "warm_3000k",
          target_audience: "modern_luxury",
          ai_inferred_at: null,
        });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // profile 就绪 → 通知父组件
  useEffect(() => {
    if (profile && !loading) onReady?.(profile);
  }, [profile, loading, onReady]);

  // 更新字段（防抖 PATCH）
  const update = <K extends keyof ProfileResp>(key: K, value: ProfileResp[K]) => {
    if (!profile) return;
    const next = { ...profile, [key]: value };
    setProfile(next);
    if (patchTimer.current) window.clearTimeout(patchTimer.current);
    patchTimer.current = window.setTimeout(() => {
      fetch(`/api/uploads/${assetId}/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      }).catch(() => {
        // 不阻断 UI，DB 失败下次生成时会因 profile 不全导致 generate 报错——可接受
      });
    }, 600) as unknown as number;
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#e5edf5] bg-white p-5">
        <div className="text-[13px] text-[#94a3b8]">AI 正在识别灯具档案…</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="h-12 rounded-md bg-[#f1f5f9] animate-pulse" />
          <div className="h-12 rounded-md bg-[#f1f5f9] animate-pulse" />
          <div className="h-12 rounded-md bg-[#f1f5f9] animate-pulse" />
          <div className="h-12 rounded-md bg-[#f1f5f9] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[13px] text-rose-700">
        {errMsg || "档案加载失败"}
      </div>
    );
  }

  const sizeRange = SIZE_RANGE[profile.lamp_type];

  return (
    <div className="rounded-2xl border border-[#e5edf5] bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold tracking-tight text-[#171717]">
          AI 识别 · 可手动调整
        </div>
        {profile.ai_inferred_at && !usingDefault && (
          <div className="text-[11px] text-emerald-600">✓ 已识别</div>
        )}
      </div>

      {usingDefault && errMsg && (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          {errMsg}
        </div>
      )}

      {/* 类型 */}
      <Field label="类型">
        <div className="flex flex-wrap gap-1.5">
          {LAMP_OPTIONS.map((t) => (
            <Chip
              key={t}
              active={profile.lamp_type === t}
              onClick={() => update("lamp_type", t)}
            >
              {LAMP_LABEL[t]}
            </Chip>
          ))}
        </div>
      </Field>

      {/* 尺寸 */}
      <Field label="尺寸">
        <div className="flex flex-wrap gap-1.5">
          {SIZE_OPTIONS.map((s) => (
            <Chip
              key={s}
              active={profile.size_class === s}
              onClick={() => update("size_class", s)}
              hint={sizeRange[s]}
            >
              {SIZE_LABEL[s]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-[#94a3b8]">
          AI 估算约 {profile.size_hint_cm}cm
        </div>
      </Field>

      {/* 色温 */}
      <Field label="色温">
        <div className="flex flex-wrap gap-1.5">
          {TEMP_OPTIONS.map((t) => (
            <Chip
              key={t}
              active={profile.color_temp === t}
              onClick={() => update("color_temp", t)}
            >
              {TEMP_LABEL[t]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-[#94a3b8]">
          按产品规格填，决定生成图里灯亮起来的颜色
        </div>
      </Field>

      {/* 目标客群 */}
      <Field label="目标客群">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {AUD_OPTIONS.map((a) => (
            <Chip
              key={a}
              active={profile.target_audience === a}
              onClick={() => update("target_audience", a)}
              fill
            >
              {AUD_LABEL[a]}
            </Chip>
          ))}
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-[#f1f5f9] pt-3">
      <div className="mb-2 text-[12px] font-medium text-[#64748d]">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  hint,
  fill,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
  fill?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`${fill ? "" : ""} rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        active
          ? "bg-[#171717] text-white"
          : "border border-[#e5edf5] bg-white text-[#374151] hover:bg-[#f8fafc]"
      } ${fill ? "w-full text-center" : ""}`}
    >
      {children}
    </button>
  );
}
