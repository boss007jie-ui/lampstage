/**
 * POST /api/generation/plan
 * body: { uploaded_asset_id, platform_style, aspect_ratio }
 *
 * 「构思」阶段：用 gpt（PROMPT_PLANNER_MODEL，默认 gpt-5.5）按【当前产品卡】写好 3 条
 * 图生图提示词，存到 UploadedAsset.planned_shots。生成接口随后直接读取，
 * 不再内联同步跑 planner（那是 60s 超时的根源）。
 *
 * 为什么放这里：识图/选平台之后、点画图之前是独立请求，有自己的 60s 预算，
 * planner 慢一点也不影响生图。提示词每次按最新产品卡现写，改卡不会过期。
 * 提示词只存后端、不返回给前端展示。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planImagePrompts } from "@/lib/prompt-planner";
import type {
  ColorTemp,
  LampType,
  SizeClass,
  TargetAudience,
} from "@/lib/lamp-profile";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_PLATFORM = new Set<PlatformStyle>([
  "domestic_ecommerce",
  "brand_site",
]);
const VALID_ASPECT = new Set<AspectRatio>(["1_1", "4_5", "16_9"]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  // planner 关闭时这一步无需做事（生成接口会走本地规则）
  if (process.env.PROMPT_PLANNER_ENABLED !== "true") {
    return NextResponse.json({ ok: true, planned: false, reason: "disabled" });
  }

  let body: {
    uploaded_asset_id?: unknown;
    platform_style?: unknown;
    aspect_ratio?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const assetId =
    typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : "";
  const platformStyle =
    typeof body.platform_style === "string"
      ? (body.platform_style as PlatformStyle)
      : "domestic_ecommerce";
  const aspectRatio =
    typeof body.aspect_ratio === "string"
      ? (body.aspect_ratio as AspectRatio)
      : "4_5";
  if (!assetId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!VALID_PLATFORM.has(platformStyle) || !VALID_ASPECT.has(aspectRatio)) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const asset = await prisma.uploadedAsset.findUnique({
    where: { id: assetId },
    select: {
      user_id: true,
      detected_lamp_type: true,
      size_class: true,
      size_hint_cm: true,
      color_temp: true,
      target_audience: true,
      material_keywords: true,
      space_fit: true,
    },
  });
  if (!asset || asset.user_id !== user.id) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (
    !asset.detected_lamp_type ||
    !asset.size_class ||
    !asset.color_temp ||
    !asset.target_audience
  ) {
    return NextResponse.json({ error: "profile_not_ready" }, { status: 409 });
  }

  const plan = await planImagePrompts({
    profile: {
      lamp_type: asset.detected_lamp_type as LampType,
      size_class: asset.size_class as SizeClass,
      size_hint_cm: asset.size_hint_cm ?? 40,
      color_temp: asset.color_temp as ColorTemp,
      target_audience: asset.target_audience as TargetAudience,
      material_keywords: (asset.material_keywords ?? "")
        .split(",")
        .filter(Boolean),
      space_fit: (asset.space_fit ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    },
    platformStyle,
    aspectRatio,
  });

  // planner 失败（超时/网络/解析）→ 不写，生成接口会自动 fallback 到本地规则。
  if (!plan) {
    await prisma.uploadedAsset.update({
      where: { id: assetId },
      data: { planned_shots: undefined, planned_at: new Date() },
    });
    return NextResponse.json({ ok: true, planned: false, reason: "planner_failed" });
  }

  await prisma.uploadedAsset.update({
    where: { id: assetId },
    data: {
      planned_shots: plan as unknown as object,
      planned_at: new Date(),
    },
  });

  return NextResponse.json({ ok: true, planned: true });
}
