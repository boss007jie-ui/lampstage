import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../../lib/db";
import { POST as createJobRaw } from "../../app/api/v1/video-jobs/route";
import { POST as prepareJobRaw } from "../../app/api/v1/video-jobs/[id]/prepare/route";
import { POST as renderJobRaw } from "../../app/api/v1/video-jobs/[id]/render/route";
import { POST as reviewJobRaw } from "../../app/api/v1/video-jobs/[id]/review/route";
import { POST as assembleJobRaw } from "../../app/api/v1/video-jobs/[id]/assemble/route";
import { POST as reconcileJobRaw } from "../../app/api/v1/video-jobs/[id]/reconcile/route";
import { GET as getJobRaw } from "../../app/api/v1/jobs/[id]/route";
import { parseSixReferencePlan } from "../../lib/video/six-reference-plan";
import type { VideoJobData } from "../../lib/video/types";
import { lifecycleTransaction } from "./lifecycle-route-fixture";

type Query = { where: Record<string, unknown>; data?: Record<string, unknown> };
async function mustResponse(value: Promise<Response | undefined>): Promise<Response> { const result = await value; assert.ok(result); return result; }
const createJob = (...args: Parameters<typeof createJobRaw>) => mustResponse(createJobRaw(...args));
const prepareJob = (...args: Parameters<typeof prepareJobRaw>) => mustResponse(prepareJobRaw(...args));
const renderJob = (...args: Parameters<typeof renderJobRaw>) => mustResponse(renderJobRaw(...args));
const reviewJob = (...args: Parameters<typeof reviewJobRaw>) => mustResponse(reviewJobRaw(...args));
const assembleJob = (...args: Parameters<typeof assembleJobRaw>) => mustResponse(assembleJobRaw(...args));
const reconcileJob = (...args: Parameters<typeof reconcileJobRaw>) => mustResponse(reconcileJobRaw(...args));
const getJob = (...args: Parameters<typeof getJobRaw>) => mustResponse(getJobRaw(...args));
const id = "job";
const sha = (character: string) => character.repeat(64);
const ref = (asset_id: string, role: string) => ({ asset_id, role, label: asset_id });
const plan = {
  source_asset_id: "source", generation_mode: "six_references", instructions: "Preserve garment and bedding.",
  reference_assets: [ref("opening", "start_state"), ref("baby", "character"), ref("garment", "product")],
  segment_plan: [
    { start: 0, source_duration: 5, duration: 5, instructions: "Put arms into sleeves.", before_state: "Sleeves empty.", after_state: "Sleeves on." },
    { start: 5, source_duration: 5, duration: 5, instructions: "Close the wrap.", before_state: "Wrap open.", after_state: "Wrap closed.", start_from_segment: 0 },
  ],
};
const route = { params: { id } };
const post = (path: string, body: unknown) => new NextRequest(`https://lampstage.com/api/v1/${path}`, { method: "POST",
  headers: { authorization: "Bearer lmp_live_unit_test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = () => new NextRequest(`https://lampstage.com/api/v1/jobs/${id}`, { headers: { authorization: "Bearer lmp_live_unit_test" } });

function stub(t: TestContext, model: object, method: string, callback: (query: Query) => unknown) {
  const delegate = model as Record<string, (query: Query) => Promise<unknown>>;
  const original = delegate[method];
  delegate[method] = async query => callback(query);
  t.after(() => { delegate[method] = original; });
}
function env(t: TestContext) {
  const values = { VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", VIDEO_STORAGE_DIR: ".unit-test-unused",
    R2_ENDPOINT: "", VIDEO_H3_SEGMENT_QUOTE_COINS: "999", VIDEO_SIXREF_SEGMENT_QUOTE_COINS: "42" };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function auth(t: TestContext) {
  stub(t, prisma.apiKey, "findUnique", () => ({ id: "test-key", revoked_at: null, user: { id: "owner" } }));
  stub(t, prisma.apiKey, "update", () => ({}));
}
function preparedData(): VideoJobData {
  const data = parseSixReferencePlan(plan);
  data.sourceDuration = 10;
  data.sourceHasAudio = true;
  data.referenceImages = data.referenceImages!.map((item, i) => ({ ...item, key: `videos/job/references/${i}.png`, sha256: sha("a") }));
  data.segments = data.segments.map((segment, index) => ({ ...segment, clipKey: `videos/job/segments/${index}/source.mp4`,
    referenceImages: segment.referenceImages!.map((item, i) => ({ ...item, key: `videos/job/segments/${index}/references/${i}.png`, sha256: sha("a") })) }));
  return data;
}
function jobFixture(t: TestContext, data = preparedData()) {
  auth(t); env(t);
  let row = { id, user_id: "owner", phase: "prepare_sixref", status: "review", data, revision: 5,
    lease_owner: null as string | null, lease_until: null as Date | null, error: null as string | null, stage: "review",
    created_at: new Date(), updated_at: new Date() };
  const writes: Query[] = [];
  stub(t, prisma.generationJob, "findFirst", () => null);
  stub(t, prisma.videoJob, "findFirst", () => row);
  stub(t, prisma.videoJob, "updateMany", query => {
    writes.push(query);
    row = { ...row, ...query.data, revision: row.revision + 1 } as typeof row;
    return { count: 1 };
  });
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: false, sixref_ready: true }));
  return { writes, row: () => row };
}

test("six-reference create accepts one or six ordered images without product_asset_id; override ownership is checked before create", async t => {
  auth(t);
  lifecycleTransaction(t);
  const writes: Query[] = [];
  const missing = "other-owner";
  stub(t, prisma.videoAsset, "findFirst", () => ({ id: "source", user_id: "owner" }));
  stub(t, prisma.uploadedAsset, "findFirst", query => ({ id: query.where.id, user_id: "owner" }));
  stub(t, prisma.uploadedAsset, "findMany", query => (query.where.id as { in: string[] }).in.filter(x => x !== missing).map(x => ({ id: x })));
  stub(t, prisma.videoJob, "count", () => 0);
  stub(t, prisma.videoJob, "create", query => { writes.push(query); return { id, status: "draft" }; });
  for (const references of [[ref("one", "start_state")], [ref("opening", "start_state"), ref("baby", "character"), ref("garment", "product"), ref("bed", "scene"), ref("detail", "product_detail"), ref("ending", "end_state")]]) {
    const body = { ...plan, reference_assets: references, segment_plan: [{ ...plan.segment_plan[0], reference_assets: references }, { ...plan.segment_plan[1], reference_assets: references }] };
    const response = await createJob(post("video-jobs", body));
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.deepEqual((await response.json()).reference_assets.map((r: { asset_id: string }) => r.asset_id), references.map(r => r.asset_id));
  }
  const writesBefore = writes.length;
  const bad = { ...plan, segment_plan: [{ ...plan.segment_plan[0], reference_assets: [ref("override-state", "start_state"), ref(missing, "scene")] }, plan.segment_plan[1]] };
  const response = await createJob(post("video-jobs", bad));
  assert.equal(response.status, 404);
  assert.equal(writes.length, writesBefore);
});
test("six-reference create rejects absent, later, duplicate or overridden start_state before persistence", async t => {
  auth(t);
  lifecycleTransaction(t);
  const writes: Query[] = [];
  stub(t, prisma.videoAsset, "findFirst", () => ({ id: "source", user_id: "owner" }));
  stub(t, prisma.uploadedAsset, "findMany", query => (query.where.id as { in: string[] }).in.map(id => ({ id })));
  stub(t, prisma.videoJob, "count", () => 0);
  stub(t, prisma.videoJob, "create", query => { writes.push(query); return { id, status: "draft" }; });
  const invalid = [
    [ref("baby", "character"), ref("garment", "product")],
    [ref("baby", "character"), ref("opening", "start_state")],
    [ref("opening", "start_state"), ref("second-opening", "start_state")],
  ];
  for (const references of invalid) {
    for (const body of [
      { ...plan, reference_assets: references },
      { ...plan, segment_plan: [{ ...plan.segment_plan[0], reference_assets: references }, plan.segment_plan[1]] },
    ]) {
      const response = await createJob(post("video-jobs", body));
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error, "invalid_video_references");
      assert.match(JSON.stringify(result), /start_state/);
    }
  }
  assert.equal(writes.length, 0);
});

