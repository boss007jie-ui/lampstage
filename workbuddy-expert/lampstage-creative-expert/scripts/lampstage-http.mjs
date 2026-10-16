#!/usr/bin/env node
// Small dependency-free MCP bridge. The Expert calls this process; this process
// attaches the user's secret to Lampstage API requests. Provider secrets never
// enter the Expert package.
import readline from "node:readline";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { PublicApiError, publicApiError, safeErrorText, unknownApiOutcome } from "./lifecycle-errors.mjs";

const base = (process.env.LAMPSTAGE_API_BASE_URL || "https://lampstage.com/api/v1").replace(/\/$/, "");
const key = process.env.LAMPSTAGE_API_KEY || "";

const tools = [
  { name: "get_account_usage", description: "Read your account's independent draft and active video capacity. Limits are simultaneous counts, not daily production limits; this request does not create or cancel a job.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_video_jobs", description: "List only your video jobs with account-wide usage, pagination, and server-provided cancellation eligibility. Use after a quota denial or uncertain create response; never automatically create a replacement or cancel the oldest job.", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["all", "draft", "active", "history"] }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string" } }, additionalProperties: false } },
  { name: "cancel_video_job", description: "Cancel only a draft selected by the user or explicitly authorized as disposable. The server checks safety; a conflict must not trigger force, a different cancellation, or a new task. No media is deleted and cancelling a draft does not release active capacity.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false } },
  { name: "close_video_job", description: "Close only a user-selected stopped review or attention job after explicit abandonment and a current can_close=true summary. Supply its revision. Never automatically close jobs to bypass active quota; closure retains media and audit records.", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1 }, expected_revision: { type: "integer", minimum: 0 } }, required: ["job_id", "expected_revision"], additionalProperties: false } },
  { name: "list_characters", description: "List account-owned character profiles by status and code/name search", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "archived", "all"] }, q: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512 } }, additionalProperties: false } },
  { name: "get_character", description: "Read an owned character and its fixed image-reference versions", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, version_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["character_id"], additionalProperties: false } },
  { name: "save_character", description: "Explicitly save 1–6 existing owned image assets as an independent character profile; reuse a stable idempotency key for retries", inputSchema: { type: "object", properties: { idempotency_key: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, description: { type: "string", maxLength: 2000 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, label: { type: "string", minLength: 1, maxLength: 80 } }, required: ["asset_id", "label"], additionalProperties: false } } }, required: ["idempotency_key", "name", "reference_assets"], additionalProperties: false } },
  { name: "save_character_version", description: "Explicitly add a new immutable version to an owned character using the version currently being edited", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, expected_latest_version_id: { type: "string", minLength: 1, maxLength: 128 }, description: { type: "string", maxLength: 2000 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, label: { type: "string", minLength: 1, maxLength: 80 } }, required: ["asset_id", "label"], additionalProperties: false } } }, required: ["character_id", "expected_latest_version_id", "reference_assets"], additionalProperties: false } },
  { name: "update_character", description: "Rename, categorize, archive or restore an owned character profile", inputSchema: { type: "object", properties: { character_id: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, archived: { type: "boolean" } }, required: ["character_id"], additionalProperties: false } },
  { name: "list_character_assets", description: "List account-owned original image assets available for explicit character selection", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512 } }, additionalProperties: false } },
  { name: "get_video_delivery", description: "Read full output and accepted segment delivery for a video job", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["job_id"], additionalProperties: false } },
  { name: "submit_video_feedback", description: "Submit explicit feedback bound to the exact completed output hash. Only satisfied_save_template saves a private template.", inputSchema: { type: "object", properties: { job_id: { type: "string", minLength: 1, maxLength: 128 }, decision: { type: "string", enum: ["satisfied_save_template", "satisfied", "needs_changes"] }, output_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, notes: { type: "string", maxLength: 2000 }, name: { type: "string", maxLength: 80 }, category: { type: "string", maxLength: 40 }, template_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["job_id", "decision", "output_sha256"], additionalProperties: false } },
  { name: "list_video_templates", description: "List private video templates with optional source match and cursor pagination", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "archived", "all"] }, source_asset_id: { type: "string", minLength: 1, maxLength: 128 }, source_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, limit: { type: "integer", minimum: 1, maximum: 50 }, cursor: { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" } }, additionalProperties: false } },
  { name: "get_video_template", description: "Read a private template and selected immutable recipe version", inputSchema: { type: "object", properties: { template_id: { type: "string", minLength: 1, maxLength: 128 }, version_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["template_id"], additionalProperties: false } },
  { name: "update_video_template", description: "Rename, categorize, archive or restore a private template", inputSchema: { type: "object", properties: { template_id: { type: "string", minLength: 1, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 80 }, category: { type: "string", maxLength: 40 }, archived: { type: "boolean" } }, required: ["template_id"], additionalProperties: false } },
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload an image or video asset", inputSchema: { type: "object", properties: { source_url: { type: "string" }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "upload_local_asset", description: "Stdio bridge only: upload the exact user-supplied absolute local image/video file path. The remote MCP endpoint cannot read client files.", inputSchema: { type: "object", properties: { file_path: { type: "string", minLength: 1 }, kind: { type: "string", enum: ["image", "video"] } }, required: ["file_path", "kind"], additionalProperties: false } },
  { name: "create_image_job", description: "Create an image job with one asset or 1–6 ordered reference images. image_count is the requested number of outputs, not the number of reference inputs. Each character binding requires both character_version_id and image_index.", inputSchema: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1, maxLength: 128 }, role: { type: "string", enum: ["character", "product", "product_detail", "scene", "start_state", "end_state"] }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: "string", minLength: 1, maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, custom_prompt: { type: "string", minLength: 1, maxLength: 12000 }, image_count: { type: "integer", minimum: 1, maximum: 4 }, image_model: { type: "string", enum: ["nano_banana_21", "image_25"], default: "nano_banana_21" }, platform_style: { type: "string", enum: ["domestic_ecommerce", "brand_site"] }, aspect_ratio: { type: "string", enum: ["1_1"] } }, required: ["custom_prompt", "image_count"], oneOf: [{ required: ["asset_id"] }, { required: ["reference_assets"] }], additionalProperties: false } },
  { name: "create_video_job", description: "Create a video job. six_references requires 1–6 ordered images and a reviewed semantic segment_plan; product_asset_id is optional and does not force an image slot.", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, template_version_id: { type: "string", minLength: 1, maxLength: 128 }, product_asset_id: { type: "string" }, title: { type: "string", maxLength: 80 }, instructions: { type: "string", maxLength: 2000 }, preserve_audio: { type: "boolean" }, generation_mode: { type: "string", enum: ["direct_references", "six_references", "legacy_frames"] }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string" }, role: { type: "string", enum: ["product", "character", "scene", "product_detail", "start_state", "end_state"] }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: ["string", "null"], maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, segment_plan: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", properties: { start: { type: "number", minimum: 0 }, source_duration: { type: "number", exclusiveMinimum: 0 }, duration: { type: "integer", enum: [4, 5, 6, 8] }, instructions: { type: "string", minLength: 1, maxLength: 1600 }, before_state: { type: "string", minLength: 1, maxLength: 400 }, after_state: { type: "string", minLength: 1, maxLength: 400 }, reference_assets: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", properties: { asset_id: { type: "string" }, role: { type: "string", enum: ["product", "character", "scene", "product_detail", "start_state", "end_state"] }, label: { type: "string", minLength: 1, maxLength: 80 }, character_version_id: { type: ["string", "null"], maxLength: 128 }, image_index: { type: "integer", minimum: 0, maximum: 5 } }, required: ["asset_id", "role", "label"], additionalProperties: false } }, start_from_segment: { type: "integer", minimum: 0 } }, required: ["start", "source_duration", "duration", "instructions", "before_state", "after_state"], additionalProperties: false } } }, required: ["source_asset_id"] } },
  { name: "prepare_video_job", description: "Prepare a video job. direct_references freezes the three ordered image references and slices the source video without generating opening/ending frames; legacy jobs may generate paid frames.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "render_video_job", description: "After reviewing all references, source windows and coin quote with explicit budget consent, render through RunningHub Minimax H3. review_token must be the exact value returned by get_job for the review you showed the user; if the reference, windows, segment set or price changed since then, the server refuses with 409 review_changed and the review must be shown again.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, max_coins: { type: "number" }, review_token: { type: "string", minLength: 64, maxLength: 64 } }, required: ["job_id", "max_coins", "review_token"] } },
  { name: "review_video_segments", description: "Accept or retry exact candidates after playing their videos; use candidate_sha256='failed' only for a terminal failed segment retry with a reason. Accept may specify a reviewed leading trim_start.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, candidate_review_token: { type: "string", minLength: 64, maxLength: 64 }, decisions: { type: "array", minItems: 1, items: { type: "object", properties: { segment_index: { type: "integer", minimum: 0 }, candidate_sha256: { type: "string", minLength: 6, maxLength: 64 }, action: { type: "string", enum: ["accept", "retry"] }, reason: { type: "string" }, trim_start: { type: "number", minimum: 0 } }, required: ["segment_index", "candidate_sha256", "action"], additionalProperties: false } } }, required: ["job_id", "candidate_review_token", "decisions"] } },
  { name: "assemble_video_job", description: "Assemble only after every segment candidate is accepted; use the current candidate_review_token.", inputSchema: { type: "object", properties: { job_id: { type: "string" }, candidate_review_token: { type: "string", minLength: 64, maxLength: 64 } }, required: ["job_id", "candidate_review_token"] } },
  { name: "reconcile_video_job", description: "Recover existing unknown RunningHub submissions for an attention job; sends no new generation request.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "get_job", description: "Read an image or video job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "download_output", description: "Resolve the latest output URL for a job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
];

async function callApi(path, init = {}) {
  if (!key && path !== "/health" && path !== "/capabilities") throw new Error("LAMPSTAGE_API_KEY is not configured");
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  if (key) headers.set("Authorization", `Bearer ${key}`);
  let response, text;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers });
    text = await response.text();
  } catch { throw unknownApiOutcome(); }
  let data;
  try { data = JSON.parse(text); }
  catch { if (!response.ok) throw publicApiError(response.status, null, key); throw unknownApiOutcome(); }
  if (!response.ok) throw publicApiError(response.status, data, key);
  return data;
}

