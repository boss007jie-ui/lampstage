/**
 * POST /api/generation/suggest/thumb
 *
 * body: { uploaded_asset_id, idx, prompt_en }
 *
 * 按需生成"智能推荐"卡片的 1:1 缩略图。前端 hover 卡片 ~500ms 后才调用，
 * 避免用户随便扫一眼就花费成本。
 *
 * 缓存：写到 public/suggest-thumbs/<asset_id>/<idx>.jpg。已存在直接返回。
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { nanoBananaProvider } from "@/lib/providers/nano-banana";

export const runtime = "nodejs";
export const maxDuration = 60;

const THUMB_ROOT = path.join(process.cwd(), "public", "suggest-thumbs");

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  let body: {
    uploaded_asset_id?: unknown;
    idx?: unknown;
    prompt_en?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const assetId =
    typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : "";
  const idx =
    typeof body.idx === "number" && Number.isInteger(body.idx) && body.idx >= 0 && body.idx < 4
      ? body.idx
      : -1;
  const promptEn =
    typeof body.prompt_en === "string" ? body.prompt_en.trim() : "";
  if (!assetId || idx < 0 || !promptEn) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const asset = await prisma.uploadedAsset.findUnique({
    where: { id: assetId },
  });
  if (!asset || asset.user_id !== user.id) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }

  const dir = path.join(THUMB_ROOT, assetId);
  const outPath = path.join(dir, `${idx}.jpg`);
  const publicPath = `/suggest-thumbs/${assetId}/${idx}.jpg`;

  // 已生成过就直接返回
  try {
    const stat = await fs.stat(outPath);
    if (stat.size > 5_000) {
      return NextResponse.json({ thumb_url: publicPath, cached: true });
    }
  } catch {
    // not exists, will generate
  }

  await fs.mkdir(dir, { recursive: true });
  try {
    const result = await nanoBananaProvider.generate({
      prompt:
        promptEn +
        " Square 1:1 framing, lifestyle e-commerce style, photoreal, no text, no watermark.",
      referenceImageUrl: asset.image_url,
      aspectRatio: "1_1",
      platformStyle: "domestic_ecommerce",
      outputCount: 1,
    });
    if (!result.ok || !result.bytes) {
      return NextResponse.json(
        { error: "render_failed", message: result.error?.slice(0, 200) },
        { status: 502 },
      );
    }
    await fs.writeFile(outPath, result.bytes);
    return NextResponse.json({ thumb_url: publicPath, cached: false });
  } catch (e) {
    console.error("[suggest-thumb] failed", e);
    return NextResponse.json(
      { error: "render_failed", message: String(e).slice(0, 200) },
      { status: 502 },
    );
  }
}
