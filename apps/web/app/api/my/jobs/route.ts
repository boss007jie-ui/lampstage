/**
 * GET /api/my/jobs
 *
 * 当前用户的生成历史，按时间倒序，包含模板名 + 缩略图 + 输出图。
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordedImageModel } from "@/lib/image-models";
import { publicGenerationFailure } from "@/lib/provider-errors";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const jobs = await prisma.generationJob.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: "desc" },
    include: {
      template: { select: { name: true, lamp_type: true, scene_space: true } },
      uploaded_asset: { select: { image_url: true } },
      outputs: { orderBy: { created_at: "asc" } },
    },
    take: 50,
  });
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      stage_hint: j.stage_hint,
      failure_reason: publicGenerationFailure(j.failure_reason),
      created_at: j.created_at.toISOString(),
      template_name: j.template?.name ?? null,
      lamp_type: j.template?.lamp_type ?? null,
      scene_space: j.template?.scene_space ?? null,
      scene_kind: j.scene_kind,
      prompt_text: j.prompt_text,
      platform_style: j.platform_style,
      aspect_ratio: j.aspect_ratio,
      image_model: recordedImageModel(j.metadata),
      input_image_url: j.uploaded_asset.image_url,
      output_images: j.outputs.map((o) => ({
        id: o.id,
        image_url: o.image_url,
        thumbnail_url: o.thumbnail_url,
        is_downloaded: o.is_downloaded,
      })),
    })),
  });
}
