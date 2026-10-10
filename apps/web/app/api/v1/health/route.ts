import { NextResponse } from "next/server";

const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "lampstage-api",
    version: "v1",
    status: "ready",
    timestamp: new Date().toISOString(),
  }, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
