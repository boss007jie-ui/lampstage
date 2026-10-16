import { extractCharacterBindings, requireTemplateBindingSelections, CharacterBindingError } from "@/lib/characters/bindings";
import { allReferenceImages, SixReferencePlanError } from "@/lib/video/six-reference-plan";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { type VideoJobData } from "@/lib/video/types";
import { createVideoDraft } from "@/lib/video/job-quota";
import { lifecycleHttp, videoJobListResponse } from "@/lib/video/job-management-http";
import { parseVideoReferenceInput, VideoReferenceInputError } from "@/lib/video/reference-inputs";
import { ensureVideoAssetSha256 } from "@/lib/video/asset-hash";
import { validateTemplateReuse } from "@/lib/video/template-recipe";
import type { VideoTemplateCreatePayload } from "@/lib/video/template-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return videoJobListResponse(request, auth.auth.user.id);
}); }

export async function POST(request: NextRequest) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return apiJson({ error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiJson({ error: "invalid_json" }, { status: 400 });
  body.generation_mode ??= "six_references";
  const sourceId = typeof body.source_asset_id === "string" ? body.source_asset_id : "";
  let productId = typeof body.product_asset_id === "string" ? body.product_asset_id : "";
  if (!sourceId || (body.generation_mode !== "six_references" && !productId)) return apiJson({ error: "missing_asset_id" }, { status: 400 });
  let data: VideoJobData;
  try { data = parseVideoReferenceInput(body, productId); }
  catch (error) {
    if ((error instanceof VideoReferenceInputError || error instanceof SixReferencePlanError)) return apiJson({ error: "invalid_video_references", message: error.message }, { status: 400 });
    throw error;
  }
  productId ||= data.referenceImages?.find(r => r.role === "product")?.assetId ?? data.referenceImages?.[0]?.assetId ?? "";
  const requestedRefs = allReferenceImages(data);
  const [source, product, references] = await Promise.all([
    prisma.videoAsset.findFirst({ where: { id: sourceId, user_id: auth.auth.user.id, status: { in: ["ready", "uploaded"] } } }),
    prisma.uploadedAsset.findFirst({ where: { id: productId, user_id: auth.auth.user.id } }),
    data.referenceImages ? prisma.uploadedAsset.findMany({ where: { id: { in: requestedRefs.map(r => r.assetId) }, user_id: auth.auth.user.id }, select: { id: true } }) : Promise.resolve([]),
  ]);
  if (!source || !product || (data.referenceImages && requestedRefs.some(r => !references.some(asset => asset.id === r.assetId)))) return apiJson({ error: "asset_not_found" }, { status: 404 });
  let templateVersionId: string | undefined;
  if (body.template_version_id !== undefined) {
    if (typeof body.template_version_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.template_version_id))
      return apiJson({ error: "invalid_template_version_id" }, { status: 400 });
    const version = await prisma.videoTemplateVersion.findFirst({ where: { id: body.template_version_id,
      template: { user_id: auth.auth.user.id, archived: false } }, include: { template: true, character_bindings: true } });
    if (!version) return apiJson({ error: "not_found" }, { status: 404 });
    if (![1, 2].includes(version.recipe_schema_version)) return apiJson({ error: "template_schema_unsupported" }, { status: 409 });
    try { requireTemplateBindingSelections(version.character_bindings, extractCharacterBindings(body)); }
    catch (e) { if (e instanceof CharacterBindingError) return apiJson({ error: e.code }, { status: e.status }); throw e; }
    let sourceSha: string | null = null;
    try { sourceSha = await ensureVideoAssetSha256(auth.auth.user.id, sourceId); }
    catch { return apiJson({ error: "source_hash_unavailable" }, { status: 503 }); }
    if (!sourceSha || sourceSha !== version.source_sha256 ||
      !validateTemplateReuse(version.create_payload as VideoTemplateCreatePayload, body, sourceSha, version.structure_signature))
      return apiJson({ error: "template_structure_mismatch" }, { status: 409 });
    templateVersionId = version.id;
  }
  const result = await createVideoDraft(auth.auth.user.id, {
    source_asset_id: sourceId, product_asset_id: productId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "商品视频",
    instructions: typeof body.instructions === "string" ? body.instructions.slice(0, 2000) : "",
    preserve_audio: typeof body.preserve_audio === "boolean" ? body.preserve_audio : true,
    stage: data.generationMode !== "legacy_frames" ? "等待检查参考图与原视频动作" : "等待准备参考图",
    data, template_version_id: templateVersionId, character_bindings: extractCharacterBindings(body),
  });
  if (!result.ok) return apiJson(result.body, { status: result.status });
  const job = result.value;
  return apiJson({ id: job.id, job_id: job.id, type: "video", status: job.status, generation_mode: data.generationMode,
    template_version_id: job.template_version_id,
    reference_assets: (data.referenceImages ?? []).map((ref, i) => ({ picture: i + 1, asset_id: ref.assetId, role: ref.role, label: ref.label, url: null, sha256: null })),
    references_ready: false, source_duration: null, next: "prepare_video_job" }, { status: 201 });
}); }