function imageRequest(args) {
  const invalid = field => { throw new Error(`Invalid image parameter: ${field}`); };
  if (!args || typeof args !== "object" || Array.isArray(args)) invalid("arguments");
  const present = (value, field) => Object.prototype.hasOwnProperty.call(value, field);
  const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const multiple = present(args, "reference_assets");
  if (multiple && (present(args, "asset_id") || present(args, "uploaded_asset_id"))) invalid("ambiguous_image_references");
  const allowed = ["asset_id", "reference_assets", "custom_prompt", "image_count", "image_model", "platform_style", "aspect_ratio"];
  if (Object.keys(args).some(field => !allowed.includes(field))) invalid("unknown field");
  // Both tool paths require an explicit count; never inherit REST's paid default.
  if (typeof args.custom_prompt !== "string" || !args.custom_prompt.trim() || args.custom_prompt.trim().length > 12000) invalid("custom_prompt");
  if (!Number.isInteger(args.image_count) || args.image_count < 1 || args.image_count > 4) invalid("image_count");
  if (args.image_model !== undefined && !["nano_banana_21", "image_25"].includes(args.image_model)) invalid("image_model");
  if (args.aspect_ratio !== undefined && args.aspect_ratio !== "1_1") invalid("aspect_ratio");
  if (args.platform_style !== undefined && !["domestic_ecommerce", "brand_site"].includes(args.platform_style)) invalid("platform_style");
  if (!multiple) {
    if (!id(args.asset_id)) invalid("asset_id");
    return { ...args, uploaded_asset_id: args.asset_id };
  }
  if (!Array.isArray(args.reference_assets) || args.reference_assets.length < 1 || args.reference_assets.length > 6) invalid("reference_assets");
  const roles = ["character", "product", "product_detail", "scene", "start_state", "end_state"];
  const ids = new Set();
  const reference_assets = args.reference_assets.map(ref => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref) ||
        Object.keys(ref).some(field => !["asset_id", "role", "label", "character_version_id", "image_index"].includes(field)) ||
        !id(ref.asset_id) || !roles.includes(ref.role) || typeof ref.label !== "string" || !ref.label.trim() ||
        ref.label.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(ref.label)) invalid("reference_assets");
    if (ids.has(ref.asset_id)) invalid("duplicate_reference_asset");
    ids.add(ref.asset_id);
    const version = present(ref, "character_version_id"), index = present(ref, "image_index");
    if (version !== index || (version && (ref.role !== "character" || !id(ref.character_version_id) ||
        !Number.isInteger(ref.image_index) || ref.image_index < 0 || ref.image_index > 5))) invalid("invalid_character_binding");
    return { ...ref, label: ref.label.trim() };
  });
  return { ...args, reference_assets };
}

