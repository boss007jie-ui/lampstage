import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { qualityCheckScene } from "@/lib/scene-quality";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.imageUrl !== "string") {
    return NextResponse.json({ error: "imageUrl_required" }, { status: 400 });
  }
  const result = await qualityCheckScene(body.imageUrl, {
    sceneType: typeof body.sceneType === "string" ? body.sceneType : "living_room",
    targetAudience: typeof body.targetAudience === "string" ? body.targetAudience : "modern_luxury",
    timeOfDay: typeof body.timeOfDay === "string" ? body.timeOfDay : "daylight",
  });
  return NextResponse.json(result);
}
