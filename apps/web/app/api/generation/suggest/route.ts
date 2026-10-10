/**
 * POST /api/generation/suggest
 *
 * body: { uploaded_asset_id }
 *
 * 用 GPT-5-mini 看上传的灯具图，返回 4 个针对性场景方案（仅文字）。
 * 缩略图按需生成 — 见 /api/generation/suggest/thumb。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { suggestScenes } from "@/lib/suggest-scenes";
import { isProviderMigrationError } from "@/lib/provider-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  let body: { uploaded_asset_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const assetId =
    typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : "";
  if (!assetId) {
    return NextResponse.json({ error: "missing_asset_id" }, { status: 400 });
  }
  const asset = await prisma.uploadedAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.user_id !== user.id) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }

  try {
    const scenes = await suggestScenes(asset.image_url);
    return NextResponse.json({ scenes });
  } catch (e) {
    console.error("[suggest] failed:", e);
    return NextResponse.json(
      { error: isProviderMigrationError(e) ? "provider_migration_required" : "suggest_failed" },
      { status: 502 },
    );
  }
}
