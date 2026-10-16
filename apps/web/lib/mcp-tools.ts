import { downloadMcpSource } from "@/lib/mcp-download";
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as capabilitiesGet } from "@/app/api/v1/capabilities/route";
import { POST as assetsPost } from "@/app/api/v1/assets/route";
import { POST as videoAssetsPost } from "@/app/api/v1/video-assets/route";
import { POST as imageJobsPost } from "@/app/api/v1/image-jobs/route";
import { POST as videoJobsPost } from "@/app/api/v1/video-jobs/route";
import { POST as prepareVideoPost } from "@/app/api/v1/video-jobs/[id]/prepare/route";
import { POST as renderVideoPost } from "@/app/api/v1/video-jobs/[id]/render/route";
import { POST as reviewVideoPost } from "@/app/api/v1/video-jobs/[id]/review/route";
import { POST as assembleVideoPost } from "@/app/api/v1/video-jobs/[id]/assemble/route";
import { POST as reconcileVideoPost } from "@/app/api/v1/video-jobs/[id]/reconcile/route";
import { GET as accountUsageGet } from "@/app/api/v1/account/usage/route";
import { GET as listVideoJobsGet } from "@/app/api/v1/video-jobs/route";
import { GET as getVideoDeliveryGet } from "@/app/api/v1/video-jobs/[id]/delivery/route";
import { POST as submitVideoFeedbackPost } from "@/app/api/v1/video-jobs/[id]/feedback/route";
import { GET as listVideoTemplatesGet } from "@/app/api/v1/video-templates/route";
import { GET as getVideoTemplateGet, PATCH as updateVideoTemplatePatch } from "@/app/api/v1/video-templates/[id]/route";
import { GET as listCharactersGet, POST as saveCharacterPost } from "@/app/api/v1/characters/route";
import { GET as getCharacterGet, PATCH as updateCharacterPatch } from "@/app/api/v1/characters/[id]/route";
import { POST as saveCharacterVersionPost } from "@/app/api/v1/characters/[id]/versions/route";
import { GET as listCharacterAssetsGet } from "@/app/api/v1/character-assets/route";
import { POST as cancelVideoPost } from "@/app/api/v1/video-jobs/[id]/cancel/route";
import { POST as closeVideoPost } from "@/app/api/v1/video-jobs/[id]/close/route";
import { GET as jobsGet } from "@/app/api/v1/jobs/[id]/route";
import { NextRequest } from "next/server";
import { logMcpCall } from "@/lib/tool-log";
import { ImageInputError, imageOutputCount, parseImageReferences, IMAGE_REFERENCE_ROLES } from "@/lib/image-reference-contract";
import { DEFAULT_IMAGE_MODEL, isImageModelId } from "@/lib/image-models";
export { safeLifecycleErrorContent } from "@/lib/video/lifecycle-error";
import { safeLifecycleErrorContent } from "@/lib/video/lifecycle-error";
import { safeCandidateReviewErrorContent } from "@/lib/video/candidate-review-error";

