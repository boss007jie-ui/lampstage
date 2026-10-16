import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import {
  compileWireRequest,
  generationTypes,
  mappingSupportsRequest,
  sealGeneratedVideoSet,
  selectWireModelForRequest,
} from "@hypit/hypit/generation";
import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from "@hypit/hypit/runtime-kit";

// Isolated adapter for the public six-image AI App. The underlying graph is
// private; these controls are based only on its published input schema.
export const providerModule = { name: "hypit-provider-runninghub-sixref", version: "1" };
export const capability = { module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" };
export const mapping = {
  capability,
  result: "video",
  routes: [{ model: "MiniMax-H3-SixRef" }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    duration: { as: "value", field: "seconds" },
    resolution: { as: "value", field: "resolution" },
    aspectRatio: { as: "value", field: "aspect_ratio" },
    referenceImage: { as: "urlArray", field: "reference_image_urls" },
    referenceVideo: { as: "urlArray", field: "reference_video_urls" },
    referenceAudio: { as: "urlArray", field: "reference_audio_urls" },
    firstFrame: { as: "url", field: "first_frame" },
    lastFrame: { as: "url", field: "last_frame" },
  },
};

const APP_ID = "2104148114306322433";
const IMAGE_NODES = ["51", "366", "364", "43", "19", "23"];
const DEFAULT_BASE_URL = "https://www.runninghub.cn";
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function nonempty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be nonempty text`);
  return value;
}
function address(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("RunningHub baseUrl requires HTTPS or loopback HTTP");
  }
  return url.href.replace(/\/$/u, "");
}
function scalar(request, port) {
  const value = request.ports?.[port]?.[0];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
function failure(error, receipt, terminal = false) {
  // Transport and server error text is untrusted and may contain a credential.
  const message = error?.safeMessage ?? "RunningHub request failed; inspect the retained task receipt before retrying";
  return { status: "failed", ...(receipt ? { receipt } : {}), failure: {
    code: terminal ? "RUNNINGHUB_TERMINAL_FAILURE" : "RUNNINGHUB_OUTCOME_UNKNOWN", message: message.slice(0, 300),
  } };
}
function support(request) {
  const authored = request.constraints;
  const duration = scalar(authored, "duration");
  if (![4, 5, 6, 8].includes(duration)) return { status: "unsupported", reason: "This adapter accepts only authored 4-, 5-, 6-, or 8-second windows" };
  if (String(scalar(authored, "resolution")) !== "768P") return { status: "unsupported", reason: "This contract requires 768P" };
  if (String(scalar(authored, "aspectRatio")).replace(/\s+/gu, "") !== "9:16") return { status: "unsupported", reason: "This adapter requires portrait 9:16" };
  if (!mappingSupportsRequest(mapping, authored)) return { status: "unsupported", reason: "The request has unsupported inputs" };
  const images = authored?.ports?.referenceImage ?? [];
  const videos = authored?.ports?.referenceVideo ?? [];
  if (!Array.isArray(images) || images.length < 1 || images.length > 6 || !Array.isArray(videos) || videos.length !== 1) {
    return { status: "unsupported", reason: "One to six intentional images and exactly one source video are required" };
  }
  if ((authored?.ports?.referenceAudio?.length ?? 0) > 0 || (authored?.ports?.firstFrame?.length ?? 0) > 0 || (authored?.ports?.lastFrame?.length ?? 0) > 0) {
    return { status: "unsupported", reason: "Separate audio and first/last frames are not exposed by this AI App; supply the first-frame image as image 1" };
  }
  return { status: "supported" };
}
function mediaExtension(mediaType) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov" };
  const ext = extensions[mediaType];
  if (!ext) throw new Error(`Unsupported RunningHub upload media type ${mediaType}`);
  return ext;
}
function node(nodeId, fieldName, fieldValue) { return { nodeId, fieldName, fieldValue }; }

export function buildNodeInfoList(input, images, videos, settings = {}) {
  nonempty(input.prompt, "prompt");
  if (!Array.isArray(images) || images.length < 1 || images.length > 6 || images.some((x) => typeof x !== "string" || !x)) throw new Error("One to six image uploads are required");
  if (!Array.isArray(videos) || videos.length !== 1 || typeof videos[0] !== "string" || !videos[0]) throw new Error("One source-video upload is required");
  const seconds = Number(input.seconds);
  if (![4, 5, 6, 8].includes(seconds)) throw new Error("Expected an authored duration of 4, 5, 6, or 8 seconds");
  if (input.resolution !== "768P" || String(input.aspect_ratio).replace(/\s+/gu, "") !== "9:16") throw new Error("Expected 768P portrait 9:16 contract");
  const firstPassMegapixels = settings.firstPassMegapixels ?? 0.4096;
  const upscaleFactor = settings.upscaleFactor ?? 1.5;
  if (!Number.isFinite(firstPassMegapixels) || firstPassMegapixels < 0.1 || firstPassMegapixels > 16) throw new Error("Invalid firstPassMegapixels");
  if (!Number.isFinite(upscaleFactor) || upscaleFactor < 1 || upscaleFactor > 4) throw new Error("Invalid upscaleFactor");
  return [
    ...IMAGE_NODES.map((id, index) => node(id, "image", images[index] ?? "None")),
    node("27", "video", videos[0]),
    node("381", "value", String(seconds)),
    node("252", "megapixels", String(firstPassMegapixels)),
    node("252", "aspect_ratio", "9:16 (Portrait Widescreen)"),
    node("376", "index", "1"),
    node("259", "value", String(seconds)),
    node("283", "value", String(upscaleFactor)),
    node("263", "text", input.prompt),
  ];
}

function selectGeneratedVideo(results) {
  const matches = results.filter((item) => String(item?.nodeId ?? "") === "214");
  if (matches.length !== 1) throw new Error("Expected exactly one generated video output from node 214");
  const item = matches[0];
  if (!item || typeof item.url !== "string") throw new Error("Generated video URL is missing");
  const type = String(item.outputType ?? item.fileType ?? "").toLowerCase();
  try {
    const url = new URL(item.url);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid generated video URL");
    if (type !== "mp4" && !url.pathname.toLowerCase().endsWith(".mp4")) throw new Error("Generated node output is not an MP4");
  } catch { throw new Error("Generated node output has an invalid MP4 URL"); }
  return item.url;
}

export function createRunningHubSixRefProvider(options) {
  const base = address(options.baseUrl || DEFAULT_BASE_URL);
  const fetcher = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 1_800_000;
  const instanceType = options.instanceType ?? "default";
  if (typeof fetcher !== "function") throw new Error("RunningHub provider requires fetch");
  if (!["default", "plus", "ultra"].includes(instanceType)) throw new Error("Invalid RunningHub instanceType");
  const secret = (credentials) => nonempty(credentials.apiKey?.secret, "RunningHub API key");
  const headersFor = (key, extra = {}) => ({ authorization: `Bearer ${key}`, ...extra });
  async function json(path, key, init = {}) {
    const response = await fetcher(`${base}${path}`, {
      ...init, headers: headersFor(key, init.headers ?? {}), signal: init.signal ?? AbortSignal.timeout(120_000),
    });
    let body;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) {
      const error = new Error(`RunningHub ${path} returned HTTP ${response.status}`);
      error.httpStatus = response.status;
      if (path.startsWith("/openapi/v2/run/ai-app/") &&
        (typeof body?.taskId === "string" || typeof body?.taskId === "number") && String(body.taskId).trim()) {
        error.submissionTaskId = String(body.taskId);
      }
      throw error;
    }
    return object(body, `RunningHub ${path} response`);
  }
  async function upload(artifact, resources, key) {
    const bytes = await resources.get(artifact.resource);
    if (bytes === undefined) throw new Error(`Reference resource ${artifact.resource} is unavailable`);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("RunningHub workflow upload exceeds the documented 30 MB limit");
    const ext = mediaExtension(artifact.mediaType);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: artifact.mediaType }), `hypit-reference.${ext}`);
    const response = await fetcher(`${base}/openapi/v2/media/upload/binary`, {
      method: "POST", headers: headersFor(key), body: form, signal: AbortSignal.timeout(120_000),
    });
    let body;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) throw new Error(`RunningHub upload returned HTTP ${response.status}`);
    if (body?.code !== 0) throw new Error(`RunningHub upload failed: ${String(body?.message ?? "unknown error").slice(0, 200)}`);
    return nonempty(body.data?.fileName, "RunningHub upload fileName");
  }
  const endpoint = {
    async start(context) {
      let receipt;
      try {
        const supported = support(context.need);
        if (supported.status === "unsupported") throw new Error(supported.reason);
        if (typeof context.checkpoint !== "function") throw new Error("RunningHub submission requires a durable checkpoint callback");
        const key = secret(context.credentials);
        const authored = context.need.constraints;
        const model = selectWireModelForRequest(mapping, authored);
        await context.reportProgress?.({ phase: `Preparing RunningHub six-reference request: ${model}` });
        const compiled = await compileWireRequest(mapping, authored,
          async (artifact) => await upload(artifact, context.resources, key));
        const input = object(compiled.input, "RunningHub compiled input");
        const nodes = buildNodeInfoList(input, input.reference_image_urls, input.reference_video_urls, options);
        await context.reportProgress?.({ phase: "Submitting RunningHub six-reference AI App" });
        const response = await json(`/openapi/v2/run/ai-app/${APP_ID}`, key, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeInfoList: nodes, instanceType, usePersonalQueue: false }),
        });
        const taskId = response.taskId;
        if ((typeof taskId !== "string" && typeof taskId !== "number") || !String(taskId).trim()) throw new Error("RunningHub create returned no taskId; submission outcome may be unknown, so do not retry blindly");
        receipt = { id: String(taskId) };
        const handle = { contract: "hypit.runninghub-sixref@1", taskId: String(taskId), startedAt: Date.now() };
        await context.checkpoint({ handle: canonicalize(handle), receipt });
        const rawTips = response.promptTips;
        if (rawTips) {
          let tips = rawTips;
          if (typeof rawTips === "string") {
            try { tips = JSON.parse(rawTips); } catch { throw new Error(`RunningHub task ${taskId} returned unreadable promptTips; query this task before any retry`); }
          }
          if (tips && typeof tips === "object") {
            const errors = tips.node_errors;
            const hasErrors = errors && typeof errors === "object" && Object.keys(errors).length > 0;
            if (tips.result === false || hasErrors) throw new Error(`RunningHub task ${taskId} reported node validation errors; query this task before any retry`);
          }
        }
        if (String(response.status ?? "").toUpperCase() === "FAILED") throw new Error(`RunningHub task ${taskId} failed at creation`);
        return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: "submitted" }), receipt };
      } catch (error) {
        if (!receipt && error?.submissionTaskId) {
          receipt = { id: error.submissionTaskId };
          const handle = { contract: "hypit.runninghub-sixref@1", taskId: receipt.id, startedAt: Date.now() };
          try { await context.checkpoint({ handle: canonicalize(handle), receipt }); } catch { /* receipt is still returned for reconciliation */ }
        }
        return failure(error, receipt);
      }
    },
    async poll(context) {
      const receipt = { id: String(context.handle?.taskId ?? "") };
      try {
        const handle = object(context.handle, "RunningHub handle");
        if (handle.contract !== "hypit.runninghub-sixref@1" || !handle.taskId) throw new Error("RunningHub handle is invalid");
        if (Date.now() - Number(handle.startedAt) > timeoutMs) throw new Error(`RunningHub task ${handle.taskId} exceeded ${timeoutMs}ms; query this task before any retry`);
        const key = secret(context.credentials);
        const state = await json("/openapi/v2/query", key, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: handle.taskId }),
        });
        const status = String(state.status ?? "").toUpperCase();
        if (status === "FAILED" || status === "ERROR") {
          // This is the only proof of a terminal remote failure: the authenticated
          // status query returned it for the acknowledged task ID.
          return failure(new Error("RunningHub reported terminal task failure"), receipt, true);
        }
        if (status !== "SUCCESS") return wakeAfter(canonicalize({ ...handle, pollFailures: 0 }), pollIntervalMs, Date.now(), { phase: status.toLowerCase() || "pending" });
        const resultUrl = selectGeneratedVideo(Array.isArray(state.results) ? state.results : []);
        return { status: "ready", handle: canonicalize({ ...handle, pollFailures: 0, resultUrl }), receipt };
      } catch (error) {
        // Only repeat the read-only status query; never repeat a paid submission.
        const transient = error?.name === "AbortError" || error?.name === "TimeoutError" ||
          (error?.name === "TypeError" && /fetch failed|network/iu.test(error.message ?? "")) ||
          [429, 502, 503, 504].includes(error?.httpStatus);
        const failures = Number(context.handle?.pollFailures ?? 0) + 1;
        if (transient && context.handle?.taskId && failures <= 5) {
          return wakeAfter(canonicalize({ ...context.handle, pollFailures: failures }), failures * 10_000, Date.now(), { phase: "status connection retry; original task retained" });
        }
        return failure(error, receipt.id ? receipt : undefined);
      }
    },
    async collect(context) {
      const receipt = context.handle?.taskId ? { id: String(context.handle.taskId) } : undefined;
      try {
        const url = nonempty(context.handle?.resultUrl, "RunningHub generated MP4 result URL");
        await context.reportProgress?.({ phase: "Receiving generated RunningHub MP4 results" });
        const response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
        if (!response.ok) throw new Error(`RunningHub MP4 download returned HTTP ${response.status}`);
        const video = await context.resources.put(new Uint8Array(await response.arrayBuffer()), "video/mp4");
        return { status: "completed", result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [video] })) } } };
      } catch (error) { return failure(error, receipt); }
    },
  };
  return defineEndpointPackage({
    module: providerModule, facet: "videos", instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey }, credentialInputs: { apiKey: { label: "RunningHub API key", kind: "secret" } },
    defaultConcurrency: 3, actionLimits: { submit: { concurrency: 3 }, poll: { concurrency: 4 }, collect: { concurrency: 2 } },
    pricing: { kind: "page", url: "https://www.runninghub.cn" },
    capabilities: [{ capability, returns: generationTypes.videoSet, lifecycle: "asynchronous", supports: support, endpoint }],
  });
}

// The package can use this file as both its endpoint and activation entry.
export default {
  format: "hypit.node-package@1",
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "RunningHub six-reference service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "pollIntervalMs", "timeoutMs", "instanceType", "firstPassMegapixels", "upscaleFactor"], "RunningHub six-reference service");
      const baseUrl = runtimeConfigString(config.baseUrl, "RunningHub service baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "RunningHub service apiKey");
      if (!baseUrl || !apiKey || !context.pool) throw new Error("RunningHub six-reference service requires baseUrl, apiKey and pool");
      return { endpoint: createRunningHubSixRefProvider({
        instance: context.instance, pool: context.pool, baseUrl, apiKey,
        instanceType: config.instanceType === undefined ? "default" : runtimeConfigString(config.instanceType, "instanceType"),
        firstPassMegapixels: config.firstPassMegapixels === undefined ? 0.4096 : Number(config.firstPassMegapixels),
        upscaleFactor: config.upscaleFactor === undefined ? 1.5 : Number(config.upscaleFactor),
        pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 5000,
        timeoutMs: runtimeConfigPositiveInteger(config.timeoutMs, "timeoutMs") ?? 1800000,
      }) };
    },
  })],
};

