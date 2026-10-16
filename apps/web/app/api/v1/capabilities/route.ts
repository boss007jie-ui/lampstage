import { SIX_REFERENCE_CAPABILITY } from "@/lib/video/six-reference-plan";
import { NextResponse } from "next/server";
import { videoMaintenanceReason } from "@/lib/video/control";
import { VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS } from "@/lib/video/types";
import { DIRECT_REFERENCE_CAPABILITY } from "@/lib/video/reference-inputs";
import { VIDEO_DRAFT_LIMIT, VIDEO_ACTIVE_LIMIT, VIDEO_DRAFT_TTL_SECONDS, VIDEO_TERMINAL_STATUSES } from "@/lib/video/job-lifecycle";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from "@/lib/image-models";
import { IMAGE_REFERENCE_ROLES, IMAGE_REFERENCE_LIMIT } from "@/lib/image-reference-contract";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type, Idempotency-Key",
};

export function GET() {
  // 视频停用时不能继续返回公共缓存：否则维护期间客户端还会看到"可用"。
  const maintenance = videoMaintenanceReason();
  const headers = {
    ...corsHeaders,
    "Cache-Control": maintenance ? "no-store" : "public, max-age=60",
  };
  return NextResponse.json({
    object: "capability_catalog",
    version: "v1",
    service: "lampstage-api",
    authentication: { discovery: "public", scheme: "Bearer", header: "Authorization", env: "LAMPSTAGE_API_KEY", required_for: "write_endpoints" },
    capabilities: [
      { id: "api.connect", kind: "connector", status: "available", description: "Connect a WorkBuddy Expert or product workflow with a per-user Bearer API key." },
      { id: "product.understand", kind: "expert_skill", status: "available", description: "Turn source facts and user context into a reviewable product brief before any generation task." },
      { id: "ecommerce.optimize", kind: "expert_skill", status: "available", description: "Plan channel-aware titles, selling points, keywords and localized product copy." },
      { id: "image.generate", kind: "async_job", status: "available", description: "Generate product or campaign images from one asset or ordered references and instructions. image_count requests output images independently of the number of input references.",
        limits: { max_reference_images: IMAGE_REFERENCE_LIMIT, max_output_images: 4, supported_aspect_ratios: ["1_1"] },
        default_model: DEFAULT_IMAGE_MODEL,
        models: IMAGE_MODELS.map(model => ({ id: model.id, name: model.name, api_model: model.apiModel, max_reference_images: model.maxReferences, reference_limit_basis: "application_policy" })),
        inputs: { reference_assets: { schema_version: 1, ordered: true, min_items: 1, max_items: IMAGE_REFERENCE_LIMIT,
          roles: IMAGE_REFERENCE_ROLES, required_fields: ["asset_id", "role", "label"],
          optional_character_binding: { fields: ["character_version_id", "image_index"], must_be_paired: true, role: "character" },
          exclusive_with: ["asset_id", "uploaded_asset_id"] }, image_count: { meaning: "requested_outputs", min: 1, max: 4 } },
        provider_validation: { boundary: "offline_only", multi_reference_wire_forms_tested: ["nano_banana_21", "image_25"],
          previously_observed_reference_counts: { nano_banana_21: 2, image_25: 1 },
          gateway_acceptance: "OpenLux aliases at four and six references have not been live verified. Previously observed counts do not establish upstream limits." } },
      {
        id: "video.replicate",
        kind: "async_job",
        // 只有这里表达"现在能不能用"：暂停/未开放时是 maintenance，不是 available。
        status: maintenance ? "maintenance" : "available",
        description: "Prepare a source video and explicit product, character or scene references, then render after reference and budget approval.",
        limits: { min_seconds: VIDEO_MIN_SECONDS, max_seconds: VIDEO_MAX_SECONDS, aspect_ratio: "9:16", resolution: "720P" },
        default_mode: "six_references",
        modes: { six_references: SIX_REFERENCE_CAPABILITY, legacy_frames: { generated_endpoint_frames: true }, direct_references: DIRECT_REFERENCE_CAPABILITY },
        lifecycle: { version: 1, draft_limit: VIDEO_DRAFT_LIMIT, active_limit: VIDEO_ACTIVE_LIMIT, draft_ttl_seconds: VIDEO_DRAFT_TTL_SECONDS, cancellation: "never_started_drafts", closing: "explicitly_abandoned_stopped_review_or_attention", terminal_statuses: VIDEO_TERMINAL_STATUSES },
        ...(maintenance ? { reason: maintenance } : {}),
      },
      { id: "assets.upload", kind: "asset", status: "available", description: "Store source assets for an authenticated workflow." },
      { id: "jobs.retrieve", kind: "job", status: "available", description: "Read asynchronous task status and output metadata." },
      { id: "video.delivery", kind: "private_result", status: "available", description: "Read a video's full output and accepted segments, then give explicit hash-bound feedback." },
      { id: "video.templates", kind: "private_library", status: "available", description: "List, inspect, update and explicitly reuse account-private video template versions." },
      { id: "characters.library", kind: "private_library", status: "available", description: "Save and inspect account-owned character profiles that reference existing image assets and immutable versions. Matching uploaded originals may share storage by exact file hash within the account." },
    ],
    endpoints: {
      health: "/api/v1/health",
      capabilities: "/api/v1/capabilities",
      mcp: "/api/mcp",
      assets: "/api/v1/assets",
      image_jobs: "/api/v1/image-jobs",
      video_jobs: "/api/v1/video-jobs",
      account_usage: "/api/v1/account/usage",
      video_cancel: "/api/v1/video-jobs/:id/cancel",
      video_close: "/api/v1/video-jobs/:id/close",
      video_prepare: "/api/v1/video-jobs/:id/prepare",
      video_render: "/api/v1/video-jobs/:id/render",
      video_review: "/api/v1/video-jobs/:id/review",
      video_assemble: "/api/v1/video-jobs/:id/assemble",
      video_reconcile: "/api/v1/video-jobs/:id/reconcile",
      video_delivery: "/api/v1/video-jobs/:id/delivery",
      video_feedback: "/api/v1/video-jobs/:id/feedback",
      video_templates: "/api/v1/video-templates",
      video_template: "/api/v1/video-templates/:id",
      characters: "/api/v1/characters",
      character: "/api/v1/characters/:id",
      character_versions: "/api/v1/characters/:id/versions",
      character_assets: "/api/v1/character-assets",
      jobs: "/api/v1/jobs/:id",
    },
  }, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders, "Cache-Control": videoMaintenanceReason() ? "no-store" : "public, max-age=60" } });
}