export const MCP_TOOLS = [
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload a public image or video URL", inputSchema: { type: "object", properties: { source_url: { type: "string", maxLength: 2048 }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "create_image_job", description: "Create an image job with one asset or 1–6 ordered reference images. image_count is the requested number of outputs, not the number of reference inputs. Each character binding requires both character_version_id and image_index.", inputSchema: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, role: { type: "string", enum: IMAGE_REFERENCE_ROLES }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: "string", minLength: 1, maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, custom_prompt: { type: "string", minLength: 1, maxLength: 12000 }, image_count: { type: "integer", minimum: 1, maximum: 4 }, image_model: { type: "string", enum: ["nano_banana_21", "image_25"], default: DEFAULT_IMAGE_MODEL }, platform_style: { type: "string", enum: ["domestic_ecommerce", "brand_site"] }, aspect_ratio: { type: "string", enum: ["1_1"] } }, required: ["custom_prompt", "image_count"], oneOf: [{ required: ["asset_id"] }, { required: ["reference_assets"] }], additionalProperties: false } },
  { name: "create_video_job", description: "Create a video project. An explicitly chosen template_version_id may reuse a private template; creation does not prepare or render. six_references uses 1–6 ordered references and a required semantic segment_plan.", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, template_version_id: { type: "string", minLength: 1, maxLength: 128 }, product_asset_id: { type: "string" }, generation_mode: { type: "string", enum: ["direct_references", "six_references", "legacy_frames"] }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string" }, role: { type: "string", enum: ["product", "character", "scene", "product_detail", "start_state", "end_state"] }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: ["string", "null"], maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, segment_plan: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { start: { type: "number", minimum: 0 }, source_duration: { type: "number", exclusiveMinimum: 0 }, duration: { type: "integer", enum: [4, 5, 6, 8] }, instructions: { type: "string", minLength: 1, maxLength: 1600 }, before_state: { type: "string", minLength: 1, maxLength: 400 }, after_state: { type: "string", minLength: 1, maxLength: 400 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string" }, role: { type: "string", enum: ["product", "character", "scene", "product_detail", "start_state", "end_state"] }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: ["string", "null"], maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, start_from_segment: { type: "integer", minimum: 0 } }, required: ["start", "source_duration", "duration", "instructions", "before_state", "after_state"], additionalProperties: false } }, title: { type: "string", maxLength: 80 }, instructions: { type: "string", maxLength: 2000 }, preserve_audio: { type: "boolean" } }, required: ["source_asset_id"] } },
  { name: "prepare_video_job", description: "Prepare reviewable inputs. Direct-reference mode freezes supplied images and slices source motion without generating opening or ending frames; legacy jobs retain their recorded method.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "render_video_job", description: "Render an approved video through Hypit. review_token must be the value returned by get_job on the review you actually showed the user; a changed reference, window, segment set or price invalidates it.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, max_coins: { type: "number" }, review_token: { type: "string", minLength: 64, maxLength: 64 } }, required: ["job_id", "max_coins", "review_token"] } },
  { name: "review_video_segments", description: "Accept or retry exact generated candidates after playing their videos; use candidate_sha256='failed' only for a terminal failed segment retry with a reason. Accept may specify a reviewed leading trim_start.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, candidate_review_token: { type: "string", minLength: 64, maxLength: 64 }, decisions: { type: "array", minItems: 1, items: { type: "object", properties: { segment_index: { type: "integer", minimum: 0 }, candidate_sha256: { type: "string", minLength: 6, maxLength: 64 }, action: { type: "string", enum: ["accept", "retry"] }, reason: { type: "string" }, trim_start: { type: "number", minimum: 0 } }, required: ["segment_index", "candidate_sha256", "action"], additionalProperties: false } } }, required: ["job_id", "candidate_review_token", "decisions"] } },
  { name: "assemble_video_job", description: "Assemble accepted segment candidates using the current candidate_review_token.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, candidate_review_token: { type: "string", minLength: 64, maxLength: 64 } }, required: ["job_id", "candidate_review_token"] } },
  { name: "reconcile_video_job", description: "Recover existing unknown RunningHub submissions for an attention job; sends no new generation request.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "get_job", description: "Read an image or video job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "download_output", description: "Resolve output URLs for a job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "get_account_usage", description: "Read independent draft and active video capacity for the account", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_video_jobs", description: "List account video jobs for recovery, with status filter and cursor pagination", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["all", "draft", "active", "history"] }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string" } }, additionalProperties: false } },
  { name: "cancel_video_job", description: "Cancel a selected eligible never-started draft", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false } },
  { name: "close_video_job", description: "Close a user-selected stopped review or attention job only after the user explicitly abandons it and list_video_jobs reports can_close=true. This releases active capacity without deleting media. Supply the observed revision; never close jobs automatically to bypass quota.", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1 }, expected_revision: { type: "integer", minimum: 0 } }, required: ["job_id", "expected_revision"], additionalProperties: false } },
  { name: "get_video_delivery", description: "Read full output and accepted segment delivery for a video job", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["job_id"], additionalProperties: false } },
  { name: "submit_video_feedback", description: "Submit explicit feedback bound to the exact completed output hash. Only satisfied_save_template saves a private template.", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1, maxLength: 128 }, decision: { type: "string", enum: ["satisfied_save_template", "satisfied", "needs_changes"] }, output_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, notes: { type: "string", maxLength: 2000 }, name: { type: "string", maxLength: 80 }, category: { type: "string", maxLength: 40 }, template_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["job_id", "decision", "output_sha256"], additionalProperties: false } },
  { name: "list_video_templates", description: "List private video templates with optional source match and cursor pagination", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "archived", "all"] }, source_asset_id: { type: "string", minLength: 1, maxLength: 128 }, source_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" } }, additionalProperties: false } },
  { name: "get_video_template", description: "Read a private template and selected immutable recipe version", inputSchema: { type: "object", properties: { template_id: { type: "string", minLength: 1, maxLength: 128 }, version_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["template_id"], additionalProperties: false } },
  { name: "update_video_template", description: "Rename, categorize, archive or restore a private template", inputSchema: { type: "object", properties: { template_id: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, archived: { type: "boolean" } }, required: ["template_id"], additionalProperties: false } },
  { name: "list_characters", description: "List account-owned character profiles by status and code/name search", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "archived", "all"] }, q: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512 } }, additionalProperties: false } },
  { name: "get_character", description: "Read an owned character and its fixed image-reference versions", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, version_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["character_id"], additionalProperties: false } },
  { name: "save_character", description: "Explicitly save 1–6 existing owned image assets as an independent character profile; reuse a stable idempotency key for retries", inputSchema: { type: "object", properties: { idempotency_key: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, description: { type: "string", maxLength: 2000 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, label: { type: "string", minLength: 1, maxLength: 80 } }, required: ["asset_id", "label"], additionalProperties: false } } }, required: ["idempotency_key", "name", "reference_assets"], additionalProperties: false } },
  { name: "save_character_version", description: "Explicitly add a new immutable version to an owned character using the version currently being edited", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, expected_latest_version_id: { type: "string", minLength: 1, maxLength: 128 }, description: { type: "string", maxLength: 2000 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, label: { type: "string", minLength: 1, maxLength: 80 } }, required: ["asset_id", "label"], additionalProperties: false } } }, required: ["character_id", "expected_latest_version_id", "reference_assets"], additionalProperties: false } },
  { name: "update_character", description: "Rename, categorize, archive or restore an owned character profile", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, archived: { type: "boolean" } }, required: ["character_id"], additionalProperties: false } },
  { name: "list_character_assets", description: "List account-owned original image assets available for explicit character selection", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512 } }, additionalProperties: false } },
] as const;