async function uploadAsset(args) {
  const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
  const MAX_REDIRECTS = 3;
  const MAX_SOURCE_URL_LENGTH = 2048;
  const isPrivate = (address) => {
    const value = address.toLowerCase().split("%")[0];
    if (value.startsWith("::ffff:")) return isPrivate(value.slice(7));
    if (net.isIPv4(value)) {
      const octets = value.split(".").map(Number);
      return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168);
    }
    if (net.isIPv6(value)) {
      return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
        /^fe[89ab]/.test(value);
    }
    return true;
  };
  const checkedUrl = async (value) => {
    if (typeof value !== "string" || value.length > MAX_SOURCE_URL_LENGTH) throw new Error("source_url is too long");
    let url;
    try { url = new URL(value); } catch { throw new Error("source_url must be a valid http(s) URL"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("source_url must be a public http(s) URL");
    const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length || records.some(({ address }) => isPrivate(address))) throw new Error("source_url must resolve to a public address");
    return url;
  };
  let url = await checkedUrl(args.source_url);
  let source;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    source = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (![301, 302, 303, 307, 308].includes(source.status)) break;
    const location = source.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw new Error("source_url redirected too many times");
    url = await checkedUrl(new URL(location, url).toString());
  }
  if (!source.ok) throw new Error(`Unable to read source_url (${source.status})`);
  const declaredLength = Number(source.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) throw new Error("source_url file is too large");
  if (!source.body) throw new Error("source_url returned no file body");
  const reader = source.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("source_url file is too large"); }
    chunks.push(Buffer.from(next.value));
  }
  const mime = source.headers.get("content-type") || (args.kind === "video" ? "video/mp4" : "image/jpeg");
  const form = new FormData();
  form.set("file", new Blob([Buffer.concat(chunks)], { type: mime }), `asset.${mime.includes("video") ? "mp4" : "jpg"}`);
  const path = args.kind === "video" ? "/video-assets" : "/assets";
  return callApi(path, { method: "POST", body: form });
}

