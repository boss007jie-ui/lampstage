import assert from "node:assert/strict";
import test from "node:test";
import { createOpenLuxImageProvider } from "../../lib/providers/openlux-images";
import { extractProviderReportedUsage } from "../../lib/providers/provider-usage";
import type { GenInput } from "../../lib/providers/types";
import type { ToolLogInput } from "../../lib/tool-log";

test("projects Gemini usageMetadata onto reported token counts only", () => {
  const payload = {
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 48,
      totalTokenCount: 168,
      cachedContentTokenCount: 20,
      providerCost: 900,
      requestUrl: "https://secret.example/signed?token=private",
    },
    candidates: [{ content: { parts: [{ inlineData: { data: "private-image" } }] } }],
  };
  assert.deepEqual(extractProviderReportedUsage(payload), {
    source: "provider_reported",
    input_tokens: 120,
    output_tokens: 48,
    total_tokens: 168,
    cached_tokens: 20,
  });
});

test("projects OpenAI-compatible usage with legacy token names and cache details", () => {
  assert.deepEqual(extractProviderReportedUsage({ usage: {
    prompt_tokens: 80,
    completion_tokens: 25,
    total_tokens: 105,
    prompt_tokens_details: { cached_tokens: 14 },
  } }), {
    source: "provider_reported",
    input_tokens: 80,
    output_tokens: 25,
    total_tokens: 105,
    cached_tokens: 14,
  });
  assert.deepEqual(extractProviderReportedUsage({ usage: {
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
    input_tokens_details: { cached_tokens: 3 },
  } }), {
    source: "provider_reported",
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
    cached_tokens: 3,
  });
});

test("leaves missing usage absent and missing individual counts null", () => {
  assert.equal(extractProviderReportedUsage({ data: [{ url: "https://secret.example/image" }] }), undefined);
  assert.deepEqual(extractProviderReportedUsage({ usageMetadata: { totalTokenCount: 0 } }), {
    source: "provider_reported",
    input_tokens: null,
    output_tokens: null,
    total_tokens: 0,
    cached_tokens: null,
  });
});

test("rejects malformed token counts and never copies unrelated provider fields", () => {
  assert.equal(extractProviderReportedUsage({ usage: {
    input_tokens: "12", output_tokens: -1, total_tokens: Infinity,
    cached_tokens: Number.MAX_SAFE_INTEGER + 1,
    url: "https://secret.example/signed?token=private",
  } }), undefined);
  assert.equal(extractProviderReportedUsage({ usageMetadata: [1, 2, 3] }), undefined);
  assert.deepEqual(extractProviderReportedUsage({ usage: {
    input_tokens: 12, output_tokens: 1.5, total_tokens: NaN, rawResponse: "private",
  } }), {
    source: "provider_reported",
    input_tokens: 12,
    output_tokens: null,
    total_tokens: null,
    cached_tokens: null,
  });
});

const input: GenInput = {
  prompt: "local test", referenceImageUrl: "https://invalid.example/reference",
  aspectRatio: "1_1", platformStyle: "brand_site", outputCount: 1,
};

async function runProviderWithPayload(status: number, payload: unknown, failure?: "preflight" | "timeout") {
  const logs: ToolLogInput[] = [];
  let fetchCalls = 0;
  const provider = createOpenLuxImageProvider("nano_banana_21", {
    apiKey: () => "local-test-key",
    readReferences: async () => {
      if (failure === "preflight") throw new Error("reference unavailable");
      return [{ bytes: Buffer.from("reference"), mime: "image/png" }];
    },
    fetch: (async () => {
      fetchCalls += 1;
      if (failure === "timeout") throw new DOMException("request timed out", "TimeoutError");
      return { status, ok: status === 200, json: async () => payload } as Response;
    }) as typeof fetch,
    resolveImage: async () => ({ bytes: Buffer.from("image"), mime: "image/png" }),
    log: async entry => { logs.push(entry); },
  });
  return { result: await provider.generate(input), logs, fetchCalls };
}

test("preflight failure is not submitted and has no HTTP status", async () => {
  const { result, logs, fetchCalls } = await runProviderWithPayload(200, {}, "preflight");
  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.attempt, { status: "not_submitted", http_status: null });
  assert.deepEqual(JSON.parse(logs[0].resultJson!), { attempt: result.attempt });
});

test("fetch timeout has unknown provider outcome and no HTTP status", async () => {
  const { result, logs, fetchCalls } = await runProviderWithPayload(200, {}, "timeout");
  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(result.attempt, { status: "unknown", http_status: null });
  assert.deepEqual(JSON.parse(logs[0].resultJson!), { attempt: result.attempt });
});

test("successful image response records a received HTTP response", async () => {
  const { result, logs } = await runProviderWithPayload(200, {
    candidates: [{ content: { parts: [{ inlineData: { data: "QUJD", mimeType: "image/png" } }] } }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempt, { status: "response_received", http_status: 200 });
  assert.deepEqual(JSON.parse(logs[0].resultJson!), { attempt: result.attempt });
});

test("preserves reported usage when a successful provider response contains no image", async () => {
  const { result, logs } = await runProviderWithPayload(200, {
    usageMetadata: { promptTokenCount: 8, totalTokenCount: 8, secret: "private-body" },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.attempt, { status: "response_received", http_status: 200 });
  assert.deepEqual(result.usage, {
    source: "provider_reported", input_tokens: 8, output_tokens: null,
    total_tokens: 8, cached_tokens: null,
  });
  assert.deepEqual(JSON.parse(logs[0].resultJson!), { attempt: result.attempt, usage: result.usage });
  assert.equal(JSON.stringify(logs).includes("private-body"), false);
});

test("preserves reported usage from a provider HTTP error without exposing its body", async () => {
  const { result, logs } = await runProviderWithPayload(429, {
    usageMetadata: { promptTokenCount: 5 }, error: "private-body",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.attempt, { status: "response_received", http_status: 429 });
  assert.match(result.error!, /HTTP 429/);
  assert.equal(result.error!.includes("private-body"), false);
  assert.equal(result.usage?.input_tokens, 5);
  assert.deepEqual(JSON.parse(logs[0].resultJson!), { attempt: result.attempt, usage: result.usage });
  assert.equal(JSON.stringify(logs).includes("private-body"), false);
});
