import type { VideoJobData } from "./types";
import { generationMode, preparedReferencesReady, referenceDigest } from "./reference-inputs";
/** Called before claiming a queued render and again immediately before each paid submission. */
export function validateRenderConsent(data: VideoJobData, maxCoins: unknown, quote: number | null) {
  const direct = generationMode(data) === "direct_references";
  if (quote === null || !data.segments.length || data.segments.some(s => !s.clipKey || (!direct && (!s.openingKey || !s.endingKey))) ||
    (direct && !preparedReferencesReady(data))) return { ok: false as const, reason: "关键参考图或费用预估尚未就绪。" };
  const remaining = data.segments.filter(s => !s.candidateKey);
  if (!remaining.length) return { ok: false as const, reason: "所有视频片段均已生成，请核查并合成原任务。" };
  const estimate = remaining.length * quote;
  if (typeof maxCoins !== "number" || !Number.isSafeInteger(maxCoins) || maxCoins < estimate || maxCoins > 1000000) return { ok: false as const, reason: `本次预算需至少为 ${estimate} RH 币。` };
  if (remaining.some(s => s.submissionIntentAt || s.buildId)) return { ok: false as const, reason: "项目已有提交记录，请核查原任务，不能重复生成。" };
  return { ok: true as const, estimate, maxCoins, quote, segmentIndices: remaining.map(s => s.index),
    ...(direct ? { referenceDigest: referenceDigest(data) } : {}) };
}
