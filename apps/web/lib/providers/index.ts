/**
 * 选定 provider。MVP 只接 nano-banana；后面要换/AB 测试再加分支。
 */
import { nanoBananaProvider } from "./nano-banana";
import { gptImage2Provider } from "./gpt-image-2";
import type { IGenerationProvider } from "./types";

export function getProvider(): IGenerationProvider {
  const p = process.env.IMAGE_PROVIDER || "gpt-image-2";
  return p === "nano-banana" ? nanoBananaProvider : gptImage2Provider;
}

export type { IGenerationProvider } from "./types";
