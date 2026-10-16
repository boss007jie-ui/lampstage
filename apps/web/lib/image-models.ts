/** Customer names are separate from the provider's fixed API model IDs. Safe for client imports. */
/** Product policy, not a verified OpenLux limit for either alias. */
export const APP_MAX_IMAGE_REFERENCES = 6;
export const IMAGE_MODELS = [
  { id: "nano_banana_21", name: "nano banana 2.1", apiModel: "gemini-nano-banana-2.1", maxReferences: APP_MAX_IMAGE_REFERENCES },
  { id: "image_25", name: "image 2.5", apiModel: "gpt-image-2-c", maxReferences: APP_MAX_IMAGE_REFERENCES },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];
export const DEFAULT_IMAGE_MODEL: ImageModelId = "nano_banana_21";

export function isImageModelId(value: unknown): value is ImageModelId {
  return IMAGE_MODELS.some(model => model.id === value);
}

export function getImageModel(id: ImageModelId) {
  const model = IMAGE_MODELS.find(item => item.id === id);
  if (!model) throw new Error("Unsupported image model.");
  return model;
}

/** Legacy jobs have no recorded choice; never relabel their old outputs as a new model. */
export function recordedImageModel(metadata: unknown): ImageModelId | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).image_model;
  return isImageModelId(value) ? value : null;
}

/** Only the native square output has been verified for these two new tools. */
export function validateImageSelection(model: unknown, aspect: unknown):
  | { ok: true; imageModel: ImageModelId }
  | { ok: false; reason: "bad_image_model" | "unsupported_model_aspect" } {
  if (model !== undefined && !isImageModelId(model)) return { ok: false, reason: "bad_image_model" };
  if (aspect !== "1_1") return { ok: false, reason: "unsupported_model_aspect" };
  return { ok: true, imageModel: model === undefined ? DEFAULT_IMAGE_MODEL : model as ImageModelId };
}
