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

// Isolated adapter for the observed generic, three-image Ref2VA workflow.
// The public AI App is 2102538614549868545; workflow submissions use its
// workflow ID, since duration and resolution are not exposed by the AI App.
export const providerModule = { name: "hypit-provider-runninghub-product-v6", version: "1" };
export const capability = { module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" };
export const mapping = {
  capability,
  result: "video",
  routes: [{ model: "MiniMax-H3-Generic-Ref2VA" }],
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

const WORKFLOW_ID = "2102537586127491074";
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
function failure(error, receipt) {
  const message = error instanceof Error ? error.message : String(error);
  return { status: "failed", ...(receipt ? { receipt } : {}), failure: {
    code: "RUNNINGHUB_ERROR", message: message.replace(/Bearer\s+\S+/giu, "Bearer [redacted]").slice(0, 500),
  } };
}
function support(request) {
  const authored = request.constraints;
  const duration = scalar(authored, "duration");
  if (duration !== 4 && duration !== 5) return { status: "unsupported", reason: "This generic Ref2VA adapter accepts only 4- or 5-second source windows" };
  if (String(scalar(authored, "resolution")) !== "768P") return { status: "unsupported", reason: "This adapter maps 768P to the workflow's 1.0 MP tier" };
  if (String(scalar(authored, "aspectRatio")).replace(/\s+/gu, "") !== "9:16") return { status: "unsupported", reason: "This adapter requires portrait 9:16" };
  if (!mappingSupportsRequest(mapping, authored)) return { status: "unsupported", reason: "The request has unsupported inputs" };
  const images = authored?.ports?.referenceImage ?? [];
  const videos = authored?.ports?.referenceVideo ?? [];
  if (!Array.isArray(images) || images.length !== 3 || !Array.isArray(videos) || videos.length !== 1) {
    return { status: "unsupported", reason: "Exactly three intentional images and one source video are required" };
  }
  if ((authored?.ports?.referenceAudio?.length ?? 0) > 0 || (authored?.ports?.firstFrame?.length ?? 0) > 0 || (authored?.ports?.lastFrame?.length ?? 0) > 0) {
    return { status: "unsupported", reason: "Separate audio and first/last frames are not connected in this workflow" };
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

export function buildNodeInfoList(input, images, videos) {
  nonempty(input.prompt, "prompt");
  if (!Array.isArray(images) || images.length !== 3 || images.some((x) => typeof x !== "string" || !x)) throw new Error("All three image uploads are required");
  if (!Array.isArray(videos) || videos.length !== 1 || typeof videos[0] !== "string" || !videos[0]) throw new Error("One source-video upload is required");
  const seconds = Number(input.seconds);
  if (seconds !== 4 && seconds !== 5) throw new Error("Expected an authored duration of 4 or 5 seconds");
  if (input.resolution !== "768P" || String(input.aspect_ratio).replace(/\s+/gu, "") !== "9:16") throw new Error("Expected 768P portrait 9:16");
  return [
    node("7", "image", images[0]), node("8", "image", images[1]), node("9", "image", images[2]),
    node("6", "video", videos[0]), node("6", "force_rate", "24"),
    node("6", "frame_load_cap", "0"), node("6", "select_every_nth", "1"), node("6", "skip_first_frames", "0"),
    node("13", "prompt", input.prompt), node("10", "value", String(seconds)),
    node("11", "aspect_ratio", "9:16 (Portrait Widescreen)"), node("11", "megapixels", "1.0"),
  ];
}

function selectVideoResult(results) {
  const matches = results.filter((item) => {
    if (!item || typeof item.url !== "string") return false;
    const type = String(item.outputType ?? item.fileType ?? "").toLowerCase();
    try { return type === "mp4" || new URL(item.url).pathname.toLowerCase().endsWith(".mp4"); } catch { return false; }
  });
  if (matches.length !== 1) throw new Error(`Expected one MP4 result, received ${matches.length}; ZIP diagnostic outputs are excluded`);
  return matches[0].url;
}

export function createRunningHubGenericProvider(options) {
  const base = address(options.baseUrl || DEFAULT_BASE_URL);
  const fetcher = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const timeoutMs = options.timeoutMs ?? 1_800_000;
  const instanceType = options.instanceType ?? "ultra";
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
    form.append("apiKey", key);
    form.append("fileType", "input");
    form.append("file", new Blob([bytes], { type: artifact.mediaType }), `hypit-reference.${ext}`);
    const response = await fetcher(`${base}/task/openapi/upload`, {
      method: "POST", headers: headersFor(key), body: form, signal: AbortSignal.timeout(120_000),
    });
    let body;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) throw new Error(`RunningHub upload returned HTTP ${response.status}`);
    if (body?.code !== 0) throw new Error(`RunningHub upload failed: ${String(body?.msg ?? "unknown error").slice(0, 200)}`);
    return nonempty(body.data?.fileName, "RunningHub upload fileName");
  }
  const endpoint = {
    async start(context) {
      let receipt;
      try {
        const supported = support(context.need);
        if (supported.status === "unsupported") throw new Error(supported.reason);
        const key = secret(context.credentials);
        const authored = context.need.constraints;
        const model = selectWireModelForRequest(mapping, authored);
        await context.reportProgress?.({ phase: `Preparing RunningHub generic Ref2VA request: ${model}` });
        const compiled = await compileWireRequest(mapping, authored,
          async (artifact) => await upload(artifact, context.resources, key));
        const input = object(compiled.input, "RunningHub compiled input");
        const nodes = buildNodeInfoList(input, input.reference_image_urls, input.reference_video_urls);
        await context.reportProgress?.({ phase: "Submitting RunningHub generic Ref2VA workflow" });
        const response = await json("/task/openapi/create", key, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: key, workflowId: WORKFLOW_ID, nodeInfoList: nodes, instanceType, usePersonalQueue: false }),
        });
        if (response.code !== 0) throw new Error(`RunningHub create failed: ${String(response.msg ?? "unknown error").slice(0, 200)}`);
        const taskId = response.data?.taskId;
        if ((typeof taskId !== "string" && typeof taskId !== "number") || !String(taskId).trim()) throw new Error("RunningHub create returned no data.taskId");
        receipt = { id: String(taskId) };
        const handle = { contract: "hypit.runninghub-generic-ref2va@1", taskId: String(taskId), startedAt: Date.now() };
        await context.checkpoint?.({ handle: canonicalize(handle), receipt });
        const rawTips = response.data?.promptTips;
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
        if (String(response.data?.taskStatus ?? "").toUpperCase() === "FAILED") throw new Error(`RunningHub task ${taskId} failed at creation`);
        return { ...wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: "submitted" }), receipt };
      } catch (error) { return failure(error, receipt); }
    },
    async poll(context) {
      const receipt = { id: String(context.handle?.taskId ?? "") };
      try {
        const handle = object(context.handle, "RunningHub handle");
        if (handle.contract !== "hypit.runninghub-generic-ref2va@1" || !handle.taskId) throw new Error("RunningHub handle is invalid");
        if (Date.now() - Number(handle.startedAt) > timeoutMs) throw new Error(`RunningHub task ${handle.taskId} exceeded ${timeoutMs}ms; query this task before any retry`);
        const key = secret(context.credentials);
        const state = await json("/openapi/v2/query", key, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: handle.taskId }),
        });
        const status = String(state.status ?? "").toUpperCase();
        if (status === "FAILED" || status === "ERROR") throw new Error(`RunningHub task ${handle.taskId} failed: ${String(state.errorMessage ?? state.errorCode ?? "unknown error").slice(0, 200)}`);
        if (status !== "SUCCESS") return wakeAfter(canonicalize({ ...handle, pollFailures: 0 }), pollIntervalMs, Date.now(), { phase: status.toLowerCase() || "pending" });
        const resultUrl = selectVideoResult(Array.isArray(state.results) ? state.results : []);
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
        const url = nonempty(context.handle?.resultUrl, "RunningHub MP4 result URL");
        await context.reportProgress?.({ phase: "Receiving generated RunningHub MP4" });
        const response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
        if (!response.ok) throw new Error(`RunningHub MP4 download returned HTTP ${response.status}`);
        const artifact = await context.resources.put(new Uint8Array(await response.arrayBuffer()), "video/mp4");
        return { status: "completed", result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } } };
      } catch (error) { return failure(error, receipt); }
    },
  };
  return defineEndpointPackage({
    module: providerModule, facet: "videos", instance: options.instance, pool: options.pool,
    credentials: { apiKey: options.apiKey }, credentialInputs: { apiKey: { label: "RunningHub API key", kind: "secret" } },
    defaultConcurrency: 1, actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 2 } },
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
      const config = runtimeConfigObject(context.config, "RunningHub generic Ref2VA service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "pollIntervalMs", "timeoutMs", "instanceType"], "RunningHub generic Ref2VA service");
      const baseUrl = runtimeConfigString(config.baseUrl, "RunningHub service baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "RunningHub service apiKey");
      if (!baseUrl || !apiKey || !context.pool) throw new Error("RunningHub generic Ref2VA service requires baseUrl, apiKey and pool");
      return { endpoint: createRunningHubGenericProvider({
        instance: context.instance, pool: context.pool, baseUrl, apiKey,
        instanceType: config.instanceType === undefined ? "ultra" : runtimeConfigString(config.instanceType, "instanceType"),
        pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 5000,
        timeoutMs: runtimeConfigPositiveInteger(config.timeoutMs, "timeoutMs") ?? 1800000,
      }) };
    },
  })],
};