test("six-reference prepare uses dedicated phase and requires sixref-ready worker", async t => {
  auth(t); env(t);
  lifecycleTransaction(t);
  const data = parseSixReferencePlan(plan);
  const writes: Query[] = [];
  let ready = false;
  stub(t, prisma.videoJob, "findFirst", () => ({ id, user_id: "owner", title: "商品视频", stage: "等待准备参考图", phase: "prepare", status: "draft", revision: 0,
    lease_owner: null, lease_until: null, error: null, created_at: new Date("2026-10-15T11:00:00Z"), updated_at: new Date("2026-10-15T11:00:00Z"), data }));
  stub(t, prisma.videoJob, "updateMany", query => { writes.push(query); return { count: 1 }; });
  stub(t, prisma.videoWorker, "findFirst", () => ({ image_ready: false, video_ready: false, sixref_ready: ready }));
  assert.equal((await prepareJob(post(`video-jobs/${id}/prepare`, {}), route)).status, 503);
  assert.equal(writes.length, 0);
  ready = true;
  assert.equal((await prepareJob(post(`video-jobs/${id}/prepare`, {}), route)).status, 202);
  assert.equal(writes[0].data!.phase, "prepare_sixref");
});

test("GET exposes per-segment references and actual tail metadata; dependency becomes ready only after acceptance", async t => {
  const data = preparedData();
  const first = data.segments[0];
  first.candidateKey = "videos/job/segments/0/candidate.mp4";
  first.candidateSha256 = sha("b");
  first.tailKey = "videos/job/segments/0/tail.png";
  first.tailSha256 = sha("c");
  jobFixture(t, data);
  let result = await (await getJob(get(), route)).json();
  assert.equal(result.references_ready, true);
  assert.deepEqual(result.ready_segment_indices, []);
  assert.match(result.candidate_review_token, /^[a-f0-9]{64}$/);
  assert.equal(result.segments[0].candidate_sha256, sha("b"));
  assert.equal(result.segments[0].tail_sha256, sha("c"));
  assert.equal(result.segments[1].start_from_segment, 0);
  assert.deepEqual(result.segments[1].reference_assets.map((r: { asset_id: string }) => r.asset_id), ["opening", "baby", "garment"]);
  first.accepted = true;
  result = await (await getJob(get(), route)).json();
  assert.deepEqual(result.ready_segment_indices, [1]);
});

