import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultSceneSeeds } from "@/lib/scene-seed";

export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const total = await prisma.sceneSeed.count();
  const qualified = await prisma.sceneSeed.count({ where: { is_qualified: true } });
  const generated = await prisma.sceneSeed.count({ where: { source: "generated" } });
  const byScene = await prisma.sceneSeed.groupBy({
    by: ["scene_type"],
    _count: { id: true },
    orderBy: { scene_type: "asc" },
  });
  const byGroup = await prisma.sceneSeed.groupBy({
    by: ["scene_type", "target_audience", "time_of_day"],
    where: { is_qualified: true },
    _count: { id: true },
    _sum: { usage_count: true },
    orderBy: [{ scene_type: "asc" }, { target_audience: "asc" }, { time_of_day: "asc" }],
  });
  return NextResponse.json({ total, qualified, generated, by_scene: byScene, by_group: byGroup });
}

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const created = await ensureDefaultSceneSeeds();
  const total = await prisma.sceneSeed.count();
  const qualified = await prisma.sceneSeed.count({ where: { is_qualified: true } });
  return NextResponse.json({ ok: true, created, total, qualified });
}
