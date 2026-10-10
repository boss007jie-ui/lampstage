import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function GET() {
  let database = "unavailable";
  let apiKeys = false;
  try {
    const result = await prisma.$queryRaw<Array<{ api_keys_ready: boolean }>>`SELECT to_regclass('"ApiKey"') IS NOT NULL AS api_keys_ready`;
    database = "ready";
    apiKeys = Boolean(result[0]?.api_keys_ready);
  } catch {
    // Keep the public health contract safe: connection diagnostics belong in
    // server logs, not in an unauthenticated response.
  }
  const ready = database === "ready" && apiKeys;
  return NextResponse.json({
    ok: ready,
    service: "lampstage-api",
    version: "v1",
    status: ready ? "ready" : "degraded",
    checks: { database, api_keys: apiKeys ? "ready" : "migration_required" },
    timestamp: new Date().toISOString(),
  }, { status: ready ? 200 : 503, headers });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
