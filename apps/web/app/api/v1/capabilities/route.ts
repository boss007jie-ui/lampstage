import { NextResponse } from "next/server";
import { videoMaintenanceReason } from "@/lib/video/control";
import { VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS } from "@/lib/video/types";
import { DIRECT_REFERENCE_CAPABILITY } from "@/lib/video/reference-inputs";

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
      { id: "image.generate", kind: "async_job", status: "available", description: "Generate product or campaign images from approved source facts, assets and instructions." },
      {
        id: "video.replicate",
        kind: "async_job",
        // 只有这里表达"现在能不能用"：暂停/未开放时是 maintenance，不是 available。
        status: maintenance ? "maintenance" : "available",
        description: "Prepare a source video and explicit product, character or scene references, then render after reference and budget approval.",
        limits: { min_seconds: VIDEO_MIN_SECONDS, max_seconds: VIDEO_MAX_SECONDS, aspect_ratio: "9:16", resolution: "768P" },
        modes: { legacy_frames: { generated_endpoint_frames: true }, direct_references: DIRECT_REFERENCE_CAPABILITY },
        ...(maintenance ? { reason: maintenance } : {}),
      },
      { id: "assets.upload", kind: "asset", status: "available", description: "Store source assets for an authenticated workflow." },
      { id: "jobs.retrieve", kind: "job", status: "available", description: "Read asynchronous task status and output metadata." },
    ],
    endpoints: {
      health: "/api/v1/health",
      capabilities: "/api/v1/capabilities",
      mcp: "/api/mcp",
      assets: "/api/v1/assets",
      image_jobs: "/api/v1/image-jobs",
      video_jobs: "/api/v1/video-jobs",
      video_prepare: "/api/v1/video-jobs/:id/prepare",
      video_render: "/api/v1/video-jobs/:id/render",
      jobs: "/api/v1/jobs/:id",
    },
  }, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...corsHeaders, "Cache-Control": videoMaintenanceReason() ? "no-store" : "public, max-age=60" } });
}
