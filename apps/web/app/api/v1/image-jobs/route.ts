import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createAndRunGenerationJob } from "@/lib/generation";
import { validateImageSelection } from "@/lib/image-models";
import { apiJson, requireApiUser } from "@/lib/public-api";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_PLATFORM = new Set<PlatformStyle>(["domestic_ecommerce", "brand_site"]);
const VALID_ASPECT = new Set<AspectRatio>(["1_1", "4_5", "16_9"]);

export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  const assetId = typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : typeof body.asset_id === "string" ? body.asset_id : "";
  const platformStyle = typeof body.platform_style === "string" ? body.platform_style as PlatformStyle : "domestic_ecommerce";
  const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio as AspectRatio : "1_1";
  if (!assetId) return apiJson({ error: "missing_asset_id" }, { status: 400 });
  if (!VALID_PLATFORM.has(platformStyle)) return apiJson({ error: "bad_platform_style" }, { status: 400 });
  if (!VALID_ASPECT.has(aspectRatio)) return apiJson({ error: "bad_aspect_ratio" }, { status: 400 });
  const selection = validateImageSelection(body.image_model, aspectRatio);
  if (!selection.ok) return apiJson({ error: selection.reason }, { status: 400 });
  const result = await createAndRunGenerationJob({
    userId: auth.auth.user.id,
    uploadedAssetId: assetId,
    sceneKind: body.scene_kind === "custom" ? "custom" : body.scene_kind === "recommended" ? "recommended" : body.scene_kind === "template" ? "template" : undefined,
    templateId: typeof body.template_id === "string" ? body.template_id : undefined,
    recommendedPromptEn: typeof body.recommended_prompt_en === "string" ? body.recommended_prompt_en : undefined,
    customPrompt: typeof body.custom_prompt === "string" ? body.custom_prompt : undefined,
    platformStyle, aspectRatio,
    imageCount: typeof body.image_count === "number" ? body.image_count : undefined,
    imageModel: selection.imageModel,
  });
  if (!result.ok) {
    const status = result.reason === "insufficient_credits" ? 409 : result.reason === "asset_not_found" ? 404 : 400;
    return apiJson({ error: result.reason }, { status });
  }
  const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: result.jobId }, select: { status: true } });
  return apiJson({ id: result.jobId, job_id: result.jobId, type: "image", status: job.status, image_model: selection.imageModel }, { status: 202 });
}
