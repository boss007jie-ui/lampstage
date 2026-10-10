import { nanoBanana21Provider, image25Provider } from "./openlux-images";
import type { IGenerationProvider } from "./types";
import { DEFAULT_IMAGE_MODEL, type ImageModelId } from "../image-models";

export function getProvider(model: ImageModelId = DEFAULT_IMAGE_MODEL): IGenerationProvider {
  if (model === "nano_banana_21") return nanoBanana21Provider;
  if (model === "image_25") return image25Provider;
  throw new Error("Unsupported image model.");
}

export type { IGenerationProvider } from "./types";