async function uploadLocalAsset(args) {
  if (!args || typeof args.file_path !== "string" || !path.isAbsolute(args.file_path) ||
      path.normalize(args.file_path) !== args.file_path || !["image", "video"].includes(args.kind) ||
      Object.keys(args).some(key => !["file_path", "kind"].includes(key))) throw new Error("file_path must be an exact absolute path and kind must be image or video");
  const extension = path.extname(args.file_path).toLowerCase();
  const imageTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const videoTypes = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
  const types = args.kind === "image" ? imageTypes : videoTypes;
  const mime = types[extension];
  if (!mime) throw new Error("Unsupported local file format for kind");
  const max = args.kind === "image" ? 5 * 1024 * 1024 : 150 * 1024 * 1024;
  const stat = await lstat(args.file_path);
  if (!stat.isFile()) throw new Error("file_path must name a regular file");
  if (stat.size < 12 || stat.size > max) throw new Error("Local file size is outside the allowed range");
  const bytes = await readFile(args.file_path, { signal: AbortSignal.timeout(60_000) });
  if (bytes.byteLength < 12 || bytes.byteLength > max) throw new Error("Local file size changed or is outside the allowed range");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isoVideo = bytes.toString("ascii", 4, 8) === "ftyp";
  const webm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const magic = mime === "image/jpeg" ? jpeg : mime === "image/png" ? png : mime === "image/webp" ? webp :
    mime === "video/mp4" ? isoVideo && bytes.toString("ascii", 8, 12) !== "qt  " :
    mime === "video/quicktime" ? isoVideo && bytes.toString("ascii", 8, 12) === "qt  " : webm;
  if (!magic) throw new Error("Local file header does not match its declared format");
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mime }), path.basename(args.file_path));
  return callApi(args.kind === "video" ? "/video-assets" : "/assets", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
}

async function assertVideoModeAvailable(mode, requireCharacters = false) {
  const catalog = await callApi("/capabilities");
  const replicate = catalog?.capabilities?.find?.((entry) => entry.id === "video.replicate");
  if (replicate?.status !== "available" || !replicate?.modes?.[mode]) {
    throw new Error(`This Lampstage server does not currently support ${mode}. Check video.replicate modes.${mode} before preparing this job.`);
  }
  if (requireCharacters && catalog?.capabilities?.find?.((entry) => entry.id === "characters.library")?.status !== "available") {
    throw new Error("This Lampstage server does not currently support character bindings. Check characters.library before creating this job; do not remove the selected bindings.");
  }
}

function validateDirectReferences(args) {
  if (!Array.isArray(args.reference_assets) || args.reference_assets.length !== 2) throw new Error("direct_references requires exactly two ordered reference_assets");
  const ids = new Set([args.product_asset_id]);
  for (const ref of args.reference_assets) {
    if (!ref || typeof ref.asset_id !== "string" || !ref.asset_id.trim() || !["character", "scene", "product_detail"].includes(ref.role) ||
        typeof ref.label !== "string" || !ref.label.trim() || ref.label.length > 80 ||
        Object.keys(ref).some((field) => !["asset_id", "role", "label"].includes(field))) {
      throw new Error("Each reference needs an asset_id, a supported role and a nonempty label of at most 80 characters");
    }
    if (ids.has(ref.asset_id)) throw new Error("Reference assets and the product asset must be distinct");
    ids.add(ref.asset_id);
  }
}

