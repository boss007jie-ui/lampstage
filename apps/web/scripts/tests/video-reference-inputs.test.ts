import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseVideoReferenceInput, preparedReferencesReady, referenceDigest, snapshotReferenceImages, referenceVideoDirection } from "../../lib/video/reference-inputs";
import { validateRenderConsent } from "../../lib/video/consent";
import { verifyRenderConsent } from "../../lib/video/processor";
import type { VideoJobData } from "../../lib/video/types";

const body = { generation_mode: "direct_references", reference_assets: [
  { asset_id: "baby", role: "character", label: "宝宝" },
  { asset_id: "mom", role: "character", label: "妈妈" },
] };
const parsed = () => parseVideoReferenceInput(body, "product");
const prepared = (): VideoJobData => ({ ...parsed(), segments: [{ index: 0, start: 0, duration: 4, trimStart: 0, clipKey: "videos/job/segments/0/source.mp4" }],
  referenceImages: parsed().referenceImages!.map((r, i) => ({ ...r, key: `videos/job/references/${i}.png`, sha256: "a".repeat(64) })) });

test("direct input retains ordered distinct product, baby and mother; legacy callers keep legacy meaning", () => {
  const data = parsed();
  assert.equal(data.generationMode, "direct_references");
  assert.deepEqual(data.referenceImages!.map(r => [r.assetId, r.role, r.label]), [["product", "product", "产品"], ["baby", "character", "宝宝"], ["mom", "character", "妈妈"]]);
  assert.equal(data.imageCalls, 0);
  assert.equal(preparedReferencesReady(data), false);
  assert.equal(parseVideoReferenceInput({}, "product").generationMode, "legacy_frames");
});

test("unsupported or ambiguous reference requests reject instead of ignoring images or filling slots", () => {
  for (const input of [
    { ...body, generation_mode: "anything" }, { reference_assets: body.reference_assets },
    { ...body, reference_assets: body.reference_assets.slice(0, 1) },
    { ...body, reference_assets: [...body.reference_assets, { asset_id: "bed", role: "scene", label: "床面" }] },
    { ...body, reference_assets: [body.reference_assets[0], body.reference_assets[0]] },
    { ...body, reference_assets: [body.reference_assets[0], { asset_id: "product", role: "scene", label: "床面" }] },
    { ...body, reference_assets: [body.reference_assets[0], { asset_id: "mom", role: "unknown", label: "妈妈" }] },
    { ...body, reference_assets: [body.reference_assets[0], { asset_id: "mom", role: "character", label: " " }] },
    { ...body, reference_assets: [body.reference_assets[0], { asset_id: "mom", role: "character", label: "妈妈\0" }] },
  ]) assert.throws(() => parseVideoReferenceInput(input, "product"));
});

test("preparation freezes decodable images and records their actual hash without invoking image generation", async () => {
  const pixels = await sharp({ create: { width: 12, height: 10, channels: 3, background: "pink" } }).png().toBuffer();
  const read: string[] = [], saved: { key: string; bytes: Buffer }[] = [];
  const result = await snapshotReferenceImages(parsed().referenceImages!, "job", {
    read: async assetId => { read.push(assetId); return pixels; },
    write: async (key, bytes) => { saved.push({ key, bytes }); },
  });
  assert.deepEqual(read, ["product", "baby", "mom"]);
  assert.equal(saved.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(result[i].key, saved[i].key);
    assert.equal(result[i].sha256, createHash("sha256").update(saved[i].bytes).digest("hex"));
    assert.deepEqual([result[i].assetId, result[i].role], [read[i], i ? "character" : "product"]);
  }
  assert.equal(preparedReferencesReady({ ...parsed(), referenceImages: result }), true);
  await assert.rejects(snapshotReferenceImages(parsed().referenceImages!, "job", {
    read: async () => Buffer.from("broken image"), write: async () => { throw new Error("must not write malformed image"); },
  }));
  await assert.rejects(snapshotReferenceImages(parsed().referenceImages!, "job", {
    read: async () => { throw new Error("asset not owned"); }, write: async () => { throw new Error("must not write unauthorized image"); },
  }), /asset not owned/);
});

test("direct renders do not need endpoint frames but must bind consent to the exact reference snapshots", () => {
  const data = prepared();
  const decision = validateRenderConsent(data, 200, 100);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  data.renderConsent = { at: new Date().toISOString(), maxCoins: decision.maxCoins, estimatedCoins: decision.estimate,
    perSegmentCoins: decision.quote, segmentIndices: decision.segmentIndices, referenceDigest: decision.referenceDigest };
  assert.equal(decision.referenceDigest, referenceDigest(data));
  assert.doesNotThrow(() => verifyRenderConsent(data, 100));
  for (const field of ["sha256", "key", "label", "assetId"] as const) {
    const changed = structuredClone(data);
    changed.referenceImages![1][field] += "x";
    assert.throws(() => verifyRenderConsent(changed, 100));
  }
  const reordered = structuredClone(data);
  reordered.referenceImages!.reverse();
  assert.throws(() => verifyRenderConsent(reordered, 100));
  assert.throws(() => verifyRenderConsent({ ...data, renderConsent: { ...data.renderConsent!, referenceDigest: undefined } }, 100));
  assert.equal(validateRenderConsent({ ...data, referenceImages: parsed().referenceImages }, 200, 100).ok, false);
  assert.equal(validateRenderConsent({ ...data, generationMode: "legacy_frames" }, 200, 100).ok, false);
});

test("the prompt explains every Picture role, reserves motion for video, and never imposes endpoint images", () => {
  const direction = referenceVideoDirection(prepared().referenceImages!, "保持已确认的穿法");
  assert.match(direction, /Picture 1.*product/i);
  assert.match(direction, /Picture 2.*宝宝/);
  assert.match(direction, /Picture 3.*妈妈/);
  assert.match(direction, /Video 1/);
  assert.match(direction, /保持已确认的穿法/);
  assert.doesNotMatch(direction, /opening reference|ending reference|firstFrame|lastFrame/);
});
