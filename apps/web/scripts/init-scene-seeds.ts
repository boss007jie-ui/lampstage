import { prisma } from "@/lib/db";
import { generateScene } from "@/lib/scene-generator";
import {
  C27_SCENE_TYPES,
  SCENE_SEED_STYLES,
  SCENE_SEED_TIMES,
  ensureDefaultSceneSeeds,
} from "@/lib/scene-seed";
import { qualityCheckScene } from "@/lib/scene-quality";
import { deleteObject } from "@/lib/storage";

type SeedRunSummary = {
  attempted: number;
  qualified: number;
  failed: number;
  skipped: number;
};

function maxNewSeeds(): number {
  const raw = Number(process.env.C27_SEED_LIMIT || 60);
  return Number.isFinite(raw) && raw > 0 ? Math.min(60, Math.floor(raw)) : 60;
}

async function createQualifiedSceneSeed(params: {
  sceneType: string;
  targetAudience: string;
  timeOfDay: string;
}): Promise<boolean> {
  const imageUrl = await generateScene(params);
  const quality = await qualityCheckScene(imageUrl, params);
  if (!quality.passed) {
    await deleteObject(imageUrl).catch(() => undefined);
    console.log(`[seed] rejected ${params.sceneType}/${params.targetAudience}/${params.timeOfDay}: ${quality.issues.join(",")}`);
    return false;
  }
  await prisma.sceneSeed.create({
    data: {
      scene_type: params.sceneType,
      target_audience: params.targetAudience,
      time_of_day: params.timeOfDay,
      image_url: imageUrl,
      quality_score: quality.score,
      source: "generated",
      is_qualified: true,
    },
  });
  console.log(`[seed] qualified ${params.sceneType}/${params.targetAudience}/${params.timeOfDay}: ${quality.score}`);
  return true;
}

export async function generateNewSeeds(): Promise<SeedRunSummary> {
  const summary: SeedRunSummary = { attempted: 0, qualified: 0, failed: 0, skipped: 0 };
  const limit = maxNewSeeds();
  for (const targetAudience of SCENE_SEED_STYLES) {
    for (const sceneType of C27_SCENE_TYPES) {
      for (const timeOfDay of SCENE_SEED_TIMES) {
        const existing = await prisma.sceneSeed.findFirst({
          where: {
            scene_type: sceneType,
            target_audience: targetAudience,
            time_of_day: timeOfDay,
            source: "generated",
            is_qualified: true,
          },
          select: { id: true },
        });
        if (existing) {
          summary.skipped++;
          continue;
        }
        if (summary.attempted >= limit) return summary;
        summary.attempted++;
        try {
          if (await createQualifiedSceneSeed({ sceneType, targetAudience, timeOfDay })) {
            summary.qualified++;
          } else {
            summary.failed++;
          }
        } catch (error) {
          summary.failed++;
          console.error(`[seed] failed ${sceneType}/${targetAudience}/${timeOfDay}:`, error);
        }
      }
    }
  }
  return summary;
}

async function main() {
  const created = await ensureDefaultSceneSeeds();
  const generated = process.env.C27_GENERATE_NEW_SEEDS === "1"
    ? await generateNewSeeds()
    : { attempted: 0, qualified: 0, failed: 0, skipped: 0 };
  const total = await prisma.sceneSeed.count();
  const qualified = await prisma.sceneSeed.count({ where: { is_qualified: true } });
  console.log(JSON.stringify({ created, generated, total, qualified }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
