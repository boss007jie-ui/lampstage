import { NextResponse } from "next/server";

const headers = {
  "Cache-Control": "public, max-age=60",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function GET() {
  return NextResponse.json({
    object: "api",
    service: "lampstage-api",
    version: "v1",
    status: "ready",
    links: { health: "/api/v1/health", capabilities: "/api/v1/capabilities", mcp: "/api/mcp", developers: "/developers", account: "/account" },
  }, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