const SIX_ROLES = new Set(["product", "character", "scene", "product_detail", "start_state", "end_state"]);
function hasCharacterReferenceFields(args) {
  const lists = [args.reference_assets, ...(Array.isArray(args.segment_plan) ? args.segment_plan.map(segment => segment?.reference_assets) : [])];
  return lists.some(refs => Array.isArray(refs) && refs.some(ref => ref && typeof ref === "object" &&
    (Object.hasOwn(ref, "character_version_id") || Object.hasOwn(ref, "image_index"))));
}
function validateCharacterReference(ref) {
  const hasVersion = Object.hasOwn(ref, "character_version_id"), hasIndex = Object.hasOwn(ref, "image_index");
  if (!hasVersion && hasIndex) throw new Error("image_index requires character_version_id");
  if (!hasVersion) return;
  if (ref.role !== "character") throw new Error("Character bindings require role character");
  if (ref.character_version_id === null) {
    if (hasIndex) throw new Error("A temporary character reference must not include image_index");
    return;
  }
  if (typeof ref.character_version_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.character_version_id) ||
      !hasIndex || !Number.isInteger(ref.image_index) || ref.image_index < 0 || ref.image_index > 5) {
    throw new Error("A fixed character reference requires a valid version ID and image_index from 0 through 5");
  }
}
function validateSixText(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be nonempty, at most ${max} characters, and contain no control characters or line breaks`);
  }
}
function validateSixReferences(refs, name) {
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 6) throw new Error(`${name} must contain 1–6 ordered references`);
  const ids = new Set();
  for (const ref of refs) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.asset_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.asset_id) ||
        !SIX_ROLES.has(ref.role) ||
        Object.keys(ref).some(field => !["asset_id", "role", "label", "character_version_id", "image_index"].includes(field))) throw new Error(`Invalid ${name} entry`);
    validateSixText(ref.label, `${name}[${ids.size}].label`, 80);
    validateCharacterReference(ref);
    if (ids.has(ref.asset_id)) throw new Error(`${name} must not repeat an asset_id`);
    ids.add(ref.asset_id);
  }
}

function validateSixJob(args) {
  if (typeof args.source_asset_id !== "string" || !args.source_asset_id.trim()) throw new Error("source_asset_id is required");
  if (args.product_asset_id !== undefined && (typeof args.product_asset_id !== "string" || !args.product_asset_id.trim())) throw new Error("Invalid product_asset_id");
  if (args.preserve_audio !== undefined && typeof args.preserve_audio !== "boolean") throw new Error("preserve_audio must be a boolean");
  for (const [field, max] of [["title", 80], ["instructions", 2000]]) {
    if (args[field] !== undefined && (typeof args[field] !== "string" || args[field].length > max)) {
      throw new Error(`${field} must be a string of at most ${max} characters; shorten and review it before submission`);
    }
  }
  validateSixReferences(args.reference_assets, "reference_assets");
  if (!Array.isArray(args.segment_plan) || args.segment_plan.length < 1 || args.segment_plan.length > 8) throw new Error("segment_plan must contain 1–8 semantic windows");
  let expectedStart = 0;
  args.segment_plan.forEach((segment, index) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment) ||
        Object.keys(segment).some(field => !["start", "source_duration", "duration", "instructions", "before_state", "after_state", "reference_assets", "start_from_segment"].includes(field)) ||
        !Number.isFinite(segment.start) || segment.start < 0 || !Number.isFinite(segment.source_duration) || segment.source_duration <= 0 ||
        ![4, 5, 6, 8].includes(segment.duration)) throw new Error(`Invalid segment_plan[${index}]`);
    for (const [field, max] of [["instructions", 1600], ["before_state", 400], ["after_state", 400]]) {
      validateSixText(segment[field], `segment_plan[${index}].${field}`, max);
    }
    if (Math.abs(segment.start - expectedStart) > 0.001) throw new Error("segment_plan windows must be contiguous, start at zero and stay in source order");
    expectedStart = segment.start + segment.source_duration;
    if (Math.max(segment.source_duration / segment.duration, segment.duration / segment.source_duration) > 1.15 + 1e-9) throw new Error(`segment_plan[${index}] retime exceeds 15%`);
    const refs = segment.reference_assets ?? args.reference_assets;
    if (segment.reference_assets !== undefined) validateSixReferences(refs, `segment_plan[${index}].reference_assets`);
    if (refs[0].role !== "start_state" || refs.filter(ref => ref.role === "start_state").length !== 1) {
      throw new Error(`segment_plan[${index}] requires exactly one start_state reference in the first slot`);
    }
    if (segment.start_from_segment !== undefined) {
      if (!Number.isInteger(segment.start_from_segment) || segment.start_from_segment < 0 || segment.start_from_segment >= index) throw new Error(`segment_plan[${index}].start_from_segment must be earlier`);
    }
  });
  if (expectedStart > 30.12) throw new Error("segment_plan exceeds the 30-second source limit");
}

function validateCandidateToken(args) {
  if (typeof args.job_id !== "string" || !args.job_id.trim() || !/^[a-f0-9]{64}$/i.test(args.candidate_review_token)) throw new Error("A job_id and 64-character candidate_review_token are required");
}
function validateCandidateDecisions(args) {
  validateCandidateToken(args);
  if (!Array.isArray(args.decisions) || !args.decisions.length) throw new Error("decisions must be a nonempty array");
  const indices = new Set();
  for (const item of args.decisions) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !Number.isInteger(item.segment_index) || item.segment_index < 0 ||
        (!/^[a-f0-9]{64}$/i.test(item.candidate_sha256) && !(item.candidate_sha256 === "failed" && item.action === "retry")) || !["accept", "retry"].includes(item.action) ||
        (item.action === "retry" && (typeof item.reason !== "string" || !item.reason.trim() || item.reason.length > 500 || item.trim_start !== undefined)) ||
        (item.trim_start !== undefined && (item.action !== "accept" || typeof item.trim_start !== "number" || !Number.isFinite(item.trim_start) || item.trim_start < 0)) ||
        (item.reason !== undefined && typeof item.reason !== "string") ||
        Object.keys(item).some(key => !["segment_index", "candidate_sha256", "action", "reason", "trim_start"].includes(key))) throw new Error("Invalid candidate decision");
    if (indices.has(item.segment_index)) throw new Error("Each segment may have only one decision");
    indices.add(item.segment_index);
  }
}

function validateLifecycleArgs(name, args) {
  const fields = name === "list_video_jobs" ? ["status", "limit", "cursor"] : name === "cancel_video_job" ? ["job_id"] : name === "close_video_job" ? ["job_id", "expected_revision"] : [];
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(field => !fields.includes(field))) throw new Error("Invalid lifecycle tool arguments");
  if (name === "list_video_jobs") {
    if (args.status !== undefined && !["all", "draft", "active", "history"].includes(args.status)) throw new Error("status must be all, draft, active or history");
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) throw new Error("limit must be an integer from 1 to 50");
    if (args.cursor !== undefined && (typeof args.cursor !== "string" || !args.cursor.length)) throw new Error("cursor must be a nonempty opaque string");
  }
  if (name === "cancel_video_job" && (typeof args.job_id !== "string" || !args.job_id.trim())) throw new Error("job_id is required");
  if (name === "close_video_job" && (typeof args.job_id !== "string" || !args.job_id.trim() || !Number.isSafeInteger(args.expected_revision) || args.expected_revision < 0)) throw new Error("job_id and nonnegative expected_revision are required");
}

function exactTemplateKeys(args, allowed) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(field => !allowed.includes(field))) {
    throw new Error("Invalid template/delivery tool arguments");
  }
}
function templateString(args, field, max, required = false, allowEmpty = false, multiline = false) {
  const value = args[field];
  if (value === undefined && !required) return undefined;
  const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || control.test(value)) {
    throw new Error(`Invalid parameter: ${field}`);
  }
  return value;
}
function templateIdentifier(args, field, required = true) {
  const value = templateString(args, field, 128, required);
  if (value !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error(`Invalid parameter: ${field}`);
  return value;
}
function templateHash(args, field, required = false) {
  const value = templateString(args, field, 64, required);
  if (value !== undefined && !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid parameter: ${field}`);
  return value;
}
function templateRequest(name, args) {
  if (name === "get_video_delivery") {
    exactTemplateKeys(args, ["job_id"]);
    return { path: `/video-jobs/${encodeURIComponent(templateIdentifier(args, "job_id"))}/delivery` };
  }
  if (name === "submit_video_feedback") {
    exactTemplateKeys(args, ["job_id", "decision", "output_sha256", "notes", "name", "category", "template_id"]);
    const jobId = templateIdentifier(args, "job_id");
    const decision = templateString(args, "decision", 32, true);
    if (!["satisfied_save_template", "satisfied", "needs_changes"].includes(decision)) throw new Error("Invalid parameter: decision");
    const output_sha256 = templateHash(args, "output_sha256", true);
    const notes = templateString(args, "notes", 2000, false, true, true);
    const templateName = templateString(args, "name", 80, false, true);
    const category = templateString(args, "category", 40, false, true);
    const template_id = templateIdentifier(args, "template_id", false);
    if (template_id && decision !== "satisfied_save_template") throw new Error("template_id requires satisfied_save_template");
    return { path: `/video-jobs/${encodeURIComponent(jobId)}/feedback`, method: "POST", body: {
      decision, output_sha256, ...(notes === undefined ? {} : { notes }), ...(templateName === undefined ? {} : { name: templateName }),
      ...(category === undefined ? {} : { category }), ...(template_id === undefined ? {} : { template_id }),
    } };
  }
  if (name === "list_video_templates") {
    exactTemplateKeys(args, ["status", "source_asset_id", "source_sha256", "limit", "cursor"]);
    const status = templateString(args, "status", 8);
    if (status && !["active", "archived", "all"].includes(status)) throw new Error("Invalid parameter: status");
    const source_asset_id = templateIdentifier(args, "source_asset_id", false);
    const source_sha256 = templateHash(args, "source_sha256");
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) throw new Error("Invalid parameter: limit");
    const cursor = templateString(args, "cursor", 512);
    if (cursor !== undefined && !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid parameter: cursor");
    const query = new URLSearchParams();
    for (const [field, value] of Object.entries({ status, source_asset_id, source_sha256, limit, cursor })) if (value !== undefined) query.set(field, String(value));
    return { path: `/video-templates${query.size ? `?${query}` : ""}` };
  }
  if (name === "get_video_template") {
    exactTemplateKeys(args, ["template_id", "version_id"]);
    const id = templateIdentifier(args, "template_id"), version = templateIdentifier(args, "version_id", false);
    return { path: `/video-templates/${encodeURIComponent(id)}${version === undefined ? "" : `?${new URLSearchParams({ version_id: version })}`}` };
  }
  exactTemplateKeys(args, ["template_id", "name", "category", "archived"]);
  const id = templateIdentifier(args, "template_id");
  const templateName = templateString(args, "name", 80);
  const category = templateString(args, "category", 40, false, true);
  if (args.archived !== undefined && typeof args.archived !== "boolean") throw new Error("Invalid parameter: archived");
  if (templateName === undefined && category === undefined && args.archived === undefined) throw new Error("At least one template field is required");
  return { path: `/video-templates/${encodeURIComponent(id)}`, method: "PATCH", body: {
    ...(templateName === undefined ? {} : { name: templateName }), ...(category === undefined ? {} : { category }),
    ...(args.archived === undefined ? {} : { archived: args.archived }),
  } };
}

