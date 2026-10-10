import { nanoBananaProvider } from "@/lib/providers/nano-banana";
import { VideoPipelineError } from "./media";
import sharp from "sharp";

/** Roles follow Hypit image-direction: frame supplies composition, product supplies physical facts. */
export async function generateReference(input: { product: { bytes: Buffer; mime: string }; frame: Buffer; endpoint: "opening" | "ending"; instructions: string; jobId: string }): Promise<{ bytes: Buffer; mime: string }> {
  const result = await nanoBananaProvider.generate({
    referenceImageUrl: "", referenceImageData: input.product,
    compositionReferenceData: { bytes: input.frame, mime: "image/png" },
    // Native new-model output is square; the existing video-frame crop below produces 720×1280.
    aspectRatio: "1_1", platformStyle: "brand_site", outputCount: 1, jobId: input.jobId, requestTimeoutMs: 120_000,
    prompt: `Create a photorealistic ${input.endpoint === "opening" ? "opening" : "ending"} frame for a lamp product video. Image 1 is the exact source-video frame: preserve its room, architecture, furnishings, people, action state, framing, camera angle and natural exposure. Image 2 is the product: reproduce its exact silhouette, component count, shade geometry, proportions, material, finish and color. Replace the relevant lamp with this product, keeping believable fixture scale, mounting, support, gravity, occlusion, contact and cast shadows. A pendant attaches to the ceiling; a wall lamp attaches to a wall; a table or floor lamp stands on a supporting surface. Preserve all unrelated objects. Match the source frame's photographic texture and lighting; illuminated material remains detailed. This ${input.endpoint} frame follows its own supplied source moment, preserving the distinct camera/action position visible there. No collage, diagram, extra fixture, text or watermark. User direction: ${input.instructions || "Keep the source setting and showcase the supplied lamp naturally."}`,
  });
  if (!result.ok || !result.bytes || !result.mime?.startsWith("image/")) throw new VideoPipelineError("参考图生成未完成；已记录调用次数，请人工核对后再继续。");
  const bytes = await sharp(result.bytes).rotate().resize(720, 1280, { fit: "cover" }).png().toBuffer();
  return { bytes, mime: "image/png" };
}

export function videoDirection(instructions: string): string {
  return `Recreate the supplied reference clip's complete camera movement, action timing, physical interactions and room continuity. The product image establishes the lamp's exact shape, shade and component count, proportions, material and color. The opening and ending images anchor the scene's respective start and end states. Carry the same product continuously between them, mounted at a physically plausible scale and location with stable support, perspective, occlusion and lighting. Preserve the reference environment, furniture, people and their actions. Keep the lamp rigid and consistent through camera motion: no shape drift, duplicated fixtures, floating objects or added text. Follow the source clip's existing cuts and motion; do not invent a new scene or camera path. ${instructions || "Show the lamp naturally within the reference action."}`;
}
