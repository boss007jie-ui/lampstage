import { putObject } from "@/lib/storage";
import { getProvider } from "@/lib/providers";
import type { ImageModelId } from "@/lib/image-models";

export type GenerateSceneParams = {
  sceneType: string;
  targetAudience: string;
  timeOfDay: string;
  imageModel?: ImageModelId;
};

export function buildScenePrompt(params: GenerateSceneParams): string {
  const style = params.targetAudience.replace(/_/g, " ");
  const scene = params.sceneType.replace(/_/g, " ");
  const light = params.timeOfDay === "daylight"
    ? "Soft natural daylight from large windows."
    : "Warm ambient lighting at dusk, darkening sky visible through windows.";
  return `A ${style} ${scene} interior photograph. ${light} Complete furniture layout: sofa, coffee table, rug, bookshelf, plant. NO lamp, NO pendant, NO chandelier, NO lighting fixture, NO ceiling light. Empty ceiling, plain ceiling, no hanging objects. Wide angle, 35mm lens, eye-level oblique camera. High quality interior design photography.`;
}

export async function generateScene(params: GenerateSceneParams): Promise<string> {
  const result = await getProvider(params.imageModel).generate({
    prompt: buildScenePrompt(params),
    referenceImageUrl: "/scene-refs-v2/_blank_canvas.png",
    aspectRatio: "1_1",
    platformStyle: "domestic_ecommerce",
    outputCount: 1,
  });
  if (!result.ok || !result.bytes || !result.mime) {
    throw new Error(result.error || "scene generation returned no image");
  }
  return putObject(
    `scene-seeds-generated/${params.sceneType}/${params.targetAudience}/${params.timeOfDay}-${Date.now()}`,
    result.bytes,
    result.mime,
  );
}