const MCP_ORIGIN = "https://lampstage.com";
const videoTemplateRoutes = {
  imageJobs: imageJobsPost,
  delivery: getVideoDeliveryGet,
  feedback: submitVideoFeedbackPost,
  list: listVideoTemplatesGet,
  detail: getVideoTemplateGet,
  update: updateVideoTemplatePatch,
  videoJobs: videoJobsPost,
  listCharacters: listCharactersGet,
  getCharacter: getCharacterGet,
  saveCharacter: saveCharacterPost,
  saveCharacterVersion: saveCharacterVersionPost,
  updateCharacter: updateCharacterPatch,
  listCharacterAssets: listCharacterAssetsGet,
};
type VideoTemplateRouteOverrides = Partial<typeof videoTemplateRoutes>;
type InternalInit = { method?: string; headers?: HeadersInit; body?: BodyInit | null };
function internalRequest(request: Request, path: string, init: InternalInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", request.headers.get("authorization") || "");
  headers.set("Accept", "application/json");
  return new NextRequest(new URL(`/api/v1${path}`, MCP_ORIGIN), { method: init.method, headers, body: init.body ?? undefined });
}
async function routeResult(response: Response | undefined) {
  if (!response) throw new Error("Upstream route returned no response");
  const text = await response.text(); let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { value = {}; }
  if (!response.ok) {
    const safeContent = safeLifecycleErrorContent(response.status, value) ?? safeVideoReferenceErrorContent(response.status, value) ?? safeCandidateReviewErrorContent(response.status, value);
    const isLifecycleError = typeof value === "object" && value !== null && "error" in value && typeof (value as { error: unknown }).error === "string" && ["video_draft_limit_reached", "video_job_limit_reached", "video_job_not_cancellable", "video_job_not_closable", "video_job_cancelled", "job_state_changed"].includes((value as { error: string }).error);
    const errorCode = typeof value === "object" && value && "error" in value ? (value as { error: unknown }).error : undefined;
    const message = safeContent ? String(safeContent.message ?? safeContent.error) : isLifecycleError ? `Upstream lifecycle error (${response.status})` : typeof errorCode === "string" && /^[a-z][a-z0-9_]{0,80}$/.test(errorCode) ? errorCode : `Upstream request failed (${response.status})`;
    const error = new Error(message) as Error & { status?: number; safeContent?: Record<string, unknown>; publicMessage?: string };
    error.status = response.status; error.publicMessage = message; if (safeContent) error.safeContent = safeContent;
    throw error;
  }
  return value;
}
export const mcpToolInternals = { routeResult, validateTemplateArgs: videoTemplateArgs, characterRequest };
const knownVideoReferenceMessages = new Set([
  "每段第一张参考必须是唯一的 start_state 完整起态图；请核对起始人物、衣物、场景和姿态。",
  "每段需要 1–6 张按用途排序的参考图，不会自动舍弃或补图。", "参考图的 asset_id 或 role 无效。", "参考用途缺失或无效。",
  "同一段不能重复提交相同参考图。", "请先按完整动作提供 1–8 段 segment_plan。", "动作分段格式无效。",
  "分段需提供有效起点、完整原片动作时长和 4/5/6/8 秒生成时长；变速不得超过 15%。",
  "接续只能依赖前段，且本段需有一张 start_state 参考供已审阅的实际末帧替换。",
  "本段动作指令缺失或无效。", "动作前状态缺失或无效。", "动作后状态缺失或无效。",
  "动作窗口必须从原片开头连续覆盖，不能静默丢帧、重叠或漏掉操作。", "动作分段未覆盖完整原视频，请根据实际时长修正计划。",
  "视频生成模式无效，请核对原任务。", "不支持该视频生成模式。", "使用人物或场景参考图时，必须明确指定 direct_references 模式。",
  "直接参考模式需要产品图及另外两张参考图；目前共支持三张，不会自动补图或舍弃额外图片。",
  "每张参考图必须包含有效的 asset_id、角色及 1–80 字符的名称。", "三张参考图记录缺失、重复或角色不明确，请先核对素材。",
]);
/** Only fixed parser strings from the public create route may cross the MCP boundary. */
export function safeVideoReferenceErrorContent(status: number, value: unknown): Record<string, string> | null {
  if (status !== 400 || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  return body.error === "invalid_video_references" && typeof body.message === "string" && body.message.length <= 160 && knownVideoReferenceMessages.has(body.message)
    ? { error: "invalid_video_references", message: body.message } : null;
}
function stringArg(args: Record<string, unknown>, key: string, required = true) { const value = args[key]; if (typeof value !== "string" || (required && !value.trim())) { const error = new Error(`Invalid parameter: ${key}`) as Error & { code?: number }; error.code = -32602; throw error; } return value; }
function exactKeys(args: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(args).some(key => !allowed.includes(key))) invalidVideo("Invalid parameter: unknown field");
}
function boundedString(args: Record<string, unknown>, key: string, max: number, required = false, allowEmpty = false, allowMultiline = false) {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) ||
      (allowMultiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) invalidVideo(`Invalid parameter: ${key}`);
  return value;
}
function identifierArg(args: Record<string, unknown>, key: string, required = true) {
  const value = boundedString(args, key, 128, required);
  if (value !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) invalidVideo(`Invalid parameter: ${key}`);
  return value;
}
function shaArg(args: Record<string, unknown>, key: string, required = false) {
  const value = boundedString(args, key, 64, required);
  if (value !== undefined && !/^[a-f0-9]{64}$/.test(value)) invalidVideo(`Invalid parameter: ${key}`);
  return value;
}
function videoTemplateArgs(name: string, args: Record<string, unknown>) {
  if (name === "get_video_delivery") { exactKeys(args, ["job_id"]); return { job_id: identifierArg(args, "job_id")! }; }
  if (name === "submit_video_feedback") {
    exactKeys(args, ["job_id", "decision", "output_sha256", "notes", "name", "category", "template_id"]);
    const job_id = identifierArg(args, "job_id")!;
    const decision = boundedString(args, "decision", 32, true)!;
    if (!["satisfied_save_template", "satisfied", "needs_changes"].includes(decision)) invalidVideo("Invalid parameter: decision");
    const output_sha256 = shaArg(args, "output_sha256", true)!;
    const notes = boundedString(args, "notes", 2000, false, true, true);
    const templateName = boundedString(args, "name", 80, false, true);
    const category = boundedString(args, "category", 40, false, true);
    const template_id = identifierArg(args, "template_id", false);
    if (template_id && decision !== "satisfied_save_template") invalidVideo("template_id requires satisfied_save_template");
    return { job_id, decision, output_sha256, ...(notes === undefined ? {} : { notes }), ...(templateName === undefined ? {} : { name: templateName }), ...(category === undefined ? {} : { category }), ...(template_id === undefined ? {} : { template_id }) };
  }
  if (name === "list_video_templates") {
    exactKeys(args, ["status", "source_asset_id", "source_sha256", "limit", "cursor"]);
    const status = boundedString(args, "status", 8);
    if (status && !["active", "archived", "all"].includes(status)) invalidVideo("Invalid parameter: status");
    const source_asset_id = identifierArg(args, "source_asset_id", false);
    const source_sha256 = shaArg(args, "source_sha256");
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50)) invalidVideo("Invalid parameter: limit");
    const cursor = boundedString(args, "cursor", 512);
    if (cursor !== undefined && !/^[A-Za-z0-9_-]+$/.test(cursor)) invalidVideo("Invalid parameter: cursor");
    return { status, source_asset_id, source_sha256, limit: limit as number | undefined, cursor };
  }
  if (name === "get_video_template") { exactKeys(args, ["template_id", "version_id"]); return { template_id: identifierArg(args, "template_id")!, version_id: identifierArg(args, "version_id", false) }; }
  exactKeys(args, ["template_id", "name", "category", "archived"]);
  const template_id = identifierArg(args, "template_id")!;
  const templateName = boundedString(args, "name", 80);
  const category = boundedString(args, "category", 40, false, true);
  const archived = args.archived;
  if (archived !== undefined && typeof archived !== "boolean") invalidVideo("Invalid parameter: archived");
  if (templateName === undefined && category === undefined && archived === undefined) invalidVideo("At least one template field is required");
  return { template_id, ...(templateName === undefined ? {} : { name: templateName }), ...(category === undefined ? {} : { category }), ...(archived === undefined ? {} : { archived }) };
}
export function videoTemplateListPath(args: Record<string, unknown>) {
  const values = videoTemplateArgs("list_video_templates", args);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value));
  return `/video-templates${query.size ? `?${query}` : ""}`;
}
function characterReferences(args: Record<string, unknown>) {
  const refs = args.reference_assets;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 6) invalidVideo("Invalid parameter: reference_assets");
  const seen = new Set<string>();
  return (refs as unknown[]).map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalidVideo(`Invalid reference_assets[${index}]`);
    const ref = raw as Record<string, unknown>;
    exactKeys(ref, ["asset_id", "label"]);
    const asset_id = identifierArg(ref, "asset_id")!;
    const label = boundedString(ref, "label", 80, true)!;
    if (seen.has(asset_id)) invalidVideo("Duplicate character reference asset_id");
    seen.add(asset_id);
    return { asset_id, label };
  });
}
export function characterRequest(name: string, args: Record<string, unknown>): { path: string; method?: "POST" | "PATCH"; body?: Record<string, unknown> } {
  if (name === "list_characters") {
    exactKeys(args, ["status", "q", "limit", "cursor"]);
    const status = boundedString(args, "status", 8);
    if (status !== undefined && !["active", "archived", "all"].includes(status)) invalidVideo("Invalid parameter: status");
    const q = boundedString(args, "q", 80, false, true);
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50)) invalidVideo("Invalid parameter: limit");
    const cursor = boundedString(args, "cursor", 512);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, q, limit, cursor })) if (value !== undefined) query.set(key, String(value));
    return { path: `/characters${query.size ? `?${query}` : ""}` };
  }
  if (name === "list_character_assets") {
    exactKeys(args, ["limit", "cursor"]);
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50)) invalidVideo("Invalid parameter: limit");
    const cursor = boundedString(args, "cursor", 512);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ limit, cursor })) if (value !== undefined) query.set(key, String(value));
    return { path: `/character-assets${query.size ? `?${query}` : ""}` };
  }
  if (name === "get_character") {
    exactKeys(args, ["character_id", "version_id"]);
    const id = identifierArg(args, "character_id")!;
    const version_id = identifierArg(args, "version_id", false);
    return { path: `/characters/${encodeURIComponent(id)}${version_id ? `?${new URLSearchParams({ version_id })}` : ""}` };
  }
  if (name === "save_character") {
    exactKeys(args, ["idempotency_key", "name", "category", "description", "reference_assets"]);
    const idempotency_key = identifierArg(args, "idempotency_key")!;
    const profileName = boundedString(args, "name", 80, true)!;
    const category = boundedString(args, "category", 40, false, true);
    const description = boundedString(args, "description", 2000, false, true, true);
    const reference_assets = characterReferences(args);
    return { path: "/characters", method: "POST", body: { idempotency_key, name: profileName,
      ...(category === undefined ? {} : { category }), ...(description === undefined ? {} : { description }), reference_assets } };
  }
  if (name === "save_character_version") {
    exactKeys(args, ["character_id", "expected_latest_version_id", "description", "reference_assets"]);
    const id = identifierArg(args, "character_id")!;
    const expected_latest_version_id = identifierArg(args, "expected_latest_version_id")!;
    const description = boundedString(args, "description", 2000, false, true, true);
    const reference_assets = characterReferences(args);
    return { path: `/characters/${encodeURIComponent(id)}/versions`, method: "POST", body: { expected_latest_version_id,
      ...(description === undefined ? {} : { description }), reference_assets } };
  }
  if (name === "update_character") {
    exactKeys(args, ["character_id", "name", "category", "archived"]);
    const id = identifierArg(args, "character_id")!;
    const profileName = boundedString(args, "name", 80);
    const category = boundedString(args, "category", 40, false, true);
    const archived = args.archived;
    if (archived !== undefined && typeof archived !== "boolean") invalidVideo("Invalid parameter: archived");
    if (profileName === undefined && category === undefined && archived === undefined) invalidVideo("At least one character field is required");
    return { path: `/characters/${encodeURIComponent(id)}`, method: "PATCH", body: {
      ...(profileName === undefined ? {} : { name: profileName }), ...(category === undefined ? {} : { category }), ...(archived === undefined ? {} : { archived }) } };
  }
  return invalidVideo("Unknown character tool");
}
function imageArgs(args: Record<string, unknown>) {
  const allowed = ["asset_id", "uploaded_asset_id", "reference_assets", "custom_prompt", "image_count", "image_model", "platform_style", "aspect_ratio"];
  if (Object.keys(args).some(key => !allowed.includes(key))) invalidVideo("Invalid parameter: unknown image field");
  let references;
  try { references = parseImageReferences(args); imageOutputCount(args.image_count, true); }
  catch (error) { if (error instanceof ImageInputError) invalidVideo(`Invalid parameter: ${error.code}`); throw error; }
  if (typeof args.custom_prompt !== "string" || !args.custom_prompt.trim() || args.custom_prompt.trim().length > 12000) invalidVideo("Invalid parameter: custom_prompt");
  if (args.platform_style !== undefined && !["domestic_ecommerce", "brand_site"].includes(String(args.platform_style))) invalidVideo("Invalid parameter: platform_style");
  if (args.aspect_ratio !== undefined && args.aspect_ratio !== "1_1") invalidVideo("Invalid parameter: aspect_ratio");
  if (args.image_model !== undefined && !isImageModelId(args.image_model)) invalidVideo("Invalid parameter: image_model");
  const common = { custom_prompt: args.custom_prompt, image_count: args.image_count, ...(args.image_model === undefined ? {} : { image_model: args.image_model }), ...(args.platform_style === undefined ? {} : { platform_style: args.platform_style }), ...(args.aspect_ratio === undefined ? {} : { aspect_ratio: args.aspect_ratio }) };
  if (references) return { ...common, reference_assets: references };
  if (Object.prototype.hasOwnProperty.call(args, "uploaded_asset_id")) invalidVideo("Invalid parameter: uploaded_asset_id");
  if (typeof args.asset_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(args.asset_id)) invalidVideo("Invalid parameter: asset_id");
  return { ...common, asset_id: args.asset_id, uploaded_asset_id: args.asset_id };
}
function invalidVideo(message: string): never { const error = new Error(message) as Error & { code?: number }; error.code = -32602; throw error; }
function validateSixReferenceArray(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) invalidVideo(`${name} must contain 1–6 ordered references`);
  const ids = new Set<string>();
  for (const ref of value as unknown[]) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) invalidVideo(`Invalid ${name} entry`);
    const item = ref as Record<string, unknown>;
    if (typeof item.asset_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.asset_id) || typeof item.label !== "string" || !item.label.trim() || item.label.length > 80 || /[\u0000-\u001f\u007f]/.test(item.label) ||
        !["product", "character", "scene", "product_detail", "start_state", "end_state"].includes(String(item.role)) ||
        Object.keys(item).some(key => !["asset_id", "role", "label", "character_version_id", "image_index"].includes(key))) invalidVideo(`Invalid ${name} entry`);
    const hasVersion = Object.prototype.hasOwnProperty.call(item, "character_version_id");
    const hasIndex = Object.prototype.hasOwnProperty.call(item, "image_index");
    if (hasVersion || hasIndex) {
      if (item.role !== "character" || !hasVersion ||
          (item.character_version_id !== null && (typeof item.character_version_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(item.character_version_id))) ||
          (item.character_version_id === null && hasIndex) ||
          (typeof item.character_version_id === "string" && (!hasIndex || !Number.isInteger(item.image_index) || (item.image_index as number) < 0 || (item.image_index as number) > 5)))
        invalidVideo(`Invalid ${name} character binding`);
    }
    if (ids.has(item.asset_id as string)) invalidVideo(`${name} must have distinct asset IDs`);
    ids.add(item.asset_id as string);
  }
  return value as Array<Record<string, unknown>>;
}
function hasCharacterBinding(args: Record<string, unknown>) {
  const bound = (refs: unknown) => Array.isArray(refs) && refs.some(raw => raw && typeof raw === "object" && !Array.isArray(raw) &&
    (Object.prototype.hasOwnProperty.call(raw, "character_version_id") || Object.prototype.hasOwnProperty.call(raw, "image_index")));
  return bound(args.reference_assets) || (Array.isArray(args.segment_plan) && args.segment_plan.some(raw => raw && typeof raw === "object" && !Array.isArray(raw) && bound((raw as Record<string, unknown>).reference_assets)));
}
function validateSixVideoArgs(args: Record<string, unknown>) {
  stringArg(args, "source_asset_id");
  validateSixReferenceArray(args.reference_assets, "reference_assets");
  if (!Array.isArray(args.segment_plan) || args.segment_plan.length < 1 || args.segment_plan.length > 8) invalidVideo("segment_plan must contain 1–8 semantic windows");
  let end = 0;
  for (const [index, raw] of args.segment_plan.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalidVideo(`Invalid segment_plan[${index}]`);
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !["start", "source_duration", "duration", "instructions", "before_state", "after_state", "reference_assets", "start_from_segment"].includes(key)) ||
        typeof item.start !== "number" || !Number.isFinite(item.start) || item.start < 0 ||
        typeof item.source_duration !== "number" || !Number.isFinite(item.source_duration) || item.source_duration <= 0 ||
        ![4, 5, 6, 8].includes(item.duration as number) ||
        ["instructions", "before_state", "after_state"].some(key => typeof item[key] !== "string" || !(item[key] as string).trim())) invalidVideo(`Invalid segment_plan[${index}]`);
    for (const [key, max] of [["instructions", 1600], ["before_state", 400], ["after_state", 400]] as const) {
      if ((item[key] as string).length > max || /[\u0000-\u001f\u007f]/.test(item[key] as string)) invalidVideo(`Invalid segment_plan[${index}].${key}`);
    }
    if (Math.abs(item.start - end) > 0.001) invalidVideo("segment_plan must be contiguous and begin at zero");
    end = item.start + item.source_duration;
    if (Math.max(item.source_duration / (item.duration as number), (item.duration as number) / item.source_duration) > 1.15 + 1e-9) invalidVideo(`segment_plan[${index}] exceeds 15% retime`);
    const refs = item.reference_assets === undefined ? args.reference_assets as Array<Record<string, unknown>> : validateSixReferenceArray(item.reference_assets, `segment_plan[${index}].reference_assets`);
    if (item.start_from_segment !== undefined &&
        (!Number.isInteger(item.start_from_segment) || (item.start_from_segment as number) < 0 || (item.start_from_segment as number) >= index || refs.filter(ref => ref.role === "start_state").length !== 1)) invalidVideo(`segment_plan[${index}] must replace exactly one start_state from an earlier segment`);
  }
  if (end > 30.12) invalidVideo("segment_plan exceeds the 30-second source limit");
}
function validateCandidateArgs(args: Record<string, unknown>, review: boolean) {
  stringArg(args, "job_id");
  if (typeof args.candidate_review_token !== "string" || !/^[a-f0-9]{64}$/i.test(args.candidate_review_token)) invalidVideo("Invalid candidate_review_token");
  if (!review) return;
  if (!Array.isArray(args.decisions) || !args.decisions.length) invalidVideo("decisions must be a nonempty array");
  const seen = new Set<number>();
  for (const raw of args.decisions as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalidVideo("Invalid candidate decision");
    const item = raw as Record<string, unknown>;
    if (!Number.isInteger(item.segment_index) || (item.segment_index as number) < 0 ||
        typeof item.candidate_sha256 !== "string" || (!/^[a-f0-9]{64}$/i.test(item.candidate_sha256) && !(item.candidate_sha256 === "failed" && item.action === "retry")) ||
        !["accept", "retry"].includes(String(item.action)) ||
        (item.action === "retry" && (typeof item.reason !== "string" || !(item.reason as string).trim() || (item.reason as string).length > 500 || item.trim_start !== undefined)) ||
        (item.trim_start !== undefined && (item.action !== "accept" || typeof item.trim_start !== "number" || !Number.isFinite(item.trim_start) || item.trim_start < 0)) ||
        (item.reason !== undefined && typeof item.reason !== "string") ||
        Object.keys(item).some(key => !["segment_index", "candidate_sha256", "action", "reason", "trim_start"].includes(key))) invalidVideo("Invalid candidate decision");
    if (seen.has(item.segment_index as number)) invalidVideo("Duplicate segment decision");
    seen.add(item.segment_index as number);
  }
}
/**
 * 从工具入参里取出可归因的 id，让日志能直接对上某个 job / asset。
 * 不同工具的参数名不一样（create_video_job 用 source_asset_id / product_asset_id），
 * 这里统一收敛成一个 assetId，避免日志里出现三种含义不同的列。
 */
