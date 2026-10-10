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
  limits: { min_seconds: 4; max_seconds: 15; max_bytes: number; aspect_ratio: "9:16"; resolution: "768P" };
  pricing: { per_segment_coins: number | null; image_billing: "internal_beta" };
}

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
