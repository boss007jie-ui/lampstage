/**
 * GET /api/templates
 *
 * 返回当前激活的模板列表。改成从数据库读，不再硬编码。
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export async function GET() {
  const list = await prisma.template.findMany({
    where: { is_active: true },
    orderBy: { sort_order: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      lamp_type: true,
      scene_space: true,
      preview_image_url: true,
      sort_order: true,
    },
  });
  return NextResponse.json({ templates: list });
}
