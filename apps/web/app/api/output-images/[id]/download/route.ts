/**
 * POST /api/output-images/[id]/download
 * 标记 OutputImage 为已下载，返回原图 URL（前端 fetch 后触发浏览器下载）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

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