function validateTemplateCreate(args) {
  templateIdentifier(args, "template_version_id");
  if (args.generation_mode !== "six_references") throw new Error("Template reuse requires an explicit six_references plan");
  exactTemplateKeys(args, ["template_version_id", "source_asset_id", "product_asset_id", "title", "instructions", "preserve_audio", "generation_mode", "reference_assets", "segment_plan"]);
  if (args.title !== undefined && (typeof args.title !== "string" || !args.title.trim())) throw new Error("Template reuse title must be nonempty when supplied");
}

const CHARACTER_TOOL_NAMES = new Set(["list_characters", "get_character", "save_character", "save_character_version", "update_character", "list_character_assets"]);
function characterReferences(args) {
  const refs = args.reference_assets;
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 6) throw new Error("reference_assets must contain 1–6 existing image assets");
  const seen = new Set();
  return refs.map(ref => {
    exactTemplateKeys(ref, ["asset_id", "label"]);
    const asset_id = templateIdentifier(ref, "asset_id");
    const label = templateString(ref, "label", 80, true);
    if (seen.has(asset_id)) throw new Error("Duplicate character reference asset_id");
    seen.add(asset_id);
    return { asset_id, label };
  });
}
function characterWrite(path, method, body) {
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 16 * 1024) throw new Error("Character request body exceeds 16 KiB");
  return { path, method, body };
}
function characterRequest(name, args) {
  if (name === "list_characters" || name === "list_character_assets") {
    exactTemplateKeys(args, name === "list_characters" ? ["status", "q", "limit", "cursor"] : ["limit", "cursor"]);
    const status = templateString(args, "status", 8);
    if (status !== undefined && !["active", "archived", "all"].includes(status)) throw new Error("Invalid parameter: status");
    const q = templateString(args, "q", 80, false, true);
    const limit = args.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) throw new Error("Invalid parameter: limit");
    const cursor = templateString(args, "cursor", 512);
    const query = new URLSearchParams();
    for (const [field, value] of Object.entries({ status, q, limit, cursor })) if (value !== undefined) query.set(field, String(value));
    return { path: `${name === "list_characters" ? "/characters" : "/character-assets"}${query.size ? `?${query}` : ""}` };
  }
  if (name === "get_character") {
    exactTemplateKeys(args, ["character_id", "version_id"]);
    const id = templateIdentifier(args, "character_id"), version = templateIdentifier(args, "version_id", false);
    return { path: `/characters/${encodeURIComponent(id)}${version === undefined ? "" : `?${new URLSearchParams({ version_id: version })}`}` };
  }
  if (name === "save_character") {
    exactTemplateKeys(args, ["idempotency_key", "name", "category", "description", "reference_assets"]);
    const idempotency_key = templateIdentifier(args, "idempotency_key");
    const profileName = templateString(args, "name", 80, true);
    const category = templateString(args, "category", 40, false, true);
    const description = templateString(args, "description", 2000, false, true, true);
    return characterWrite("/characters", "POST", {
      idempotency_key, name: profileName, ...(category === undefined ? {} : { category }),
      ...(description === undefined ? {} : { description }), reference_assets: characterReferences(args),
    });
  }
  if (name === "save_character_version") {
    exactTemplateKeys(args, ["character_id", "expected_latest_version_id", "description", "reference_assets"]);
    const id = templateIdentifier(args, "character_id"), expected_latest_version_id = templateIdentifier(args, "expected_latest_version_id");
    const description = templateString(args, "description", 2000, false, true, true);
    return characterWrite(`/characters/${encodeURIComponent(id)}/versions`, "POST", {
      expected_latest_version_id, ...(description === undefined ? {} : { description }), reference_assets: characterReferences(args),
    });
  }
  exactTemplateKeys(args, ["character_id", "name", "category", "archived"]);
  const id = templateIdentifier(args, "character_id"), profileName = templateString(args, "name", 80);
  const category = templateString(args, "category", 40, false, true);
  if (args.archived !== undefined && typeof args.archived !== "boolean") throw new Error("Invalid parameter: archived");
  if (profileName === undefined && category === undefined && args.archived === undefined) throw new Error("At least one character field is required");
  return characterWrite(`/characters/${encodeURIComponent(id)}`, "PATCH", {
    ...(profileName === undefined ? {} : { name: profileName }), ...(category === undefined ? {} : { category }),
    ...(args.archived === undefined ? {} : { archived: args.archived }),
  });
}

