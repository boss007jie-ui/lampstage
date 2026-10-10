/**
 * POST /api/output-images/[id]/download
 * 标记 OutputImage 为已下载，返回原图 URL（前端 fetch 后触发浏览器下载）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getObjectBytes } from "@/lib/storage";

export const runtime = "nodejs";

/** Same-origin attachment: works for local files and R2 without browser CORS. */
export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const out = await prisma.outputImage.findUnique({
    where: { id: ctx.params.id },
    include: { job: true },
  });
  if (!out || out.job.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const { bytes, mime } = await getObjectBytes(out.image_url);
    const type = mime.split(";")[0].trim().toLowerCase();
    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[type];
    if (!extension) throw new Error("Unsupported image type");
    const id = out.id.replace(/[^a-zA-Z0-9_-]/g, "");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="lampstage-${id}.${extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "image_unavailable" }, { status: 502 });
  }
}

export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const out = await prisma.outputImage.findUnique({
    where: { id: ctx.params.id },
    include: { job: true },
  });
  if (!out || out.job.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!out.is_downloaded) {
    await prisma.outputImage.update({
      where: { id: out.id },
      data: { is_downloaded: true, downloaded_at: new Date() },
    });
  }
  return NextResponse.json({ image_url: out.image_url });
}
