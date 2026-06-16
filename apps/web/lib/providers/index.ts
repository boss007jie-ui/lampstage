/**
 * Provider 选择。默认策略：shot 0/1 走 nano-banana，shot 2 走 gpt-image-2。
 * IMAGE_PROVIDER=nano-banana 强制全部走 nano（回退/省钱）。
 */
import { nanoBananaProvider } from "./nano-banana";
import { gptImage2Provider } from "./gpt-image-2";
import type { IGenerationProvider } from "./types";

export function getProvider(): IGenerationProvider {
  return nanoBananaProvider;
}

/** 混合策略：前两张 nano-banana，第三张 gpt-image-2 */
export function getProviderForIndex(idx: number): IGenerationProvider {
  if (process.env.IMAGE_PROVIDER === "nano-banana") return nanoBananaProvider;
  if (process.env.IMAGE_PROVIDER === "gpt-image-2") return gptImage2Provider;
  return idx >= 2 ? gptImage2Provider : nanoBananaProvider;
}

export type { IGenerationProvider } from "./types";