test("render uses sixref quote for the ready wave and rejects missing or stale review tokens", async t => {
  const f = jobFixture(t);
  const reviewed = await (await getJob(get(), route)).json();
  assert.deepEqual(reviewed.ready_segment_indices, [0]);
  assert.equal(reviewed.estimate.video_coins, 42);
  assert.equal(reviewed.pricing_basis, "configured_quote");
  const body = { confirm_references: true, accept_estimate: true, max_coins: 42 };
  let response = await renderJob(post(`video-jobs/${id}/render`, body), route);
  assert.equal(response.status, 400);
  response = await renderJob(post(`video-jobs/${id}/render`, { ...body, review_token: sha("f") }), route);
  assert.equal(response.status, 409);
  assert.equal(f.writes.length, 0);
  response = await renderJob(post(`video-jobs/${id}/render`, { ...body, review_token: reviewed.review_token }), route);
  assert.equal(response.status, 202);
  assert.equal(f.writes[0].data!.phase, "render");
  assert.deepEqual((f.writes[0].data!.data as VideoJobData).renderConsent!.segmentIndices, [0]);
});

test("旧缺起态任务仍可查看，但准备和新提交在写入前明确拒绝", async t => {
  const data = preparedData();
  data.segments[0].referenceImages![0].role = "scene";
  const f = jobFixture(t, data);
  const reviewed = await (await getJob(get(), route)).json();
  const response = await renderJob(post(`video-jobs/${id}/render`, { confirm_references: true,
    accept_estimate: true, max_coins: 42, review_token: reviewed.review_token }), route);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_video_references");
  assert.equal(f.writes.length, 0);
  f.row().status = "draft";
  const prepared = await prepareJob(post(`video-jobs/${id}/prepare`, {}), route);
  assert.equal(prepared.status, 400);
  assert.equal((await prepared.json()).error, "invalid_video_references");
  assert.equal(f.writes.length, 0);
});

test("审阅时长不兼容返回具体安全原因，重复相同决定不会写入", async t => {
  const data = preparedData();
  const segment = data.segments[0];
  Object.assign(segment, { candidateKey: "videos/job/candidate.mp4", candidateSha256: sha("b"),
    tailKey: "videos/job/tail.png", tailSha256: sha("c"), candidateMedia: { duration: 6, width: 704, height: 1280 } });
  const f = jobFixture(t, data);
  const reviewed = await (await getJob(get(), route)).json();
  const response = await reviewJob(post(`video-jobs/${id}/review`, { candidate_review_token: reviewed.candidate_review_token,
    decisions: [{ segment_index: 0, candidate_sha256: sha("b"), action: "accept" }] }), route);
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.reason, "duration_incompatible");
  assert.equal(result.segment_index, 0);
  assert.equal(result.timing.actual_duration, 6);
  assert.equal(result.timing.visual_review_required, true);
  assert.equal(f.writes.length, 0);
});