async function invoke(name, args = {}) {
  if (CHARACTER_TOOL_NAMES.has(name)) {
    const request = characterRequest(name, args);
    try {
      return await callApi(request.path, request.method ? { method: request.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) } : {});
    } catch (error) {
      if (error instanceof PublicApiError && error.publicData.error === "api_request_outcome_unknown") {
        throw new PublicApiError({ error: "api_request_outcome_unknown", retryable: false,
          message: "The character request outcome is uncertain. Inspect list_characters/get_character before retrying. Preserve the original request and save_character idempotency_key; do not automatically resend or create a video/template." });
      }
      throw error;
    }
  }
  if (["get_video_delivery", "submit_video_feedback", "list_video_templates", "get_video_template", "update_video_template"].includes(name)) {
    const request = templateRequest(name, args);
    return callApi(request.path, request.method ? { method: request.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) } : {});
  }
  if (["get_account_usage", "list_video_jobs", "cancel_video_job", "close_video_job"].includes(name)) {
    validateLifecycleArgs(name, args);
    if (name === "get_account_usage") return callApi("/account/usage");
    if (name === "cancel_video_job") return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/cancel`, { method: "POST" });
    if (name === "close_video_job") return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_revision: args.expected_revision }) });
    const query = new URLSearchParams();
    for (const field of ["status", "limit", "cursor"]) if (args[field] !== undefined) query.set(field, String(args[field]));
    return callApi("/video-jobs" + (query.size ? "?" + query.toString() : ""));
  }
  if (name === "health" || name === "capabilities") return callApi(`/${name}`);
  if (name === "upload_asset") return uploadAsset(args);
  if (name === "upload_local_asset") return uploadLocalAsset(args);
  if (name === "create_image_job") {
    const payload = imageRequest(args);
    try {
      return await callApi("/image-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (error) {
      if (error instanceof PublicApiError && error.publicData.error === "api_request_outcome_unknown") {
        throw new PublicApiError({ error: "api_request_outcome_unknown", retryable: false,
          message: "Image creation outcome is uncertain. Query get_job when job_id is known; otherwise inspect the account's image history through an available supported interface. list_video_jobs cannot reconcile image jobs. Preserve the original request and do not automatically resubmit." });
      }
      throw error;
    }
  }
  if (name === "create_video_job") {
    const characterBindings = hasCharacterReferenceFields(args);
    if (characterBindings && args.generation_mode !== "six_references") throw new Error("Character bindings require an explicit six_references mode");
    if (args.template_version_id !== undefined) validateTemplateCreate(args);
    if (args.generation_mode === "direct_references") {
      validateDirectReferences(args);
      await assertVideoModeAvailable("direct_references");
    } else if (args.generation_mode === "six_references") {
      validateSixJob(args);
      await assertVideoModeAvailable("six_references", characterBindings);
    } else if (args.generation_mode !== undefined || args.reference_assets !== undefined) {
      throw new Error("reference_assets requires an explicit supported generation_mode");
    }
    return callApi("/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  }
  if (name === "prepare_video_job") {
    const job = await callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
    if (["direct_references", "six_references"].includes(job.generation_mode)) await assertVideoModeAvailable(job.generation_mode);
    return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/prepare`, { method: "POST" });
  }
  if (name === "render_video_job") return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: args.max_coins, review_token: args.review_token }) });
  if (name === "review_video_segments") { validateCandidateDecisions(args); return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_review_token: args.candidate_review_token, decisions: args.decisions }) }); }
  if (name === "assemble_video_job") { validateCandidateToken(args); return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/assemble`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_review_token: args.candidate_review_token }) }); }
  if (name === "reconcile_video_job") { if (typeof args.job_id !== "string" || !args.job_id.trim()) throw new Error("job_id is required"); return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
  if (name === "get_job") return callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
  if (name === "download_output") {
    const job = await callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
    return { job_id: args.job_id, output_urls: job.outputs?.map((item) => item.url).filter(Boolean) || (job.output_url ? [job.output_url] : []) };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function respond(id, result, error = null) {
  const failure = error ? {
    code: -32000,
    message: safeErrorText(error instanceof Error ? error.message : String(error), key, 1024),
    ...(error instanceof PublicApiError ? { data: error.publicData } : {}),
  } : null;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(failure ? { error: failure } : { result }) })}\n`);
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request; try { request = JSON.parse(line); } catch { return; }
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") return respond(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lampstage-http", version: "0.10.1" } });
  if (request.method === "tools/list") return respond(request.id, { tools });
  if (request.method === "tools/call") {
    try { const value = await invoke(request.params?.name, request.params?.arguments || {}); return respond(request.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }); }
    catch (error) { return respond(request.id, null, error); }
  }
  respond(request.id, null, `Unsupported method: ${request.method}`);
});
