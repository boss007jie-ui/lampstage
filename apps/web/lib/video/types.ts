/** Public contracts contain media URLs only; storage keys and provider receipts stay server-side. */
export type VideoStatus = "draft" | "queued" | "preparing" | "review" | "generating" | "assembling" | "completed" | "failed" | "attention";
export type VideoPhase = "prepare" | "render" | "reconcile";

export interface VideoSegment {
  index: number;
  start: number;
  duration: 4 | 5;
  trimStart: number;
  clipKey?: string;
  openingKey?: string;
  endingKey?: string;
  candidateKey?: string;
  submissionIntentAt?: string;
  buildId?: string;
  providerTaskId?: string;
  error?: string;
}

export interface VideoJobData {
  version: 1;
  sourceDuration?: number;
  sourceHasAudio?: boolean;
  segments: VideoSegment[];
  outputKey?: string;
  imageCalls: number;
  renderConsent?: { at: string; maxCoins: number; estimatedCoins: number; perSegmentCoins: number; segmentIndices: number[] };
  /**
   * 业务进展。刻意放进 JSON 而不是加数据库列：这次改动不值得一次 schema 迁移，
   * 且旧读取器忽略未知字段即可兼容。
   */
  progress?: { stageCode: string; stageStartedAt: string; lastProgressAt: string };
}

export interface VideoJobView {
  id: string;
  title: string;
  status: VideoStatus;
  stage: string;
  instructions: string;
  preserve_audio: boolean;
  source_url: string;
  product_url: string;
  source_duration: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  /**
   * 业务进展时间（来自 data.progress，不是数据库 updated_at）。
   * 租约心跳每 20 秒就会刷新 updated_at，所以它**不能**代表业务在推进 —— 这两者必须分开看。
   * 旧数据没有 progress 时返回 null，不编造时间。
   */
  progress_updated_at: string | null;
  stage_code: string | null;
  segments: { index: number; start: number; duration: number; opening_url: string | null; ending_url: string | null; candidate_url: string | null }[];
  output_url: string | null;
  download_url: string | null;
  estimate: { segments: number; image_calls: number; video_coins: number | null };
}

export interface VideoCapabilities {
  beta: true;
  signed_in: boolean;
  eligible: boolean;
  database_ready: boolean;
  storage_ready: boolean;
  worker_ready: boolean;
  image_ready: boolean;
  video_ready: boolean;
  ready: boolean;
  reason: string | null;
  /** 运维暂停或付费开关关闭。此时不接受新的 prepare/render —— 与 ready 分开表达。 */
  paused: boolean;
  maintenance: string | null;
  limits: { min_seconds: typeof VIDEO_MIN_SECONDS; max_seconds: typeof VIDEO_MAX_SECONDS; max_bytes: number; aspect_ratio: "9:16"; resolution: "768P" };
  pricing: { per_segment_coins: number | null; image_billing: "internal_beta" };
}

/**
 * 平台参考片总时长的**单一来源**：媒体校验、分段、能力接口、文案都必须引用这里。
 * 注意：上游 H3 每段仍固定 4 或 5 秒——30 秒是平台侧成片目标，不是让上游一次生成 30 秒。
 */
export const VIDEO_MIN_SECONDS = 4;
export const VIDEO_MAX_SECONDS = 30;
export const VIDEO_MAX_BYTES = 150 * 1024 * 1024;
export const VIDEO_JOB_LIMIT = 10;
export function emptyVideoData(): VideoJobData { return { version: 1, segments: [], imageCalls: 0 }; }
export function videoData(value: unknown): VideoJobData {
  if (!value || typeof value !== "object" || !Array.isArray((value as VideoJobData).segments)) return emptyVideoData();
  return value as VideoJobData;
}

/** Configured conservative quote, not an upstream spending cap. Never invent an exchange rate. */
export function segmentCoinQuote(): number | null {
  const value = Number(process.env.VIDEO_H3_SEGMENT_QUOTE_COINS);
  return Number.isInteger(value) && value > 0 && value <= 100000 ? value : null;
}
