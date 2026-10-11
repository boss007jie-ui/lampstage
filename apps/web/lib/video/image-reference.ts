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
    prompt: `Create a photorealistic ${input.endpoint === "opening" ? "opening" : "ending"} frame for a product video. Image 1 is the exact source-video frame: preserve its setting, architecture, furnishings, people, action state, framing, camera angle and natural exposure. Image 2 is the product: reproduce its exact silhouette, component count, geometry, proportions, material, finish and color. Replace only the subject identified by the user with this product. Keep a plausible scale, support, gravity, occlusion, contact and cast shadows appropriate to this product category. Use only the supports or mounting mechanisms visible in the supplied product. Preserve all unrelated objects. Match the source frame's photographic texture and lighting. This ${input.endpoint} frame follows its own supplied source moment, preserving the distinct camera/action position visible there. No collage, diagram, duplicate product, added text or watermark. User direction: ${input.instructions || "Keep the source setting and showcase the supplied product naturally."}`,
  });
  if (!result.ok || !result.bytes || !result.mime?.startsWith("image/")) throw new VideoPipelineError("参考图生成未完成；已记录调用次数，请人工核对后再继续。");
  const bytes = await sharp(result.bytes).rotate().resize(720, 1280, { fit: "cover" }).png().toBuffer();
  return { bytes, mime: "image/png" };
}

export function videoDirection(instructions: string): string {
  return `Recreate the supplied reference clip's complete camera movement, action timing, physical interactions and scene continuity. The product image establishes the product's exact shape, component count, proportions, material and color. The opening and ending images anchor the scene's respective start and end states. Carry the same product continuously between them at a physically plausible scale and location with stable support, perspective, occlusion and lighting appropriate to its category. Preserve the reference environment, furniture, people and their actions. Keep product identity consistent through camera motion: no shape drift, duplicated products, unsupported floating objects or added text. Follow the source clip's existing cuts and motion; do not invent a new scene or camera path. ${instructions || "Show the product naturally within the reference action."}`;
}
