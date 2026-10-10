import { prisma } from "@/lib/db";

export type SceneSeedInput = {
  sceneType: string;
  targetAudience: string;
  timeOfDay: string;
};

export const SCENE_SEED_STYLES = [
  "modern_luxury",
  "nordic",
  "wabi_sabi",
  "industrial",
  "new_chinese",
  "french",
];

export const C27_SCENE_TYPES = [
  "dining_room",
  "living_room",
  "entryway",
  "bedroom",
  "kitchen_island",
];

export const SCENE_SEED_TIMES = ["daylight", "dusk"];

const FALLBACK_SCENE_REFS: Record<string, string> = {
  dining_room: "/scene-refs-v2/dining_offcenter_no_lamp.jpg",
  kitchen_island: "/scene-refs-v2/dining_offcenter_no_lamp.jpg",
  breakfast_nook: "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
  living_room: "/scene-refs-v2/living_offcenter_no_lamp.jpg",
  living_side_table: "/scene-refs-v2/living_offcenter_no_lamp.jpg",
  entryway: "/scene-refs-v2/entryway_offcenter_no_lamp.jpg",
  hallway: "/scene-refs-v2/entryway_offcenter_no_lamp.jpg",
  bedroom: "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
  bedside: "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
  study: "/scene-refs-v2/study_offcenter_no_lamp.jpg",
  reading_nook: "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
};

const SEEDED_SCENES = [
  "dining_room",
  "living_room",
  "entryway",
  "bedroom",
  "study",
  "reading_nook",
];

export async function selectSceneSeed(params: SceneSeedInput): Promise<string | null> {
  const exact = await prisma.sceneSeed.findFirst({
    where: {
      scene_type: params.sceneType,
      target_audience: params.targetAudience,
      time_of_day: params.timeOfDay,
      is_qualified: true,
    },
    orderBy: [{ quality_score: "desc" }, { usage_count: "asc" }, { created_at: "desc" }],
  });
  const relaxed = exact
    ? null
    : await prisma.sceneSeed.findFirst({
        where: {
          scene_type: params.sceneType,
          time_of_day: params.timeOfDay,
          is_qualified: true,
        },
        orderBy: [{ quality_score: "desc" }, { usage_count: "asc" }, { created_at: "desc" }],
      });
  const seed = exact ?? relaxed;
  if (seed) {
    await prisma.sceneSeed.update({
      where: { id: seed.id },
      data: { usage_count: { increment: 1 }, last_used_at: new Date() },
    });
    return seed.image_url;
  }
  return FALLBACK_SCENE_REFS[params.sceneType] ?? null;
}

export async function ensureDefaultSceneSeeds(): Promise<number> {
  let created = 0;
  for (const sceneType of SEEDED_SCENES) {
    const imageUrl = FALLBACK_SCENE_REFS[sceneType];
    if (!imageUrl) continue;
    for (const targetAudience of SCENE_SEED_STYLES) {
      for (const timeOfDay of SCENE_SEED_TIMES) {
        const existing = await prisma.sceneSeed.findFirst({
          where: {
            scene_type: sceneType,
            target_audience: targetAudience,
            time_of_day: timeOfDay,
            image_url: imageUrl,
          },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.sceneSeed.create({
          data: {
            scene_type: sceneType,
            target_audience: targetAudience,
            time_of_day: timeOfDay,
            image_url: imageUrl,
            quality_score: 80,
            source: "seed",
            is_qualified: true,
          },
        });
        created++;
      }
    }
  }
  return created;
}
