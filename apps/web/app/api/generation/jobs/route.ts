/**
 * POST /api/generation/jobs
 * body: { uploaded_asset_id, template_id, platform_style, aspect_ratio }
 *
 * 创建并启动生成任务。返回 { job_id, status: "generating", credit_balance }。
 * 真正的生成在 lib/generation.ts 后台跑，前端轮询 GET /api/generation/jobs/[id]。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAndRunGenerationJob } from "@/lib/generation";
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
  let body: {
    uploaded_asset_id?: unknown;
    scene_kind?: unknown;
    template_id?: unknown;
    recommended_prompt_en?: unknown;
    custom_prompt?: unknown;
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
  const sceneKind =
    body.scene_kind === "recommended"
      ? "recommended"
      : body.scene_kind === "custom"
        ? "custom"
        : "template"; // default to template (back-compat)
  const templateId =
    typeof body.template_id === "string" ? body.template_id : undefined;
  const recommendedPromptEn =
    typeof body.recommended_prompt_en === "string"
      ? body.recommended_prompt_en
      : undefined;
  const customPrompt =
    typeof body.custom_prompt === "string" ? body.custom_prompt : undefined;
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
  if (!VALID_PLATFORM.has(platformStyle)) {
    return NextResponse.json({ error: "bad_platform_style" }, { status: 400 });
  }
  if (!VALID_ASPECT.has(aspectRatio)) {
    return NextResponse.json({ error: "bad_aspect_ratio" }, { status: 400 });
  }

  const result = await createAndRunGenerationJob({
    userId: user.id,
    uploadedAssetId: assetId,
    sceneKind,
    templateId,
    recommendedPromptEn,
    customPrompt,
    platformStyle,
    aspectRatio,
  });
  if (!result.ok) {
    const status =
      result.reason === "insufficient_credits"
        ? 409
        : result.reason === "asset_not_found"
          ? 404
          : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({
    job_id: result.jobId,
    status: "generating",
    credit_balance: result.creditBalance,
    estimated_seconds: 45,
  });
}
