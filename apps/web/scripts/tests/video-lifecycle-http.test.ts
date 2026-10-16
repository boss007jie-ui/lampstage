import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { requestAsyncStorage, type RequestStore } from "next/dist/client/components/request-async-storage.external";
import { prisma } from "../../lib/db";
import { lifecycleTransaction, stubMethod } from "./lifecycle-route-fixture";
import { GET as bearerUsage } from "../../app/api/v1/account/usage/route";
import { GET as bearerList, POST as createJob } from "../../app/api/v1/video-jobs/route";
import { POST as bearerCancel } from "../../app/api/v1/video-jobs/[id]/cancel/route";
import { POST as prepareJob } from "../../app/api/v1/video-jobs/[id]/prepare/route";
import { GET as sessionList } from "../../app/api/account/video-jobs/route";
import { POST as sessionCancel } from "../../app/api/account/video-jobs/[id]/cancel/route";
import { POST as nativeCreate } from "../../app/api/videos/projects/route";
import { POST as nativePrepare } from "../../app/api/videos/projects/[id]/prepare/route";

type Job = {
  id: string; user_id: string; title: string; status: string; stage: string; phase: string; revision: number;
  source_asset_id: string; product_asset_id: string; instructions: string; preserve_audio: boolean;
  lease_owner: string | null; lease_until: Date | null; error: string | null;
  created_at: Date; updated_at: Date; data: Record<string, unknown>;
};
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 11, minutes));
const initial = () => ({ version: 1, segments: [], imageCalls: 0 });
function row(id: string, status = "draft", user_id = "owner", minutes = 0): Job {
  return { id, user_id, title: id, status, stage: status, phase: "prepare", revision: 0,
    source_asset_id: "source", product_asset_id: "product", instructions: "", preserve_audio: true,
    lease_owner: null, lease_until: null, error: null, created_at: at(minutes), updated_at: at(minutes), data: initial() };
}
type Where = Record<string, any>;
function matches(job: Job, where: Where = {}): boolean {
  if (where.user_id && job.user_id !== where.user_id) return false;
  if (where.id && (typeof where.id === "string" ? job.id !== where.id :
    where.id.in ? !where.id.in.includes(job.id) : where.id.lt ? !(job.id < where.id.lt) : false)) return false;
  if (where.status && (typeof where.status === "string" ? job.status !== where.status :
    where.status.in ? !where.status.in.includes(job.status) : where.status.notIn?.includes(job.status))) return false;
  if (where.created_at instanceof Date && job.created_at.getTime() !== where.created_at.getTime()) return false;
  if (where.created_at?.lte && job.created_at > where.created_at.lte) return false;
  if (where.OR && !where.OR.some((part: Where) => matches(job, part))) return false;
  if (where.created_at?.lt && !(job.created_at < where.created_at.lt)) return false;
  if (where.id?.lt && !(job.id < where.id.lt)) return false;
  return true;
}
function fixture(t: TestContext, jobs: Job[] = [], signedIn = true) {
  lifecycleTransaction(t);
  t.mock.method(requestAsyncStorage, "getStore", () => ({
    cookies: { get: () => signedIn ? { name: "lamp_session", value: "fixture-session" } : undefined },
  }) as unknown as RequestStore);
  stubMethod(t, prisma.session, "findUnique", async () => ({ id: "fixture-session", expires_at: new Date("2099-01-01"), user: { id: "owner", role: "ADMIN", email: null } }));
  stubMethod(t, prisma.apiKey, "findUnique", async () => ({ id: "fixture-key", revoked_at: null, user: { id: "owner" } }));
  stubMethod(t, prisma.apiKey, "update", async () => ({}));
  stubMethod(t, prisma.videoJob, "findFirst", async ({ where }: { where: Where }) => jobs.find(job => matches(job, where)) ?? null);
  stubMethod(t, prisma.videoJob, "findMany", async ({ where, take, orderBy }: { where: Where; take?: number; orderBy?: unknown }) => {
    // The write-side expiry query is allowed, but these fresh fixture rows cannot expire.
    const found = jobs.filter(job => matches(job, where));
    if (orderBy) found.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id));
    return found.slice(0, take ?? found.length);
  });
  stubMethod(t, prisma.videoJob, "groupBy", async ({ where }: { where: Where }) => {
    const groups = new Map<string, number>();
    for (const job of jobs.filter(job => matches(job, where))) groups.set(job.status, (groups.get(job.status) ?? 0) + 1);
    return [...groups].map(([status, count]) => ({ status, _count: { _all: count } }));
  });
  stubMethod(t, prisma.videoPermit, "findMany", async () => []);
  let writes = 0;
  stubMethod(t, prisma.videoJob, "updateMany", async ({ where, data }: { where: Where; data: Where }) => {
    const job = jobs.find(candidate => matches(candidate, where) && (where.revision === undefined || candidate.revision === where.revision));
    if (!job) return { count: 0 };
    Object.assign(job, data, { revision: job.revision + 1, updated_at: at(59) });
    writes++;
    return { count: 1 };
  });
  stubMethod(t, prisma.videoJob, "create", async ({ data }: { data: Where }) => {
    const job = { ...row(`created-${jobs.length}`), ...data } as Job;
    jobs.push(job); writes++;
    return job;
  });
  stubMethod(t, prisma.videoAsset, "findFirst", async () => ({ id: "source", user_id: "owner" }));
  stubMethod(t, prisma.uploadedAsset, "findFirst", async () => ({ id: "product", user_id: "owner", width: 768, height: 1280 }));
  stubMethod(t, prisma.uploadedAsset, "findMany", async () => []);
  stubMethod(t, prisma.videoWorker, "findFirst", async () => ({ image_ready: true, video_ready: true, sixref_ready: true }));
  for (const [name, value] of Object.entries({ VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true", VIDEO_STORAGE_DIR: ".unit-test-unused" })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  return { jobs, get writes() { return writes; } };
}
const bearer = (path: string, method = "GET") => new NextRequest(`https://lampstage.com${path}`, {
  method, headers: { authorization: "Bearer lmp_live_fixture", ...(method === "POST" ? { origin: "https://lampstage.com" } : {}) },
});
const session = (path: string, origin?: string) => new NextRequest(`https://lampstage.com${path}`, {
  method: origin === undefined ? "GET" : "POST", headers: origin ? { origin } : {},
});
const native = (path: string, body?: unknown) => new NextRequest(`https://lampstage.com${path}`, {
  method: "POST", headers: { origin: "https://lampstage.com", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const noStore = (response: Response) => assert.match(response.headers.get("cache-control") ?? "", /no-store/);

test("management routes reject unauthenticated requests and never cache responses", async t => {
  fixture(t, [], false);
  for (const response of [
    await bearerUsage(new NextRequest("https://lampstage.com/api/v1/account/usage")),
    await bearerList(new NextRequest("https://lampstage.com/api/v1/video-jobs")),
    await sessionList(session("/api/account/video-jobs")),
    await sessionCancel(session("/api/account/video-jobs/one/cancel", "https://lampstage.com"), { params: { id: "one" } }),
  ]) { assert.equal(response.status, 401); noStore(response); }
});

test("owner sees independent account totals, stable pages and filters without beta eligibility", async t => {
  const jobs = [row("a", "draft", "owner", 4), row("b", "queued", "owner", 3), row("c", "completed", "owner", 2),
    row("d", "mystery", "owner", 1), row("foreign", "draft", "other", 5)];
  fixture(t, jobs);
  const usageResponse = await bearerUsage(bearer("/api/v1/account/usage"));
  noStore(usageResponse);
  const usage = (await usageResponse.json()).usage;
  assert.equal(usage.drafts.count, 1);
  assert.equal(usage.active.count, 2);
  assert.equal(usage.active.includes_unknown_statuses, true);
  const first = await bearerList(bearer("/api/v1/video-jobs?limit=2"));
  noStore(first);
  const page1 = await first.json();
  assert.deepEqual(page1.jobs.map((job: Job) => job.id), ["a", "b"]);
  assert.equal(page1.usage.active.count, 2);
  const second = await bearerList(bearer(`/api/v1/video-jobs?limit=2&cursor=${page1.next_cursor}`));
  assert.deepEqual((await second.json()).jobs.map((job: Job) => job.id), ["c", "d"]);
  const active = await bearerList(bearer("/api/v1/video-jobs?status=active"));
  assert.deepEqual((await active.json()).jobs.map((job: Job) => job.id), ["b", "d"]);
  const signedIn = await sessionList(session("/api/account/video-jobs?status=draft"));
  noStore(signedIn);
  assert.deepEqual((await signedIn.json()).jobs.map((job: Job) => job.id), ["a"]);
  assert.equal(jobs[0].status, "draft"); // GET does not expire or mutate.
});

test("management rejects malformed query and hides foreign or missing IDs", async t => {
  fixture(t, [row("foreign", "draft", "other")]);
  for (const query of ["status=bogus", "limit=0", "limit=1.5", "cursor=bad!"]) {
    const response = await bearerList(bearer(`/api/v1/video-jobs?${query}`));
    assert.equal(response.status, 400);
    noStore(response);
  }
  for (const id of ["foreign", "missing"]) {
    const response = await bearerCancel(bearer(`/api/v1/video-jobs/${id}/cancel`, "POST"), { params: { id } });
    assert.equal(response.status, 404);
    noStore(response);
  }
});

test("session cancellation requires exact same origin and preserves owner cancellation audit on retry", async t => {
  const f = fixture(t, [row("own")]);
  for (const origin of [undefined, "https://attacker.example", "http://lampstage.com"]) {
    const request = new NextRequest("https://lampstage.com/api/account/video-jobs/own/cancel", { method: "POST", headers: origin ? { origin } : {} });
    const response = await sessionCancel(request, { params: { id: "own" } });
    assert.equal(response.status, 403);
    noStore(response);
  }
  assert.equal(f.writes, 0);
  const first = await sessionCancel(session("/api/account/video-jobs/own/cancel", "https://lampstage.com"), { params: { id: "own" } });
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.job.cancellation_reason, "user_cancelled");
  assert.equal(result.usage.drafts.count, 0);
  const timestamp = result.job.cancelled_at;
  const again = await sessionCancel(session("/api/account/video-jobs/own/cancel", "https://lampstage.com"), { params: { id: "own" } });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).job.cancelled_at, timestamp);
  assert.equal(f.writes, 1);
});

test("bearer cancellation returns a safe conflict for protected drafts and succeeds for an owned draft", async t => {
  const unsafe = row("protected");
  unsafe.revision = 1;
  const f = fixture(t, [unsafe, row("owned")]);
  const conflict = await bearerCancel(bearer("/api/v1/video-jobs/protected/cancel", "POST"), { params: { id: "protected" } });
  assert.equal(conflict.status, 409);
  noStore(conflict);
  const blocked = await conflict.json();
  assert.equal(blocked.error, "video_job_not_cancellable");
  assert.equal(blocked.reason, "state_changed");
  assert.equal(blocked.job.can_cancel, false);
  assert.equal(blocked.job.draft_expires_at, null);
  assert.equal(f.writes, 0);
  const cancelled = await bearerCancel(bearer("/api/v1/video-jobs/owned/cancel", "POST"), { params: { id: "owned" } });
  assert.equal(cancelled.status, 200);
  noStore(cancelled);
  assert.equal((await cancelled.json()).job.cancellation_reason, "user_cancelled");
  assert.equal(f.writes, 1);
});

test("active quota returns structured 429 and cancelled prepare returns terminal 409", async t => {
  const jobs = [row("target"), ...Array.from({ length: 10 }, (_, i) => row(`active-${i}`, "queued"))];
  fixture(t, jobs);
  const response = await prepareJob(bearer("/api/v1/video-jobs/target/prepare", "POST"), { params: { id: "target" } });
  assert.equal(response.status, 429);
  noStore(response);
  const quota = await response.json();
  assert.equal(quota.error, "video_job_limit_reached");
  assert.equal(quota.quota_bucket, "active");
  assert.equal(quota.count, 10);
  assert.equal(quota.retryable, false);
  assert.ok(!quota.actions.includes("cancel_video_job"));
  jobs[0].status = "cancelled";
  jobs[0].data = { ...initial(), cancellation: { at: at(20).toISOString(), reason: "user_cancelled" } };
  const cancelled = await prepareJob(bearer("/api/v1/video-jobs/target/prepare", "POST"), { params: { id: "target" } });
  assert.equal(cancelled.status, 409);
  noStore(cancelled);
  assert.equal((await cancelled.json()).error, "video_job_cancelled");
});

test("draft capacity returns a structured 429 without creating another row", async t => {
  const f = fixture(t, Array.from({ length: 10 }, (_, i) => row(`draft-${i}`)));
  const response = await createJob(new NextRequest("https://lampstage.com/api/v1/video-jobs", {
    method: "POST", headers: { authorization: "Bearer lmp_live_fixture", "Content-Type": "application/json" },
    body: JSON.stringify({ source_asset_id: "source", product_asset_id: "product", generation_mode: "legacy_frames" }),
  }));
  assert.equal(response.status, 429);
  noStore(response);
  const body = await response.json();
  assert.equal(body.error, "video_draft_limit_reached");
  assert.equal(body.quota_bucket, "draft");
  assert.equal(body.count, 10);
  assert.equal(body.usage.drafts.remaining, 0);
  assert.ok(body.actions.includes("cancel_video_job"));
  assert.equal(f.writes, 0);
});

test("native session create uses the same draft limit and structured 429", async t => {
  const f = fixture(t, Array.from({ length: 10 }, (_, i) => row(`draft-${i}`)));
  const response = await nativeCreate(native("/api/videos/projects", {
    source_asset_id: "source", product_asset_id: "product", generation_mode: "legacy_frames", preserve_audio: true,
  }));
  assert.equal(response.status, 429);
  noStore(response);
  const body = await response.json();
  assert.equal(body.error, "video_draft_limit_reached");
  assert.equal(body.quota_bucket, "draft");
  assert.equal(body.count, 10);
  assert.equal(body.usage.drafts.remaining, 0);
  assert.equal(f.writes, 0);
});

test("native session prepare uses active quota and rejects cancelled tasks", async t => {
  const jobs = [row("target"), ...Array.from({ length: 10 }, (_, i) => row(`active-${i}`, "queued"))];
  const f = fixture(t, jobs);
  const route = { params: { id: "target" } };
  const response = await nativePrepare(native("/api/videos/projects/target/prepare"), route);
  assert.equal(response.status, 429);
  noStore(response);
  const quota = await response.json();
  assert.equal(quota.error, "video_job_limit_reached");
  assert.equal(quota.quota_bucket, "active");
  assert.equal(quota.count, 10);
  assert.equal(quota.retryable, false);
  assert.ok(!quota.actions.includes("cancel_video_job"));
  assert.equal(f.writes, 0);
  jobs[0].status = "cancelled";
  jobs[0].data = { ...initial(), cancellation: { at: at(20).toISOString(), reason: "user_cancelled" } };
  const cancelled = await nativePrepare(native("/api/videos/projects/target/prepare"), route);
  assert.equal(cancelled.status, 409);
  noStore(cancelled);
  assert.equal((await cancelled.json()).error, "video_job_cancelled");
  assert.equal(f.writes, 0);
});

test("both prepare routes expire safe old drafts even when the worker is unavailable", async t => {
  const expiredPublic = row("expired-public");
  const expiredNative = row("expired-native");
  for (const job of [expiredPublic, expiredNative]) job.created_at = new Date("2026-10-14T11:59:00.000Z");
  const freshPublic = row("fresh-public");
  const freshNative = row("fresh-native");
  const f = fixture(t, [expiredPublic, expiredNative, freshPublic, freshNative]);
  process.env.VIDEO_WORKER_PAUSED = "true";
  const cases = [
    { job: expiredPublic, call: () => prepareJob(bearer("/api/v1/video-jobs/expired-public/prepare", "POST"), { params: { id: expiredPublic.id } }) },
    { job: expiredNative, call: () => nativePrepare(native("/api/videos/projects/expired-native/prepare"), { params: { id: expiredNative.id } }) },
  ];
  for (const item of cases) {
    const response = await item.call();
    assert.equal(response.status, 409);
    noStore(response);
    const result = await response.json();
    assert.equal(result.error, "video_job_cancelled");
    assert.equal(result.job.cancellation_reason, "draft_expired");
    assert.equal(item.job.status, "cancelled");
    assert.equal(item.job.data.cancellation && (item.job.data.cancellation as { reason: string }).reason, "draft_expired");
  }
  assert.equal(f.writes, 2);
  for (const response of [
    await prepareJob(bearer("/api/v1/video-jobs/fresh-public/prepare", "POST"), { params: { id: freshPublic.id } }),
    await nativePrepare(native("/api/videos/projects/fresh-native/prepare"), { params: { id: freshNative.id } }),
  ]) {
    assert.equal(response.status, 503);
    noStore(response);
    assert.equal((await response.json()).error, "video_worker_unavailable");
  }
  assert.equal(f.writes, 2);
  assert.equal(freshPublic.status, "draft");
  assert.equal(freshNative.status, "draft");
});
