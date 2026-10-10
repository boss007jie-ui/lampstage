import { prisma } from "@/lib/db";
import { generateScene } from "@/lib/scene-generator";
import { C27_SCENE_TYPES, SCENE_SEED_STYLES, SCENE_SEED_TIMES } from "@/lib/scene-seed";
import { qualityCheckScene } from "@/lib/scene-quality";
import { deleteObject } from "@/lib/storage";

export type WeeklySceneGenerationOptions = {
  limit?: number;
  minQualifiedPerGroup?: number;
};

export type WeeklySceneGenerationResult = {
  attempted: number;
  qualified: number;
  failed: number;
  skipped: number;
  items: Array<{
    sceneType: string;
    targetAudience: string;
    timeOfDay: string;
    status: "qualified" | "failed";
    score?: number;
    issues?: string[];
    imageUrl?: string;
  }>;
};

type InventoryKey = `${string}|${string}|${string}`;

function key(sceneType: string, targetAudience: string, timeOfDay: string): InventoryKey {
  return `${sceneType}|${targetAudience}|${timeOfDay}`;
}

export async function weeklySceneGeneration(
  options: WeeklySceneGenerationOptions = {},
): Promise<WeeklySceneGenerationResult> {
  const limit = Math.max(0, Math.min(20, options.limit ?? 20));
  const minQualified = Math.max(1, options.minQualifiedPerGroup ?? 5);
  const result: WeeklySceneGenerationResult = {
    attempted: 0,
    qualified: 0,
    failed: 0,
    skipped: 0,
    items: [],
  };
  if (limit === 0) return result;

  const groups = await prisma.sceneSeed.groupBy({
    by: ["scene_type", "target_audience", "time_of_day"],
    where: { is_qualified: true },
    _count: { id: true },
    _sum: { usage_count: true },
  });
  const inventory = new Map(
    groups.map((g) => [
      key(g.scene_type, g.target_audience, g.time_of_day),
      { count: g._count.id, usage: g._sum.usage_count ?? 0 },
    ]),
  );

  const understocked = SCENE_SEED_STYLES.flatMap((targetAudience) =>
    C27_SCENE_TYPES.flatMap((sceneType) =>
      SCENE_SEED_TIMES.map((timeOfDay) => {
        const current = inventory.get(key(sceneType, targetAudience, timeOfDay)) ?? { count: 0, usage: 0 };
        return { sceneType, targetAudience, timeOfDay, ...current };
      }),
    ),
  )
    .filter((item) => item.count < minQualified)
    .sort((a, b) => b.usage - a.usage || a.count - b.count)
    .slice(0, limit);

  result.skipped = Math.max(0, SCENE_SEED_STYLES.length * C27_SCENE_TYPES.length * SCENE_SEED_TIMES.length - understocked.length);

  for (const item of understocked) {
    result.attempted++;
    let imageUrl = "";
    try {
      imageUrl = await generateScene(item);
      const quality = await qualityCheckScene(imageUrl, item);
      if (!quality.passed) {
        await deleteObject(imageUrl).catch(() => undefined);
        result.failed++;
        result.items.push({ ...item, status: "failed", issues: quality.issues });
        continue;
      }
      await prisma.sceneSeed.create({
        data: {
          scene_type: item.sceneType,
          target_audience: item.targetAudience,
          time_of_day: item.timeOfDay,
          image_url: imageUrl,
          quality_score: quality.score,
          source: "generated",
          is_qualified: true,
        },
      });
      result.qualified++;
      result.items.push({ ...item, status: "qualified", score: quality.score, imageUrl });
    } catch (error) {
      if (imageUrl) await deleteObject(imageUrl).catch(() => undefined);
      result.failed++;
      result.items.push({ ...item, status: "failed", issues: [String(error).slice(0, 160)] });
    }
  }

  return result;
}
