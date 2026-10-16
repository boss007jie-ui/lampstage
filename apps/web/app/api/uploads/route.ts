import { readImageUploadForm } from "@/lib/assets/image-upload-http";
/**
 * POST /api/uploads
 *
 * 客户端 multipart/form-data 上传一张图，服务端：
 * 1. 校验登录
 * 2. 校验 mime + size
 * 3. 用 sharp 读宽高
 * 4. 朴素背景类型推断
 * 5. 按账户和原图 SHA 复用存储内容
 * 6. 在 UploadedAsset 表里记录
 *
 * 返回 { id, image_url, background_type, quality_warning }
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadImageContent, ImageContentError, inspectOriginalImage } from "@/lib/assets/image-content";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 朴素背景识别：
 * 看图片四角各取 1 个像素的颜色，
 *   - 全部接近纯白 (>240,240,240) -> "white"
 *   - 接近透明 PNG (alpha 极低) -> "transparent"
 *   - 颜色一致但非白 -> "simple"
 *   - 否则 -> "complex"
 *
 * 这一步需要 sharp。运行时 import，避免打包阶段失败时阻塞其它路由。
 */
async function inferBackgroundType(
  buf: Buffer,
  mime: string,
): Promise<{
  width: number;
  height: number;
  background_type: "white" | "transparent" | "simple" | "complex" | "unknown";
}> {
  try {
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod) {
      // sharp 还没装，先用 fallback
      return { width: 0, height: 0, background_type: "unknown" };
    }
    const sharp = sharpMod.default;
    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w === 0 || h === 0) {
      return { width: 0, height: 0, background_type: "unknown" };
    }

    // 四角取 1px：把图片缩到 4×4，看四个角颜色
    const small = await img
      .resize(4, 4, { fit: "fill" })
      .raw()
      .ensureAlpha()
      .toBuffer();
    // 4×4×4(RGBA) = 64 bytes
    const corners = [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
    ];
    const pixels = corners.map(([x, y]) => {
      const i = (y * 4 + x) * 4;
      return {
        r: small[i],
        g: small[i + 1],
        b: small[i + 2],
        a: small[i + 3],
      };
    });

    const allTransparent = pixels.every((p) => p.a < 32);
    if (allTransparent && mime.includes("png")) {
      return { width: w, height: h, background_type: "transparent" };
    }

    const allWhite = pixels.every(
      (p) => p.r > 240 && p.g > 240 && p.b > 240 && p.a > 200,
    );
    if (allWhite) {
      return { width: w, height: h, background_type: "white" };
    }

    // 颜色一致性：所有角的 RGB 互相 < 30 差距 -> simple
    const r0 = pixels[0];
    const consistent = pixels.every(
      (p) =>
        Math.abs(p.r - r0.r) < 30 &&
        Math.abs(p.g - r0.g) < 30 &&
        Math.abs(p.b - r0.b) < 30,
    );
    if (consistent) {
      return { width: w, height: h, background_type: "simple" };
    }
    return { width: w, height: h, background_type: "complex" };
  } catch (e) {
    console.error("[uploads] sharp failed", e);
    return { width: 0, height: 0, background_type: "unknown" };
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await readImageUploadForm(req);
  } catch (e) {
    return NextResponse.json({ error: e instanceof ImageContentError ? e.code : "invalid_multipart" }, { status: e instanceof ImageContentError ? e.status : 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "unsupported_format", got: file.type },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  try { await inspectOriginalImage(buf); }
  catch (e) { return NextResponse.json({ error: e instanceof ImageContentError ? e.code : "invalid_image" }, { status: 400 }); }
  const meta = await inferBackgroundType(buf, file.type);

  let result;
  try {
    result = await uploadImageContent(user.id, buf, { background_type: meta.background_type,
      quality_warning: meta.background_type === "complex" ? "background_complex_warning" : null });
  } catch (e) { return NextResponse.json({ error: e instanceof ImageContentError ? e.code : "upload_unavailable" },
    { status: e instanceof ImageContentError ? e.status : 503 }); }
  const asset = result.asset;

  return NextResponse.json({
    id: asset.id,
    image_url: asset.image_url,
    background_type: asset.background_type,
    quality_warning: asset.quality_warning,
    width: asset.width,
    height: asset.height,
    sha256: result.content.sha256,
    reused_content: result.reused_content,
  });
}
