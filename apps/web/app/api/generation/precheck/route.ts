/**
 * POST /api/generation/precheck
 * body: { uploaded_asset_id, template_id }
 *
 * 用 lib/lamp-detect.ts 识别上传图的灯具类型，跟模板的 lamp_type 比对。
 * 不匹配返回 { match: false, detected, template }，前端弹"模板不匹配提醒"。
 *
 * 不强制阻止生成——前端会显示提醒 + 让用户继续 / 重新选模板。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  detectLampType,
  labelLampType,
  templateLampTypeToEnum,
  type LampType,
} from "@/lib/lamp-detect";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  let body: { uploaded_asset_id?: unknown; template_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const assetId =
    typeof body.uploaded_asset_id === "string" ? body.uploaded_asset_id : "";
  const templateId =
    typeof body.template_id === "string" ? body.template_id : "";
  if (!assetId || !templateId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const [asset, template] = await Promise.all([
    prisma.uploadedAsset.findUnique({ where: { id: assetId } }),
    prisma.template.findUnique({ where: { id: templateId } }),
  ]);

  if (!asset || asset.user_id !== user.id) {
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  }
  if (!template || !template.is_active) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  // 缓存：如果该资产之前已经识别过，直接读
  let detected: LampType;
  if (asset.detected_lamp_type) {
    detected = asset.detected_lamp_type as LampType;
  } else {
    detected = await detectLampType(asset.image_url);
    // 异步写回缓存（不阻塞响应）
    void prisma.uploadedAsset
      .update({
        where: { id: asset.id },
        data: { detected_lamp_type: detected },
      })
      .catch(() => undefined);
  }

  const templateType = templateLampTypeToEnum(template.lamp_type);
  // unknown 一律认为匹配（不打扰用户）
  const match =
    detected === "unknown" ||
    templateType === "unknown" ||
    detected === templateType;

  return NextResponse.json({
    match,
    detected,
    template_lamp_type: templateType,
    detected_label_zh: labelLampType(detected, "zh"),
    detected_label_en: labelLampType(detected, "en"),
    template_label_zh: labelLampType(templateType, "zh"),
    template_label_en: labelLampType(templateType, "en"),
  });
}
