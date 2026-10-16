import assert from "node:assert/strict";
import test from "node:test";
import { imageUsageMetadata, videoUsageData } from "../../lib/billing/usage";

test("image usage projects only recorded billing and provider counters", () => {
  const projected = imageUsageMetadata({
    image_count: 2,
    prompt_text: "private prompt",
    reference_assets: [{ url: "https://signed.example/private" }],
    billing: { mode: "internal_test", quoted_credits: 4, charged_credits: 0, token: "secret" },
    usage: { requested_images: 2, provider_attempts: [
      { index: 0, status: "response_received", http_status: 200, image_ready: true, duration_ms: 1200,
        tokens: { source: "provider_reported", input_tokens: 3, output_tokens: 4, total_tokens: 7, cached_tokens: null,
          credential: "secret" }, prompt: "private prompt", url: "https://signed.example/private" },
      { index: 1, status: "intent", duration_ms: null, tokens: null },
    ] },
  });
  assert.deepEqual(projected, {
    requested_images: 2,
    billing: { mode: "internal_test", quoted_credits: 4, charged_credits: 0 },
    provider_attempts: [
      { index: 0, status: "response_received", http_status: 200, image_ready: true, duration_ms: 1200,
        tokens: { source: "provider_reported", input_tokens: 3, output_tokens: 4, total_tokens: 7, cached_tokens: null } },
      { index: 1, status: "intent", http_status: null, image_ready: null, duration_ms: null, tokens: null },
    ],
  });
  assert.ok(!JSON.stringify(projected).includes("private"));
  assert.ok(!JSON.stringify(projected).includes("secret"));
});

test("legacy and malformed usage never invents charges or provider costs", () => {
  assert.deepEqual(imageUsageMetadata({ image_count: 3 }).billing,
    { mode: null, quoted_credits: null, charged_credits: null });
  const video = videoUsageData({ generationMode: "six_references", segments: [
    { index: 0, duration: 5, candidateMedia: { duration: 4.7, url: "private" } },
    { index: 1, duration: 5 },
  ], outputMedia: { duration: 9.5 }, renderConsent: { pricingBasis: "unpriced_technical_cap", maxCoins: 999 } });
  assert.equal(video.planned_duration_seconds, 10);
  assert.deepEqual(video.candidate_durations_seconds, [{ segment_index: 0, duration_seconds: 4.7 }]);
  assert.equal(video.output_duration_seconds, 9.5);
  assert.equal(video.quoted_video_coins, null);
  assert.equal(video.actual_video_coins, null);
  assert.ok(!JSON.stringify(video).includes("private"));
});
