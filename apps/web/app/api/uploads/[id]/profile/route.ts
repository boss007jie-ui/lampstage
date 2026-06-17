/**
 * /api/uploads/[id]/profile
 *
 * GET   读当前档案
 * POST  触发 AI 推断（如果未推断过 / 强制重新推断）→ 写库 → 返回档案
 * PATCH 用户修改字段
 *
 * 必须登录，且只能操作自己上传的 asset。
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PROFILE,
  inferLampProfile,
  type LampProfile,
} from "@/lib/lamp-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetSnapshot = {
  id: string;
  user_id: string;
  image_url: string;
  detected_lamp_type: string | null;
  size_class: string | null;
  size_hint_cm: number | null;
  color_temp: string | null;
  target_audience: string | null;
  material_keywords: string | null;
  space_fit: string | null;
  ai_inferred_at: Date | null;
};

async function loadAsset(id: string): Promise<AssetSnapshot | null> {
  return prisma.uploadedAsset.findUnique({
    where: { id },
    select: {
      id: true,
      user_id: true,
      image_url: true,
      detected_lamp_type: true,
      size_class: true,
      size_hint_cm: true,
      color_temp: true,
      target_audience: true,
      material_keywords: true,
      space_fit: true,
      ai_inferred_at: true,
    },
  });
}

function toClient(a: AssetSnapshot) {
  return {
    asset_id: a.id,
    lamp_type: a.detected_lamp_type ?? "unknown",
    size_class: a.size_class ?? "medium",
    size_hint_cm: a.size_hint_cm ?? 40,
    color_temp: a.color_temp ?? "warm_3000k",
    target_audience: a.target_audience ?? "modern_luxury",
    space_fit: (a.space_fit ?? "").split(",").filter((s) => s.length > 0),
    ai_inferred_at: a.ai_inferred_at,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const asset = await loadAsset(params.id);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (asset.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(toClient(asset));
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const asset = await loadAsset(params.id);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (asset.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 已推断过 + 未强制刷新 → 直接返回
  let force = false;
  try {
    const body = (await req.json().catch(() => ({}))) as { force?: unknown };
    force = Boolean(body.force);
  } catch {
    /* no body, treat as non-force */
  }

  if (asset.ai_inferred_at && !force) {
    return NextResponse.json(toClient(asset));
  }

  // 跑推断
  const t0 = Date.now();
  let profile: LampProfile;
  try {
    profile = await inferLampProfile(asset.image_url);
  } catch (e) {
    console.error("[profile API] inferLampProfile threw:", e);
    profile = { ...DEFAULT_PROFILE };
  }
  const elapsed = Date.now() - t0;
  console.log(
    `[profile API] inferred asset=${asset.id} in ${elapsed}ms type=${profile.lamp_type} size=${profile.size_class}/${profile.size_hint_cm}cm temp=${profile.color_temp} aud=${profile.target_audience}`,
  );

  const updated = await prisma.uploadedAsset.update({
    where: { id: asset.id },
    data: {
      detected_lamp_type: profile.lamp_type,
      size_class: profile.size_class,
      size_hint_cm: profile.size_hint_cm,
      color_temp: profile.color_temp,
      target_audience: profile.target_audience,
      material_keywords: profile.material_keywords.slice(0,5).join(","),
      space_fit: profile.space_fit.slice(0,3).join(","),
      ai_inferred_at: new Date(),
    },
    select: {
      id: true,
      user_id: true,
      image_url: true,
      detected_lamp_type: true,
      size_class: true,
      size_hint_cm: true,
      color_temp: true,
      target_audience: true,
      material_keywords: true,
      space_fit: true,
      ai_inferred_at: true,
    },
  });

  return NextResponse.json(toClient(updated));
}

const ALLOWED_LAMP_TYPES = new Set([
  "pendant",
  "wall",
  "table",
  "floor",
  "ceiling",
  "unknown",
]);
const ALLOWED_SIZES = new Set(["small", "medium", "large"]);
const ALLOWED_TEMPS = new Set([
  "warm_3000k",
  "neutral_4000k",
  "cool_5000k",
  "tunable",
]);
const ALLOWED_AUDS = new Set([
  "modern_luxury",
  "nordic",
  "wabi_sabi",
  "industrial",
  "new_chinese",
  "french",
]);

/**
 * 当 size_class 改变时，给 size_hint_cm 一个对应的"代表值"。
 * 用户没显式给具体数字时，按这个映射走，确保 prompt 里"compact"和"~25cm"不矛盾。
 */
const SIZE_REPRESENTATIVE_CM: Record<string, Record<string, number>> = {
  pendant: { small: 25, medium: 45, large: 70 },
  wall: { small: 20, medium: 32, large: 45 },
  table: { small: 30, medium: 45, large: 60 },
  floor: { small: 130, medium: 155, large: 180 },
  ceiling: { small: 35, medium: 55, large: 80 },
  unknown: { small: 25, medium: 45, large: 70 },
};

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const asset = await loadAsset(params.id);
  if (!asset) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (asset.user_id !== user.id)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.lamp_type === "string" && ALLOWED_LAMP_TYPES.has(body.lamp_type)) {
    update.detected_lamp_type = body.lamp_type;
  }
  if (typeof body.size_class === "string" && ALLOWED_SIZES.has(body.size_class)) {
    update.size_class = body.size_class;
    // 如果用户在同一次请求里没显式传 size_hint_cm，根据新 size_class + 当前 lamp_type 联动给一个代表值
    // 否则 AI 估算的具体数字会和新 size_class 矛盾（"小" + "~55cm"）
    if (typeof body.size_hint_cm !== "number") {
      const lampType =
        (typeof body.lamp_type === "string" ? body.lamp_type : asset.detected_lamp_type) || "unknown";
      const repCm = SIZE_REPRESENTATIVE_CM[lampType]?.[body.size_class];
      if (repCm) update.size_hint_cm = repCm;
    }
  }
  if (typeof body.size_hint_cm === "number" && body.size_hint_cm > 0 && body.size_hint_cm < 500) {
    update.size_hint_cm = Math.round(body.size_hint_cm);
  }
  if (typeof body.color_temp === "string" && ALLOWED_TEMPS.has(body.color_temp)) {
    update.color_temp = body.color_temp;
  }
  if (typeof body.target_audience === "string" && ALLOWED_AUDS.has(body.target_audience)) {
    update.target_audience = body.target_audience;
  }
  if (Array.isArray(body.space_fit)) {
    const cleaned = body.space_fit
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"))
      .slice(0, 3);
    update.space_fit = cleaned.join(",");
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no_valid_fields" }, { status: 400 });
  }

  const updated = await prisma.uploadedAsset.update({
    where: { id: asset.id },
    data: update,
    select: {
      id: true,
      user_id: true,
      image_url: true,
      detected_lamp_type: true,
      size_class: true,
      size_hint_cm: true,
      color_temp: true,
      target_audience: true,
      material_keywords: true,
      space_fit: true,
      ai_inferred_at: true,
    },
  });
  return NextResponse.json(toClient(updated));
}
