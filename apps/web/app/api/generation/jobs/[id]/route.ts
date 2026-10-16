/**
 * GET /api/generation/jobs/[id]
 * 前端轮询用：返回任务当前状态、stage_hint、4 张输出（如果 completed）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProviderMigrationError, publicGenerationFailure } from "@/lib/provider-errors";
import { recordedImageModel } from "@/lib/image-models";
import { recordedImageInputs } from "@/lib/image-reference-contract";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const job = await prisma.generationJob.findUnique({
    where: { id: ctx.params.id },
    include: { outputs: { orderBy: { created_at: "asc" } } },
  });
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    status: job.status,
    stage_hint: job.stage_hint,
    failure_reason: publicGenerationFailure(job.failure_reason),
    failure_code: isProviderMigrationError(job.failure_reason) ? "provider_migration_required" : null,
    aspect_ratio: job.aspect_ratio,
    platform_style: job.platform_style,
    image_model: recordedImageModel(job.metadata),
    ...recordedImageInputs(job.metadata),
    outputs: job.outputs.map((o) => ({
      id: o.id,
      image_url: o.image_url,
      thumbnail_url: o.thumbnail_url,
      is_downloaded: o.is_downloaded,
    })),
  });
}
