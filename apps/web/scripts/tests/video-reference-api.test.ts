import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../../lib/db";
import { POST as createJob } from "../../app/api/v1/video-jobs/route";
import { GET as capabilities } from "../../app/api/v1/capabilities/route";
import { MCP_TOOLS } from "../../lib/mcp-tools";
import { GET as getJob } from "../../app/api/v1/jobs/[id]/route";
import { POST as prepareJob } from "../../app/api/v1/video-jobs/[id]/prepare/route";
import { POST as renderJob } from "../../app/api/v1/video-jobs/[id]/render/route";
import { parseVideoReferenceInput, referenceDigest } from "../../lib/video/reference-inputs";
import { requireVideoWorker } from "../../lib/video/http";
import { videoData } from "../../lib/video/types";
import { lifecycleTransaction } from "./lifecycle-route-fixture";

const input = { source_asset_id: "source", product_asset_id: "product", generation_mode: "direct_references", reference_assets: [
  { asset_id: "baby", role: "character", label: "宝宝" }, { asset_id: "mom", role: "character", label: "妈妈" },
] };
type Query = { where: { id: string | { in: string[] }; user_id: string }; data?: Record<string, unknown> };
function stub(t: TestContext, model: object, method: string, callback: (query: Query) => unknown) {
  // Prisma delegates are proxies without ordinary method descriptors, so restore the proxy override explicitly.
  const delegate = model as Record<string, (query: Query) => Promise<unknown>>;
  const original = delegate[method];
  delegate[method] = async query => callback(query);
  t.after(() => { delegate[method] = original; });
}
function fixture(t: TestContext, missing?: string) {
  lifecycleTransaction(t);
  const queries: Query[] = [], writes: Query[] = [];
  stub(t, prisma.apiKey, "findUnique", () => ({ id: "test-key", revoked_at: null, user: { id: "owner" } }));
  stub(t, prisma.apiKey, "update", () => ({}));
  stub(t, prisma.videoAsset, "findFirst", query => { queries.push(query); return { id: "source", user_id: "owner" }; });
  stub(t, prisma.uploadedAsset, "findFirst", query => { queries.push(query); return query.where.id === missing ? null : { id: query.where.id, user_id: "owner" }; });
  stub(t, prisma.uploadedAsset, "findMany", query => {
    queries.push(query);
    return (query.where.id as { in: string[] }).in.filter(id => id !== missing).map(id => ({ id, user_id: "owner" }));
  });
  stub(t, prisma.videoJob, "count", () => 0);
  stub(t, prisma.videoJob, "create", query => { writes.push(query); return { id: "job", status: "draft" }; });
  return { queries, writes };
}
function env(t: TestContext, values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
const request = (body: unknown) => new NextRequest("https://lampstage.com/api/v1/video-jobs", { method: "POST", headers: { authorization: "Bearer lmp_live_unit_test", "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("create API stores every owned role reference and reports the explicit generation mode", async t => {
  const f = fixture(t);
  const response = await createJob(request(input));
  assert.ok(response);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.generation_mode, "direct_references");
  assert.equal(result.references_ready, false);
  assert.deepEqual(result.reference_assets.map((r: { asset_id: string }) => r.asset_id), ["product", "baby", "mom"]);
  const data = f.writes[0].data!.data as { referenceImages: { assetId: string }[] };
  assert.deepEqual(data.referenceImages.map(r => r.assetId), ["product", "baby", "mom"]);
  assert.ok(f.queries.every(query => query.where.user_id === "owner"));
});

test("another user's or deleted identity asset rejects before a job is created", async t => {
  const f = fixture(t, "mom");
  const response = await createJob(request(input));
  assert.ok(response);
  assert.equal(response.status, 404);
  assert.equal(f.writes.length, 0);
});

test("four independent references or unlabelled references fail before persistence", async t => {
  const f = fixture(t);
  for (const body of [
    { ...input, reference_assets: [...input.reference_assets, { asset_id: "bed", role: "scene", label: "床" }] },
    { ...input, reference_assets: [{ asset_id: "baby", role: "character" }, input.reference_assets[1]] },
  ]) {
    const response = await createJob(request(body));
    assert.ok(response);
    assert.equal(response.status, 400);
  }
  assert.equal(f.writes.length, 0);
});

test("the capability and remote tool schema disclose direct and six-reference routes", async () => {
  const catalog = await capabilities().json();
  const video = catalog.capabilities.find((item: { id: string }) => item.id === "video.replicate");
  assert.equal(video.modes.direct_references.reference_image_count, 3);
  assert.equal(video.modes.direct_references.generated_endpoint_frames, false);
  assert.deepEqual(video.modes.six_references.start_state, {
    required: true, picture: 1, unique: true, meaning: "complete_scene_at_action_start", dependency: "accepted_previous_tail_replaces_slot_1",
  });
  assert.equal(video.modes.six_references.candidate_timing_check, "actual_media_and_30fps_delivery");
  const tool = MCP_TOOLS.find(item => item.name === "create_video_job")!;
  const props = tool.inputSchema.properties as unknown as { generation_mode: { enum: string[] }; reference_assets: { minItems: number; maxItems: number } };
  assert.ok(props.generation_mode.enum.includes("direct_references"));
  assert.ok(props.generation_mode.enum.includes("six_references"));
  assert.deepEqual([props.reference_assets.minItems, props.reference_assets.maxItems], [1, 6]);
});

test("prepare can queue direct input without image readiness and uses a phase older workers cannot mistake for paid prepare", async t => {
  fixture(t);
  env(t, { VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  stub(t, prisma.videoJob, "findFirst", () => ({ id: "job", user_id: "owner", title: "商品视频", stage: "等待准备参考图", phase: "prepare", status: "draft", revision: 0,
    lease_owner: null, lease_until: null, error: null, created_at: new Date("2026-10-15T11:00:00Z"), updated_at: new Date("2026-10-15T11:00:00Z"), data: parseVideoReferenceInput(input, "product") }));
  const writes: Query[] = [];
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  const response = await prepareJob(request({}), { params: { id: "job" } });
  assert.ok(response);
  assert.equal(response.status, 202);
  assert.equal(writes[0].data!.phase, "prepare_references");
  assert.equal(writes[0].data!.status, "queued");
});

test("job review exposes role snapshots and a current quote before consent; rendering binds that exact review", async t => {
  fixture(t);
  env(t, { VIDEO_H3_SEGMENT_QUOTE_COINS: "100", VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", R2_ENDPOINT: "", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  const data = parseVideoReferenceInput(input, "product");
  data.sourceDuration = 4;
  data.segments = [{ index: 0, start: 0, duration: 4, trimStart: 0, clipKey: "videos/job/segments/0/source.mp4" }];
  data.referenceImages = data.referenceImages!.map((ref, i) => ({ ...ref, key: `videos/job/references/${i}.png`, sha256: "a".repeat(64) }));
  stub(t, prisma.generationJob, "findFirst", () => null);
  stub(t, prisma.videoJob, "findFirst", () => ({ id: "job", user_id: "owner", phase: "prepare_references", status: "review", data,
    created_at: new Date(), updated_at: new Date(), revision: 5 }));
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  const review = await getJob(request({}), { params: { id: "job" } });
  assert.ok(review);
  const result = await review.json();
  assert.equal(result.phase, "prepare");
  assert.equal(result.generation_mode, "direct_references");
  assert.equal(result.references_ready, true);
  assert.equal(result.estimate.video_coins, 100);
  assert.equal(result.estimate.image_calls, 0);
  assert.deepEqual(result.reference_assets.map((ref: { label: string }) => ref.label), ["产品", "宝宝", "妈妈"]);
  assert.ok(result.reference_assets.every((ref: object) => !("key" in ref)));
  // 审阅标识必须在展示时就签发；render 必须回传同一个值。
  assert.match(result.review_token, /^[a-f0-9]{64}$/);
  assert.equal(result.pricing_basis, "configured_quote");
  const writes: Query[] = [];
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  const response = await renderJob(request({ confirm_references: true, accept_estimate: true, max_coins: 100, review_token: result.review_token }), { params: { id: "job" } });
  assert.ok(response);
  assert.equal(response.status, 202);
  assert.equal(videoData(writes[0].data!.data).renderConsent!.referenceDigest, referenceDigest(data));
});

test("render is refused when the price changed after the review, even below the budget", async t => {
  fixture(t);
  env(t, { VIDEO_H3_SEGMENT_QUOTE_COINS: "100", VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", R2_ENDPOINT: "", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  const data = parseVideoReferenceInput(input, "product");
  data.sourceDuration = 4;
  data.segments = [{ index: 0, start: 0, duration: 4, trimStart: 0, clipKey: "videos/job/segments/0/source.mp4" }];
  data.referenceImages = data.referenceImages!.map((ref, i) => ({ ...ref, key: `videos/job/references/${i}.png`, sha256: "a".repeat(64) }));
  stub(t, prisma.generationJob, "findFirst", () => null);
  stub(t, prisma.videoJob, "findFirst", () => ({ id: "job", user_id: "owner", phase: "prepare_references", status: "review", data,
    created_at: new Date(), updated_at: new Date(), revision: 5 }));
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  const reviewed = await (await getJob(request({}), { params: { id: "job" } }))!.json();
  // 展示之后涨价：100 → 120，虽然 120 仍低于用户给的 500 预算，旧确认也必须作废。
  process.env.VIDEO_H3_SEGMENT_QUOTE_COINS = "120";
  const writes: Query[] = [];
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  const response = await renderJob(request({ confirm_references: true, accept_estimate: true, max_coins: 500, review_token: reviewed.review_token }), { params: { id: "job" } });
  assert.ok(response);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "review_changed");
  assert.equal(writes.length, 0);
});

test("render is refused when references or motion windows changed after the review", async t => {
  fixture(t);
  env(t, { VIDEO_H3_SEGMENT_QUOTE_COINS: "100", VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", R2_ENDPOINT: "", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  const data = parseVideoReferenceInput(input, "product");
  data.sourceDuration = 4;
  data.segments = [{ index: 0, start: 0, duration: 4, trimStart: 0, clipKey: "videos/job/segments/0/source.mp4" }];
  data.referenceImages = data.referenceImages!.map((ref, i) => ({ ...ref, key: `videos/job/references/${i}.png`, sha256: "a".repeat(64) }));
  stub(t, prisma.generationJob, "findFirst", () => null);
  stub(t, prisma.videoJob, "findFirst", () => ({ id: "job", user_id: "owner", phase: "prepare_references", status: "review", data,
    created_at: new Date(), updated_at: new Date(), revision: 5 }));
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  const reviewed = await (await getJob(request({}), { params: { id: "job" } }))!.json();
  const writes: Query[] = [];
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  // 展示后参考图快照变化
  const original = data.referenceImages![1].sha256;
  data.referenceImages = data.referenceImages!.map((ref, i) => i === 1 ? { ...ref, sha256: "b".repeat(64) } : ref);
  const afterReference = await renderJob(request({ confirm_references: true, accept_estimate: true, max_coins: 100, review_token: reviewed.review_token }), { params: { id: "job" } });
  assert.equal(afterReference!.status, 409);
  assert.equal((await afterReference!.json()).error, "review_changed");
  data.referenceImages = data.referenceImages!.map((ref, i) => i === 1 ? { ...ref, sha256: original } : ref);
  // 展示后动作窗口变化（trimStart 变了，等于要生成的片段不是当初确认的那一段）
  data.segments = [{ ...data.segments[0], trimStart: 1 }];
  const afterWindow = await renderJob(request({ confirm_references: true, accept_estimate: true, max_coins: 100, review_token: reviewed.review_token }), { params: { id: "job" } });
  assert.equal(afterWindow!.status, 409);
  assert.equal(writes.length, 0);
});

test("render without a review token is refused and never queues a paid attempt", async t => {
  fixture(t);
  env(t, { VIDEO_H3_SEGMENT_QUOTE_COINS: "100", VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", R2_ENDPOINT: "", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  const data = parseVideoReferenceInput(input, "product");
  data.sourceDuration = 4;
  data.segments = [{ index: 0, start: 0, duration: 4, trimStart: 0, clipKey: "videos/job/segments/0/source.mp4" }];
  data.referenceImages = data.referenceImages!.map((ref, i) => ({ ...ref, key: `videos/job/references/${i}.png`, sha256: "a".repeat(64) }));
  stub(t, prisma.generationJob, "findFirst", () => null);
  stub(t, prisma.videoJob, "findFirst", () => ({ id: "job", user_id: "owner", phase: "prepare_references", status: "review", data,
    created_at: new Date(), updated_at: new Date(), revision: 5 }));
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  const writes: Query[] = [];
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  const response = await renderJob(request({ confirm_references: true, accept_estimate: true, max_coins: 100 }), { params: { id: "job" } });
  assert.equal(response!.status, 400);
  assert.equal((await response!.json()).error, "review_token_required");
  assert.equal(writes.length, 0);
});

test("receipt recovery readiness does not need an image provider, while legacy preparation still does", async t => {
  env(t, { VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", VIDEO_STORAGE_DIR: ".unit-test-unused" });
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: true }));
  await assert.doesNotReject(requireVideoWorker(true, false));
  await assert.rejects(requireVideoWorker(true), /图片/);
});
