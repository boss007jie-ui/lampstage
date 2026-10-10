/**
 * Generation provider abstraction.
 *
 * 多家图像生成 API 都长得不一样（Gemini contents/parts、OpenAI images、
 * Replicate predictions、字节/通义/即梦各自 SDK），所以业务层只对这个抽象
 * 编程，换 provider 只换文件不动业务。
 */

export type AspectRatio = "1_1" | "4_5" | "16_9" | "9_16";
export type PlatformStyle = "domestic_ecommerce" | "brand_site";

export type Stage =
  | "analyzing"
  | "matching"
  | "generating"
  | "lighting"
  | "finalizing";

export interface GenInput {
  /** 拼好的最终 prompt（含模板、平台风格、负面约束） */
  prompt: string;
  /** 用户上传的灯具参考图 URL（公网可访问） */
  referenceImageUrl: string;
  /** 可选：场景/房间构图参考图 URL。用于多图参考，让模型保持房间布局和尺度。 */
  compositionReferenceUrl?: string;
  /** Private video frames can be supplied without publishing their storage URLs. */
  referenceImageData?: { bytes: Buffer; mime: string };
  compositionReferenceData?: { bytes: Buffer; mime: string };
  requestTimeoutMs?: number;
  aspectRatio: AspectRatio;
  platformStyle: PlatformStyle;
  /** MVP 固定 4 */
  outputCount: number;
  /** 可选：关联的生成任务 id，仅用于调用日志（ToolCallLog） */
  jobId?: string;
}

/** 单次调用结果：要么拿到 1 张图，要么失败。 */
export interface GenSingleResult {
  ok: boolean;
  /** PNG/JPEG 二进制 */
  bytes?: Buffer;
  mime?: string;
  /** 失败原因（人类可读，发给前端展示） */
  error?: string;
}

export interface IGenerationProvider {
  /** Provider 名字（写进任务记录方便排查） */
  readonly name: string;

  /** 单次调用，输出 1 张图。整体的"4 张"由编排层并发跑 4 次 submit 组装。 */
  generate(input: GenInput): Promise<GenSingleResult>;
}
