// Explicit, bounded public fields only. Never serialize an upstream error body.
const lifecycleCodes = new Set([
  "video_draft_limit_reached", "video_job_limit_reached",
  "video_job_not_cancellable", "video_job_not_closable", "video_job_cancelled", "job_state_changed",
]);
const actions = new Set(["list_video_jobs", "cancel_video_job", "close_video_job", "continue_existing_job"]);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const defined = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

const knownVideoReferenceMessages = new Set([
  "每段需要 1–6 张按用途排序的参考图，不会自动舍弃或补图。", "参考图的 asset_id 或 role 无效。", "参考用途缺失或无效。",
  "同一段不能重复提交相同参考图。", "请先按完整动作提供 1–8 段 segment_plan。", "动作分段格式无效。",
  "分段需提供有效起点、完整原片动作时长和 4/5/6/8 秒生成时长；变速不得超过 15%。",
  "接续只能依赖前段，且本段需有一张 start_state 参考供已审阅的实际末帧替换。",
  "每段第一张参考必须是唯一的 start_state 完整起态图；请核对起始人物、衣物、场景和姿态。",
  "本段动作指令缺失或无效。", "动作前状态缺失或无效。", "动作后状态缺失或无效。",
  "动作窗口必须从原片开头连续覆盖，不能静默丢帧、重叠或漏掉操作。", "动作分段未覆盖完整原视频，请根据实际时长修正计划。",
  "视频生成模式无效，请核对原任务。", "不支持该视频生成模式。", "使用人物或场景参考图时，必须明确指定 direct_references 模式。",
  "直接参考模式需要产品图及另外两张参考图；目前共支持三张，不会自动补图或舍弃额外图片。",
  "每张参考图必须包含有效的 asset_id、角色及 1–80 字符的名称。", "三张参考图记录缺失、重复或角色不明确，请先核对素材。",
]);

const candidateReviewReasons = new Set([
  "invalid_decisions", "invalid_segment", "candidate_changed", "candidate_incomplete",
  "invalid_trim", "actual_duration_unknown", "duration_incompatible", "invalid_source_window",
  "retry_trim_conflict", "retry_reason_required", "dependent_result_exists", "invalid_action",
]);
const candidateTimingReasons = new Set([
  "compatible", "actual_duration_unknown", "invalid_source_window", "invalid_trim", "duration_out_of_range",
]);
const candidateTimingNumbers = [
  "source_duration", "requested_duration", "actual_duration", "trim_start", "kept_duration",
  "delivery_duration", "retime_ratio",
];
function safeCandidateTiming(value) {
  if (!record(value) || !["compatible", "incompatible", "unknown"].includes(value.status) ||
      !candidateTimingReasons.has(value.reason) || value.max_retime_ratio !== 1.15 ||
      value.visual_review_required !== true) return undefined;
  const safeNumber = item => item === null || (typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 86400);
  if (candidateTimingNumbers.some(field => !Object.hasOwn(value, field) || !safeNumber(value[field]))) return undefined;
  const allowed = value.allowed_kept_duration;
  if (allowed !== null && (!record(allowed) || typeof allowed.min !== "number" || typeof allowed.max !== "number" ||
      !Number.isFinite(allowed.min) || !Number.isFinite(allowed.max) ||
      allowed.min <= 0 || allowed.min > allowed.max || allowed.max > 86400)) return undefined;
  return {
    status: value.status, reason: value.reason,
    ...Object.fromEntries(candidateTimingNumbers.map(field => [field, value[field]])),
    max_retime_ratio: 1.15,
    allowed_kept_duration: allowed === null ? null : { min: allowed.min, max: allowed.max },
    visual_review_required: true,
  };
}

function safeCandidateReviewError(status, value) {
  if (status !== 400 || !record(value) || value.error !== "invalid_candidate_review") return null;
  const reason = candidateReviewReasons.has(value.reason) ? value.reason : undefined;
  if (!reason) return { error: "invalid_candidate_review", message: "Candidate review rejected. Inspect the current job before another decision." };
  return defined({
    error: "invalid_candidate_review",
    message: reason ? `Candidate review rejected: ${reason}.` : "Candidate review rejected. Inspect the current job before another decision.",
    reason,
    segment_index: Number.isInteger(value.segment_index) && value.segment_index >= 0 && value.segment_index <= 7 ? value.segment_index : undefined,
    timing: safeCandidateTiming(value.timing),
  });
}

export function safeVideoReferenceErrorContent(status, value) {
  if (status !== 400 || !record(value)) return null;
  return value.error === "invalid_video_references" && typeof value.message === "string" && value.message.length <= 160 && knownVideoReferenceMessages.has(value.message)
    ? { error: "invalid_video_references", message: value.message } : null;
}

