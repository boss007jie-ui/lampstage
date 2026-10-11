import { NextResponse } from "next/server";

const headers = {
  "Cache-Control": "public, max-age=60",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type, Idempotency-Key",
};

export function GET() {
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
      { id: "video.replicate", kind: "async_job", status: "available", description: "Analyze a reference video, prepare reviewable frames and render an approved product video through the configured worker." },
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
  return new NextResponse(null, { status: 204, headers });
}
