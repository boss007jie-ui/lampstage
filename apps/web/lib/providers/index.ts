/**
 * 选定 provider。MVP 只接 nano-banana；后面要换/AB 测试再加分支。
 */
import { nanoBananaProvider } from "./nano-banana";
import type { IGenerationProvider } from "./types";

export function getProvider(): IGenerationProvider {
  // 留扩展点：后面可读 env 里的 IMAGE_PROVIDER 切换
  return nanoBananaProvider;
}

export type { IGenerationProvider } from "./types";
