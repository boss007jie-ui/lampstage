import { getImageModel, type ImageModelId } from "../image-models";
import { logToolCall } from "../tool-log";
import { extractGeminiImage } from "./gemini-response";
import { readImageReferences, resolveImageBytes } from "./image-io";
import { buildImage25Request, buildNano21Request, extractOpenAiImage, IMAGE_25_ENDPOINT, NANO_21_ENDPOINT } from "./image-requests";
import { extractProviderReportedUsage } from "./provider-usage";
import type { GenSingleResult, IGenerationProvider, ProviderAttempt, ProviderReportedUsage } from "./types";

type Dependencies = {
  fetch: typeof fetch;
  readReferences: typeof readImageReferences;
  resolveImage: typeof resolveImageBytes;
  log: typeof logToolCall;
  apiKey: () => string;
};

/** Each job pins one provider. No old model, mixed-model strategy, or automatic retry. */
export function createOpenLuxImageProvider(id: ImageModelId, overrides: Partial<Dependencies> = {}): IGenerationProvider {
  const model = getImageModel(id);
  const isNano = id === "nano_banana_21";
  const tool = isNano ? "nano-banana" : "gpt-image-2";
  const dependencies: Dependencies = {
    fetch: (...args) => fetch(...args),
    readReferences: readImageReferences,
    resolveImage: resolveImageBytes,
    log: logToolCall,
    apiKey: () => {
      const key = process.env.OPENLUX_API_KEY?.trim();
      if (!key) throw new Error("Image service is not configured.");
      return key;
    },
    ...overrides,
  };
  return {
    name: model.name,
    async generate(input): Promise<GenSingleResult> {
      const startedAt = Date.now();
      let httpStatus: number | undefined;
      let result: GenSingleResult;
      let usage: ProviderReportedUsage | undefined;
      const attempt: ProviderAttempt = { status: "not_submitted", http_status: null };
      try {
        const key = dependencies.apiKey();
        const references = await dependencies.readReferences(input, model.maxReferences);
        // 参考图预处理是异步的，期间租约/授权可能已变；先查取消，再跑调用方给的闸门，
        // 然后才真正发出 HTTP POST —— 这是"付费请求真的发出去"的最后一道门。
        input.signal?.throwIfAborted();
        await input.beforeSend?.();
        input.signal?.throwIfAborted();
        const body = isNano ? JSON.stringify(buildNano21Request(input.prompt, references)) : buildImage25Request(input.prompt, references);
        const deadline = AbortSignal.timeout(input.requestTimeoutMs || 180_000);
        attempt.status = "unknown";
        const response = await dependencies.fetch(isNano ? NANO_21_ENDPOINT : IMAGE_25_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, ...(isNano ? { "Content-Type": "application/json" } : {}) },
          body,
          // 父信号与本次 deadline 合并：任一触发都真正中断 HTTP 请求。
          signal: input.signal ? AbortSignal.any([input.signal, deadline]) : deadline,
        });
        httpStatus = response.status;
        attempt.status = "response_received";
        attempt.http_status = response.status;
        if (!response.ok) {
          // Error bodies may still contain usage, but must never reach logs or users.
          try { usage = extractProviderReportedUsage(await response.json()); } catch { /* Ignore invalid error bodies. */ }
          throw new Error("provider_http_error");
        }
        const payload: unknown = await response.json();
        usage = extractProviderReportedUsage(payload);
        const image = isNano ? extractGeminiImage(payload) : extractOpenAiImage(payload);
        if (!image) throw new Error("provider_no_image");
        const verified = await dependencies.resolveImage(image, input.signal);
        result = { ok: true, ...verified, attempt, ...(usage ? { usage } : {}) };
      } catch {
        // Provider bodies and download URLs can contain secrets or signed links; never expose them.
        result = { ok: false, error: `${model.name}: image generation did not complete${httpStatus ? ` (HTTP ${httpStatus})` : ""}.`, attempt, ...(usage ? { usage } : {}) };
      }
      await dependencies.log({
        tool, model: model.apiModel, jobId: input.jobId,
        status: result.ok ? "ok" : "failed", httpStatus: httpStatus ?? null,
        durationMs: Date.now() - startedAt, error: result.ok ? null : result.error,
        resultJson: JSON.stringify({ attempt, ...(usage ? { usage } : {}) }),
      });
      return result;
    },
  };
}

export const nanoBanana21Provider = createOpenLuxImageProvider("nano_banana_21");
export const image25Provider = createOpenLuxImageProvider("image_25");
