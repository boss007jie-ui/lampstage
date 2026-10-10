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
import { prisma } from "@/lib/db";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";
import { validateImageSelection } from "@/lib/image-models";

export const runtime = "nodejs";
// Vercel Hobby allows at most 300 seconds. Image requests run in parallel;
// the route must stay within that platform limit while the client polls the job.
export const maxDuration = 300;

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
    image_count?: unknown;
    image_model?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const assetId =
    typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : "";
  // sceneKind:
  //   - 不传 / 不识别 → undefined → 走新流程（档案驱动，3 张图 3 个 prompt）
  //   - "template" / "recommended" / "custom" → 走对应旧路径（向后兼容）
  const sceneKind: "template" | "recommended" | "custom" | undefined =
    body.scene_kind === "recommended"
      ? "recommended"
      : body.scene_kind === "custom"
        ? "custom"
        : body.scene_kind === "template"
          ? "template"
          : undefined;
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
      : "1_1";
  const imageCount =
    typeof body.image_count === "number" ? body.image_count : undefined;
  if (!assetId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!VALID_PLATFORM.has(platformStyle)) {
    return NextResponse.json({ error: "bad_platform_style" }, { status: 400 });
  }
  if (!VALID_ASPECT.has(aspectRatio)) {
    return NextResponse.json({ error: "bad_aspect_ratio" }, { status: 400 });
  }
  const selection = validateImageSelection(body.image_model, aspectRatio);
  if (!selection.ok) return NextResponse.json({ error: selection.reason }, { status: 400 });

  const result = await createAndRunGenerationJob({
    userId: user.id,
    uploadedAssetId: assetId,
    sceneKind,
    templateId,
    recommendedPromptEn,
    customPrompt,
    platformStyle,
    aspectRatio,
    imageCount,
    imageModel: selection.imageModel,
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
  // Report the persisted terminal state and balance after any refund.
  const [job, account] = await Promise.all([
    prisma.generationJob.findUniqueOrThrow({ where: { id: result.jobId }, select: { status: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { credit_balance: true } }),
  ]);
  return NextResponse.json({
    job_id: result.jobId,
    status: job.status,
    credit_balance: account.credit_balance,
    image_model: selection.imageModel,
  });
}