function tracingIds(args: Record<string, unknown>) {
  const pick = (key: string) => { const value = args[key]; return typeof value === "string" && value.trim() ? value : null; };
  return { jobId: pick("job_id"), assetId: pick("asset_id") ?? pick("source_asset_id") ?? pick("product_asset_id") };
}

export async function invokeMcpTool(name: string, args: Record<string, unknown>, request: Request, routeOverrides: VideoTemplateRouteOverrides = {}) {
  const templateRoutes = { ...videoTemplateRoutes, ...routeOverrides };
  if (name === "health") return routeResult(await healthGet());
  if (name === "capabilities") return routeResult(await capabilitiesGet());
  if (name === "get_account_usage") return routeResult(await accountUsageGet(internalRequest(request, "/account/usage")));
  if (name === "list_video_jobs") {
    const status = args.status === undefined ? undefined : stringArg(args, "status");
    if (status !== undefined && !["all", "draft", "active", "history"].includes(status)) invalidVideo("Invalid parameter: status");
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50)) invalidVideo("Invalid parameter: limit");
    const cursor = args.cursor === undefined ? undefined : stringArg(args, "cursor");
    const query = new URLSearchParams();
    if (status !== undefined) query.set("status", status);
    if (limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    const suffix = query.size ? `?${query.toString()}` : "";
    return routeResult(await listVideoJobsGet(internalRequest(request, `/video-jobs${suffix}`)));
  }
  if (name === "cancel_video_job") { const id = stringArg(args, "job_id"); return routeResult(await cancelVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }), { params: { id } })); }
  if (name === "close_video_job") {
    exactKeys(args, ["job_id", "expected_revision"]);
    const id = stringArg(args, "job_id");
    if (!Number.isSafeInteger(args.expected_revision) || (args.expected_revision as number) < 0) invalidVideo("Invalid parameter: expected_revision");
    return routeResult(await closeVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: args.expected_revision }) }), { params: { id } }));
  }
  if (name === "get_video_delivery") {
    const { job_id: id } = videoTemplateArgs(name, args) as { job_id: string };
    return routeResult(await templateRoutes.delivery(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/delivery`), { params: { id } }));
  }
  if (name === "submit_video_feedback") {
    const { job_id: id, ...body } = videoTemplateArgs(name, args) as { job_id: string; [key: string]: unknown };
    return routeResult(await templateRoutes.feedback(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: { id } }));
  }
  if (name === "list_video_templates") {
    return routeResult(await templateRoutes.list(internalRequest(request, videoTemplateListPath(args))));
  }
  if (name === "get_video_template") {
    const { template_id: id, version_id } = videoTemplateArgs(name, args) as { template_id: string; version_id?: string };
    const suffix = version_id ? `?${new URLSearchParams({ version_id })}` : "";
    return routeResult(await templateRoutes.detail(internalRequest(request, `/video-templates/${encodeURIComponent(id)}${suffix}`), { params: { id } }));
  }
  if (name === "update_video_template") {
    const { template_id: id, ...body } = videoTemplateArgs(name, args) as { template_id: string; [key: string]: unknown };
    return routeResult(await templateRoutes.update(internalRequest(request, `/video-templates/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: { id } }));
  }
  if (["list_characters", "get_character", "save_character", "save_character_version", "update_character", "list_character_assets"].includes(name)) {
    const call = characterRequest(name, args);
    const id = typeof args.character_id === "string" ? args.character_id : "";
    const route = internalRequest(request, call.path, call.method ? { method: call.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(call.body) } : {});
    if (name === "list_characters") return routeResult(await templateRoutes.listCharacters(route));
    if (name === "get_character") return routeResult(await templateRoutes.getCharacter(route, { params: { id } }));
    if (name === "save_character") return routeResult(await templateRoutes.saveCharacter(route));
    if (name === "save_character_version") return routeResult(await templateRoutes.saveCharacterVersion(route, { params: { id } }));
    if (name === "update_character") return routeResult(await templateRoutes.updateCharacter(route, { params: { id } }));
    return routeResult(await templateRoutes.listCharacterAssets(route));
  }
  if (name === "upload_asset") {
    const kind = args.kind === "video" ? "video" : "image";
    const source = await downloadMcpSource(stringArg(args, "source_url"), kind);
    const form = new FormData(); form.set("file", new Blob([source.bytes], { type: source.mime }), source.filename);
    const route = internalRequest(request, kind === "video" ? "/video-assets" : "/assets", { method: "POST", body: form });
    return routeResult(await (kind === "video" ? videoAssetsPost(route) : assetsPost(route)));
  }
  if (name === "create_image_job") { const payload = imageArgs(args); return routeResult(await templateRoutes.imageJobs(internalRequest(request, "/image-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }))); }
  if (name === "create_video_job") { if (args.template_version_id !== undefined) identifierArg(args, "template_version_id"); if (args.generation_mode === "six_references") validateSixVideoArgs(args); else if (hasCharacterBinding(args)) invalidVideo("Character bindings require six_references mode"); return routeResult(await templateRoutes.videoJobs(internalRequest(request, "/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) }))); }
  if (name === "prepare_video_job") { const id = stringArg(args, "job_id"); return routeResult(await prepareVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/prepare`, { method: "POST" }), { params: { id } })); }
  if (name === "render_video_job") { const id = stringArg(args, "job_id"); return routeResult(await renderVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: args.max_coins, review_token: args.review_token }) }), { params: { id } })); }
  if (name === "review_video_segments") { validateCandidateArgs(args, true); const id = stringArg(args, "job_id"); return routeResult(await reviewVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_review_token: args.candidate_review_token, decisions: args.decisions }) }), { params: { id } })); }
  if (name === "assemble_video_job") { validateCandidateArgs(args, false); const id = stringArg(args, "job_id"); return routeResult(await assembleVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/assemble`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_review_token: args.candidate_review_token }) }), { params: { id } })); }
  if (name === "reconcile_video_job") { const id = stringArg(args, "job_id"); return routeResult(await reconcileVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), { params: { id } })); }
  if (name === "get_job") { const id = stringArg(args, "job_id"); return routeResult(await jobsGet(internalRequest(request, `/jobs/${encodeURIComponent(id)}`), { params: { id } })); }
  if (name === "download_output") { const id = stringArg(args, "job_id"); const job = await routeResult(await jobsGet(internalRequest(request, `/jobs/${encodeURIComponent(id)}`), { params: { id } })) as Record<string, unknown>; const outputs = Array.isArray(job.outputs) ? job.outputs.map((output) => output && typeof output === "object" && "url" in output ? (output as { url?: unknown }).url : null).filter((url): url is string => typeof url === "string") : []; return { job_id: id, output_urls: outputs.length ? outputs : (typeof job.output_url === "string" ? [job.output_url] : []) }; }
  const error = new Error(`Unknown tool: ${name}`) as Error & { code?: number }; error.code = -32602; throw error;
}

type McpRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const validId = (id: unknown) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id) && Number.isInteger(id));
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: validId(id) ? id : null, error: { code, message } });

export function dispatchMcp(item: McpRpc, request: Request, dependencies: { invokeTool?: typeof invokeMcpTool; logCall?: typeof logMcpCall } = {}) {
  const invokeTool = dependencies.invokeTool ?? invokeMcpTool;
  const logCall = dependencies.logCall ?? logMcpCall;
  if (item.jsonrpc !== "2.0" || typeof item.method !== "string" || (Object.prototype.hasOwnProperty.call(item, "id") && !validId(item.id))) return Promise.resolve(rpcError(item.id, -32600, "Invalid Request"));
  const id = item.id;
  if (item.method === "notifications/initialized" || item.method === "notifications/cancelled") return Promise.resolve(null);
  if (!Object.prototype.hasOwnProperty.call(item, "id")) return Promise.resolve(rpcError(null, -32600, "Requests must include id"));
  if (item.method === "ping") return Promise.resolve({ jsonrpc: "2.0", id, result: {} });
  if (item.method === "initialize") {
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    const protocolVersion = ["2025-03-26", "2024-11-05"].includes(requested) ? requested : "2025-03-26";
    // 这一条是"客户端确实到达了服务端"的唯一服务端证据 —— 排障时最先要看的就是它。
    logCall({ tool: "initialize", status: "ok" });
    return Promise.resolve({ jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "lampstage-mcp", version: "1.0.0" } } });
  }
  if (item.method === "tools/list") {
    logCall({ tool: "tools_list", status: "ok" });
    return Promise.resolve({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
  }
  if (item.method !== "tools/call") return Promise.resolve(rpcError(id, -32601, `Method not found: ${item.method}`));
  const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
  if (typeof params.name !== "string") return Promise.resolve(rpcError(id, -32602, "tools/call requires a tool name"));
  if (!MCP_TOOLS.some((tool) => tool.name === params.name)) return Promise.resolve(rpcError(id, -32602, `Unknown tool: ${params.name}`));
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return Promise.resolve(rpcError(id, -32602, "tools/call arguments must be an object"));
  const toolName = params.name as string;
  const toolArgs = args as Record<string, unknown>;
  const ids = tracingIds(toolArgs);
  const startedAt = Date.now();
  return invokeTool(toolName, toolArgs, request).then((value) => {
    logCall({ tool: toolName, status: "ok", durationMs: Date.now() - startedAt, ...ids });
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } };
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // routeResult 会把上游路由的 HTTP 状态挂在 error.status 上，有就记下来（否则留 null，不猜）。
    const failedStatus = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
    logCall({ tool: toolName, status: "failed", durationMs: Date.now() - startedAt, httpStatus: failedStatus, error: failedStatus === null ? "internal_error" : "request_failed", ...ids });
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === -32602) return rpcError(id, -32602, message);
    const safeContent = error && typeof error === "object" && "safeContent" in error ? (error as { safeContent?: Record<string, unknown> }).safeContent : undefined;
    const publicMessage = error && typeof error === "object" && "publicMessage" in error && typeof (error as { publicMessage?: unknown }).publicMessage === "string" ? (error as { publicMessage: string }).publicMessage : "Tool request failed";
    return { jsonrpc: "2.0", id, result: safeContent ? { isError: true, content: [{ type: "text", text: JSON.stringify(safeContent) }], structuredContent: safeContent } : { isError: true, content: [{ type: "text", text: publicMessage }] } };
  });
}