test("candidate review binds exact hash and token, then assembly requires every accepted candidate", async t => {
  const data = preparedData();
  // 接受候选现在依据真实媒体时长；有效候选夹具必须带测量结果。
  for (const segment of data.segments) segment.candidateMedia = { duration: 5, width: 704, height: 1280 };
  data.segments[0].candidateKey = "videos/job/segments/0/candidate.mp4";
  data.segments[0].candidateSha256 = sha("b");
  data.segments[0].tailKey = "videos/job/segments/0/tail.png";
  data.segments[0].tailSha256 = sha("c");
  const f = jobFixture(t, data);
  const first = await (await getJob(get(), route)).json();
  const decision = [{ segment_index: 0, candidate_sha256: sha("b"), action: "accept" }];
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { candidate_review_token: sha("f"), decisions: decision }), route)).status, 409);
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { candidate_review_token: first.candidate_review_token, decisions: [{ ...decision[0], candidate_sha256: sha("d") }] }), route)).status, 400);
  assert.equal(f.writes.length, 0);
  assert.equal((await assembleJob(post(`video-jobs/${id}/assemble`, { candidate_review_token: first.candidate_review_token }), route)).status, 409);
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { candidate_review_token: first.candidate_review_token, decisions: decision }), route)).status, 200);
  assert.deepEqual((await (await getJob(get(), route)).json()).ready_segment_indices, [1]);
  const next = f.row().data.segments[1];
  next.candidateKey = "videos/job/segments/1/candidate.mp4";
  next.candidateSha256 = sha("d");
  next.tailKey = "videos/job/segments/1/tail.png";
  next.tailSha256 = sha("e");
  const second = await (await getJob(get(), route)).json();
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { candidate_review_token: second.candidate_review_token, decisions: [{ segment_index: 1, candidate_sha256: sha("d"), action: "accept" }] }), route)).status, 200);
  const finalReview = await (await getJob(get(), route)).json();
  assert.equal((await assembleJob(post(`video-jobs/${id}/assemble`, { candidate_review_token: second.candidate_review_token }), route)).status, 409);
  assert.equal((await assembleJob(post(`video-jobs/${id}/assemble`, { candidate_review_token: finalReview.candidate_review_token }), route)).status, 202);
  assert.equal(f.writes.at(-1)?.data!.phase, "assemble");
});

test("reconcile queues only a recorded unknown submission, without render consent or fresh generation", async t => {
  const data = preparedData();
  const f = jobFixture(t, data);
  f.row().status = "attention";
  assert.equal((await reconcileJob(post(`video-jobs/${id}/reconcile`, {}), route)).status, 409);
  assert.equal(f.writes.length, 0);
  data.segments[0].submissionIntentAt = new Date().toISOString();
  const response = await reconcileJob(post(`video-jobs/${id}/reconcile`, {}), route);
  assert.equal(response.status, 202);
  assert.equal(f.writes[0].data!.phase, "reconcile");
  assert.equal(f.writes[0].data!.status, "queued");
  assert.equal((f.writes[0].data!.data as unknown), undefined);
});

test("terminal failed candidate can be retried only with failed hash and a reason", async t => {
  const data = preparedData();
  data.segments[0].terminalFailure = true;
  data.segments[0].buildId = "existing-build";
  const f = jobFixture(t, data);
  const reviewed = await (await getJob(get(), route)).json();
  assert.equal(reviewed.segments[0].candidate_sha256, "failed");
  const base = { candidate_review_token: reviewed.candidate_review_token,
    decisions: [{ segment_index: 0, candidate_sha256: "failed", action: "retry" }] };
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, base), route)).status, 400);
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { ...base, decisions: [{ ...base.decisions[0], candidate_sha256: sha("f"), reason: "Provider failed." }] }), route)).status, 400);
  assert.equal(f.writes.length, 0);
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { ...base, decisions: [{ ...base.decisions[0], reason: "Provider failed." }] }), route)).status, 200);
  assert.equal(f.row().data.segments[0].attempt, 1);
  assert.equal(f.row().data.segments[0].buildId, undefined);
  assert.equal(f.row().data.segments[0].history?.[0].buildId, "existing-build");
});

test("candidate acceptance permits a reviewed leading trim only when kept duration stays in range", async t => {
  const data = preparedData();
  const segment = data.segments[0];
  segment.candidateKey = "videos/job/segments/0/candidate.mp4";
  segment.candidateSha256 = sha("b");
  segment.tailKey = "videos/job/segments/0/tail.png";
  segment.tailSha256 = sha("c");
  segment.candidateMedia = { duration: 5.5, width: 704, height: 1280 };
  const f = jobFixture(t, data);
  const reviewed = await (await getJob(get(), route)).json();
  const base = { candidate_review_token: reviewed.candidate_review_token,
    decisions: [{ segment_index: 0, candidate_sha256: sha("b"), action: "accept", trim_start: 0.5 }] };
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, { ...base, decisions: [{ ...base.decisions[0], trim_start: 1.5 }] }), route)).status, 400);
  assert.equal(f.writes.length, 0);
  assert.equal((await reviewJob(post(`video-jobs/${id}/review`, base), route)).status, 200);
  assert.equal(f.row().data.segments[0].candidateTrimStart, 0.5);
});
