import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateRenderConsent } from "../../lib/video/consent";
import { acceptLocalUpload, localMediaResponse, privateRead, privateWrite, sealPrivateUpload, validatePrivateKey } from "../../lib/video/storage";
import type { VideoJobData } from "../../lib/video/types";

function data(): VideoJobData {
  return { version: 1, imageCalls: 4, segments: [0, 1].map(index => ({ index, start: index * 5, duration: 5, trimStart: 0, clipKey: "clip", openingKey: "opening", endingKey: "ending" })) };
}
test("render requires complete refs and sufficient explicit budget; unpriced mode still demands a cap", () => {
  // 未定价模式（explicit）：单段报价未配置时不再硬拒，但必须给出明确的整数上限，
  // 并标记为 unpriced_technical_cap，让核算知道这不是已定价报价。
  assert.equal(validateRenderConsent(data(), 0, null).ok, false);
  assert.equal(validateRenderConsent(data(), 1.5, null).ok, false);
  assert.equal(validateRenderConsent(data(), 2_000_000, null).ok, false);
  assert.deepEqual(validateRenderConsent(data(), 1000, null),
    { ok: true, estimate: null, maxCoins: 1000, quote: null, pricingBasis: "unpriced_technical_cap", segmentIndices: [0, 1] });
  assert.equal(validateRenderConsent(data(), 199, 100).ok, false);
  assert.equal(validateRenderConsent(data(), "200", 100).ok, false);
  const incomplete = data(); delete incomplete.segments[0].openingKey;
  assert.equal(validateRenderConsent(incomplete, 200, 100).ok, false);
  const allowed = validateRenderConsent(data(), 200, 100);
  assert.deepEqual(allowed, { ok: true, estimate: 200, maxCoins: 200, quote: 100, pricingBasis: "configured_quote", segmentIndices: [0, 1] });
});
test("an ambiguous prior submission cannot be purchased again; completed segments are reused", () => {
  const ambiguous = data(); ambiguous.segments[0].submissionIntentAt = new Date().toISOString();
  assert.equal(validateRenderConsent(ambiguous, 200, 100).ok, false);
  ambiguous.segments[0].buildId = "bld-existing";
  assert.equal(validateRenderConsent(ambiguous, 200, 100).ok, false);
  ambiguous.segments[0].candidateKey = "saved-candidate";
  assert.deepEqual(validateRenderConsent(ambiguous, 100, 100), { ok: true, estimate: 100, maxCoins: 100, quote: 100, pricingBasis: "configured_quote", segmentIndices: [1] });
});
test("private keys cannot traverse or escape the video namespace", () => {
  for (const key of ["../public/a.mp4", "videos/u/../a.mp4", "/videos/u/a.mp4", "uploads/u/a.mp4", "videos/u/a\\b.mp4", "videos/u/a?key=secret"]) assert.throws(() => validatePrivateKey(key));
  assert.equal(validatePrivateKey("videos/user-1/source/asset.mp4"), "videos/user-1/source/asset.mp4");
});
test("private upload validates bytes and local playback supports ranges without public copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lampstage-private-video-"));
  const previous = { directory: process.env.VIDEO_STORAGE_DIR, bucket: process.env.VIDEO_R2_BUCKET };
  process.env.VIDEO_STORAGE_DIR = root; delete process.env.VIDEO_R2_BUCKET;
  const key = "videos/test/source/a.mp4";
  try {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0, 1, 2, 3, 4, 5])); controller.close(); } });
    await acceptLocalUpload(key, stream, 6);
    await sealPrivateUpload(key, "videos/test/sealed/a.mp4");
    await privateWrite(key, Buffer.from([9, 9, 9]), "video/mp4");
    assert.deepEqual(await privateRead("videos/test/sealed/a.mp4"), Buffer.from([0, 1, 2, 3, 4, 5]));
    await privateWrite(key, Buffer.from([0, 1, 2, 3, 4, 5]), "video/mp4");
    const response = await localMediaResponse(key, "video/mp4", "bytes=2-4");
    assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), "bytes 2-4/6");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([2, 3, 4]));
    const suffix = await localMediaResponse(key, "video/mp4", "bytes=-2");
    assert.deepEqual(new Uint8Array(await suffix.arrayBuffer()), new Uint8Array([4, 5]));
    assert.equal((await localMediaResponse(key, "video/mp4", "bytes=99-100")).status, 416);
    const tooLarge = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.close(); } });
    await assert.rejects(acceptLocalUpload("videos/test/source/b.mp4", tooLarge, 2));
    await assert.rejects(privateRead("videos/test/source/b.mp4"));
    await privateWrite("videos/test/refs/opening.png", Buffer.from([1, 2]), "image/png");
    assert.deepEqual(await privateRead("videos/test/refs/opening.png"), Buffer.from([1, 2]));
  } finally {
    if (previous.directory === undefined) delete process.env.VIDEO_STORAGE_DIR; else process.env.VIDEO_STORAGE_DIR = previous.directory;
    if (previous.bucket === undefined) delete process.env.VIDEO_R2_BUCKET; else process.env.VIDEO_R2_BUCKET = previous.bucket;
    await rm(root, { recursive: true, force: true });
  }
});
