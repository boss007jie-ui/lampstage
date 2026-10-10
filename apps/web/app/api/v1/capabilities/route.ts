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
      { id: "image.generate", kind: "async_job", status: "available", description: "Generate images from source assets and instructions." },
      { id: "video.replicate", kind: "async_job", status: "available", description: "Analyze reference videos, generate replacement frames, and recreate approved segments through the Hypit/RunningHub Minimax H3 worker." },
      { id: "commerce.optimize", kind: "sync_or_async", status: "planned", description: "Create ecommerce titles, selling points, keywords and localized copy." },
      { id: "assets.upload", kind: "asset", status: "available", description: "Upload and reference source image assets in jobs." },
      { id: "jobs.retrieve", kind: "job", status: "available", description: "Read generation status and output metadata." },
    ],
    endpoints: {
      health: "/api/v1/health",
      capabilities: "/api/v1/capabilities",
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
