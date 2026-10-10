import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { generateScene } from "@/lib/scene-generator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sceneType = typeof body.scene_type === "string" ? body.scene_type : "living_room";
  const targetAudience = typeof body.target_audience === "string" ? body.target_audience : "modern_luxury";
  const timeOfDay = body.time_of_day === "dusk" || body.time_of_day === "night" ? body.time_of_day : "daylight";
  const imageUrl = await generateScene({ sceneType, targetAudience, timeOfDay });
  return NextResponse.json({ ok: true, image_url: imageUrl });
}