export function safeErrorText(value, secret, max = 512) {
  if (typeof value !== "string") return undefined;
  let text = secret ? value.replaceAll(secret, "[redacted]") : value;
  text = text
    .replace(/\bBearer\s+[^\s,;"<>]+/gi, "Bearer [redacted]")
    .replace(/\b(?:authorization|api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[redacted-url]")
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return text.slice(0, max);
}

function code(value, secret, max = 80) {
  if (typeof value !== "string" || value.length > max || !/^[a-zA-Z0-9_-]+$/.test(value)) return undefined;
  return safeErrorText(value, secret, max) === value ? value : undefined;
}

function codes(value, secret) {
  return Array.isArray(value) ? value.slice(0, 32).map(item => code(item, secret)).filter(Boolean) : undefined;
}

function timestamp(value) {
  return typeof value === "string" && value.length <= 40 &&
    /^\d{4}-\d\d-\d\dT[\d:.+-]+Z?$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function safeUsage(value, secret) {
  if (!record(value)) return undefined;
  const bucket = (item, active) => {
    if (!record(item)) return undefined;
    return defined({
      count: count(item.count), limit: count(item.limit), remaining: count(item.remaining),
      ...(active ? { counted_statuses: codes(item.counted_statuses, secret), includes_unknown_statuses: item.includes_unknown_statuses === true ? true : undefined }
        : { ttl_seconds: count(item.ttl_seconds) }),
    });
  };
  return defined({
    observed_at: timestamp(value.observed_at), active: bucket(value.active, true), drafts: bucket(value.drafts, false),
    terminal_statuses: codes(value.terminal_statuses, secret),
  });
}

function safeSummary(value, secret) {
  if (!record(value)) return undefined;
  const nullableTime = item => item === null ? null : timestamp(item);
  return defined({
    id: code(value.id, secret, 128), title: safeErrorText(value.title, secret, 80),
    status: code(value.status, secret), stage: safeErrorText(value.stage, secret, 80), revision: count(value.revision),
    created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at),
    progress_updated_at: nullableTime(value.progress_updated_at),
    counts_toward_limit: typeof value.counts_toward_limit === "boolean" ? value.counts_toward_limit : undefined,
    quota_bucket: ["draft", "active", null].includes(value.quota_bucket) ? value.quota_bucket : undefined,
    can_cancel: typeof value.can_cancel === "boolean" ? value.can_cancel : undefined,
    cancel_blocked_reason: value.cancel_blocked_reason === null ? null : code(value.cancel_blocked_reason, secret),
    can_close: typeof value.can_close === "boolean" ? value.can_close : undefined,
    close_blocked_reason: value.close_blocked_reason === null ? null : code(value.close_blocked_reason, secret),
    draft_expires_at: nullableTime(value.draft_expires_at), cancelled_at: nullableTime(value.cancelled_at),
    cancellation_reason: ["user_cancelled", "user_closed", "draft_expired", null].includes(value.cancellation_reason) ? value.cancellation_reason : undefined,
  });
}

export class PublicApiError extends Error {
  constructor(data) {
    super((data.status ? data.status + ": " : "") + data.error + ": " + data.message);
    this.publicData = data;
  }
}

export function publicApiError(status, body, secret) {
  const error = code(body?.error, secret) || "api_request_failed";
  const data = { status, error, message: "Lampstage API request failed." };
  const referenceError = safeVideoReferenceErrorContent(status, body);
  if (referenceError) Object.assign(data, referenceError);
  const candidateError = safeCandidateReviewError(status, body);
  if (candidateError) Object.assign(data, candidateError);
  if (record(body) && lifecycleCodes.has(error)) {
    Object.assign(data, defined({
      message: safeErrorText(body.message, secret) || data.message,
      reason: code(body.reason, secret),
      scope: body.scope === "account" ? "account" : undefined,
      quota_bucket: ["draft", "active"].includes(body.quota_bucket) ? body.quota_bucket : undefined,
      limit: count(body.limit), count: count(body.count), remaining: count(body.remaining),
      retryable: body.retryable === false ? false : undefined,
      usage: safeUsage(body.usage, secret),
      job: safeSummary(body.job, secret),
      actions: Array.isArray(body.actions) ? [...new Set(body.actions.slice(0, 32).filter(action =>
        actions.has(action) && !(error === "video_job_limit_reached" && action === "cancel_video_job") &&
        !(error === "video_draft_limit_reached" && action === "close_video_job")))] : undefined,
    }));
  }
  return new PublicApiError(data);
}

export function unknownApiOutcome() {
  return new PublicApiError({
    error: "api_request_outcome_unknown", retryable: false,
    message: "The API response is uncertain. Query the existing job or list your jobs before any further submission; do not automatically create another task.",
  });
}
