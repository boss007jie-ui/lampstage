import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { requestAsyncStorage, type RequestStore } from "next/dist/client/components/request-async-storage.external";
import { prisma } from "../../lib/db";
import { stubMethod } from "./lifecycle-route-fixture";
import { POST as sessionClose } from "../../app/api/account/video-jobs/[id]/close/route";
import { POST as bearerClose } from "../../app/api/v1/video-jobs/[id]/close/route";
import { POST as render } from "../../app/api/v1/video-jobs/[id]/render/route";
import { POST as review } from "../../app/api/v1/video-jobs/[id]/review/route";
import { POST as assemble } from "../../app/api/v1/video-jobs/[id]/assemble/route";
import { POST as reconcile } from "../../app/api/v1/video-jobs/[id]/reconcile/route";
import { POST as prepare } from "../../app/api/v1/video-jobs/[id]/prepare/route";
import { POST as nativeGenerate } from "../../app/api/videos/projects/[id]/generate/route";
import { POST as nativeReconcile } from "../../app/api/videos/projects/[id]/reconcile/route";

const now = new Date("2026-10-16T12:00:00Z");
function fixture(t: TestContext, signedIn = true) {
  const job = { id: "owned", user_id: "owner", title: "retained task", status: "review", stage: "review", phase: "render",
    revision: 7, source_asset_id: "private-source", product_asset_id: "private-product", instructions: "keep",
    preserve_audio: true, lease_owner: null, lease_until: null, error: null, created_at: now, updated_at: now,
    data: { version: 1, generationMode: "six_references", workflowProfile: "sixref-v1", imageCalls: 0,
      segments: [{ index: 0, attempt: 0, candidateKey: "private/candidate.mp4", candidateSha256: "hash", accepted: false }] } as Record<string, unknown> };
  const foreign = { ...job, id: "foreign", user_id: "other" };
  const jobs = [job, foreign];
  let writes = 0, transactions = 0;
  t.mock.method(requestAsyncStorage, "getStore", () => ({ cookies: {
    get: () => signedIn ? { name: "lamp_session", value: "fixture-session" } : undefined,
  } }) as unknown as RequestStore);
  stubMethod(t, prisma.session, "findUnique", async () => ({ id: "fixture-session", expires_at: new Date("2099-01-01"),
    user: { id: "owner", role: "ADMIN", email: null } }));
  stubMethod(t, prisma.apiKey, "findUnique", async () => signedIn ? { id: "fixture-key", revoked_at: null, user: { id: "owner" } } : null);
  stubMethod(t, prisma.apiKey, "update", async () => ({}));
  stubMethod(t, prisma, "$transaction", async (callback: (tx: typeof prisma) => Promise<unknown>) => {
    transactions++; return callback(prisma);
  });
  stubMethod(t, prisma, "$queryRaw", async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("clock_timestamp")) return [{ now }];
    if (text.includes('FROM "User"')) return values[0] === "owner" ? [{ id: "owner" }] : [];
    if (text.includes('FROM "VideoJob"')) return jobs.filter(item => item.id === values[0] && item.user_id === values[1]).map(item => ({ id: item.id }));
    assert.fail("Unexpected raw database query");
  });
  stubMethod(t, prisma.videoJob, "findFirst", async ({ where }: { where: Record<string, unknown> }) =>
    jobs.find(item => item.id === where.id && (where.user_id === undefined || item.user_id === where.user_id)) ?? null);
  stubMethod(t, prisma.videoJob, "findMany", async () => []);
  stubMethod(t, prisma.videoPermit, "findMany", async () => []);
  stubMethod(t, prisma.videoJob, "groupBy", async ({ where }: { where: { user_id: string } }) =>
    jobs.filter(item => item.user_id === where.user_id).map(item => ({ status: item.status, _count: { _all: 1 } })));
  stubMethod(t, prisma.videoJob, "updateMany", async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const item = jobs.find(value => value.id === where.id && value.user_id === where.user_id &&
      value.status === where.status && value.revision === where.revision);
    if (!item) return { count: 0 };
    Object.assign(item, data, { revision: item.revision + 1, updated_at: now }); writes++;
    return { count: 1 };
  });
  return { job, foreign, get writes() { return writes; }, get transactions() { return transactions; } };
}
function request(kind: "session" | "bearer", body: string | undefined = '{"expected_revision":7}', origin?: string) {
  return new NextRequest("https://lampstage.com/api/" + (kind === "session" ? "account" : "v1") + "/video-jobs/owned/close", {
    method: "POST", headers: { "content-type": "application/json",
      ...(kind === "bearer" ? { authorization: "Bearer lmp_live_fixture" } : {}),
      ...(origin === undefined ? {} : { origin }) }, ...(body === undefined ? {} : { body }),
  });
}
const params = { params: { id: "owned" } };
const noStore = (response: Response) => assert.match(response.headers.get("cache-control") ?? "", /no-store/);

test("both close routes authenticate before parsing bodies and never cache rejection", async t => {
  const f = fixture(t, false);
  for (const [route, kind] of [[sessionClose, "session"], [bearerClose, "bearer"]] as const) {
    const response = await route(request(kind, "not-json", "https://lampstage.com"), params);
    assert.equal(response.status, 401); noStore(response);
  }
  assert.equal(f.transactions, 0); assert.equal(f.writes, 0);
});

test("session close requires exact same origin; bearer close does not accept a session substitute", async t => {
  const f = fixture(t);
  for (const origin of [undefined, "https://attacker.example", "http://lampstage.com", "https://lampstage.com.attacker.example"]) {
    const response = await sessionClose(request("session", '{"expected_revision":7}', origin), params);
    assert.equal(response.status, 403); noStore(response);
  }
  const bearerWithoutKey = await bearerClose(request("session", '{"expected_revision":7}', "https://lampstage.com"), params);
  assert.equal(bearerWithoutKey.status, 401);
  assert.equal(f.transactions, 0); assert.equal(f.writes, 0);
});

test("body contract rejects missing, malformed, extra and streamed oversized input before database writes", async t => {
  const f = fixture(t);
  for (const body of ["", "not-json", "null", "[]", "{}", '{"expected_revision":-1}', '{"expected_revision":1.5}',
    '{"expected_revision":"7"}', '{"expected_revision":9007199254740992}', '{"expected_revision":7,"user_id":"other"}']) {
    const response = await bearerClose(request("bearer", body), params);
    assert.equal(response.status, 400, body); noStore(response);
  }
  for (const route of [sessionClose, bearerClose]) {
    const response = await route(request(route === sessionClose ? "session" : "bearer",
      '{"expected_revision":7,"padding":"' + "x".repeat(4096) + '"}', "https://lampstage.com"), params);
    assert.equal(response.status, 413); noStore(response);
  }
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1025)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("https://lampstage.com/api/v1/video-jobs/owned/close", {
    method: "POST", headers: { authorization: "Bearer lmp_live_fixture" }, body: stream, duplex: "half",
  } as RequestInit);
  const response = await bearerClose(streamed, params);
  assert.equal(response.status, 413); assert.equal(cancelled, true);
  assert.equal(f.transactions, 0); assert.equal(f.writes, 0);
});

test("both routes hide foreign/missing jobs and return stale-revision conflicts", async t => {
  const f = fixture(t);
  for (const route of [sessionClose, bearerClose]) {
    const kind = route === sessionClose ? "session" : "bearer";
    for (const id of ["foreign", "missing"]) {
      const response = await route(request(kind, '{"expected_revision":7}', "https://lampstage.com"), { params: { id } });
      assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "not_found" }); noStore(response);
    }
    const stale = await route(request(kind, '{"expected_revision":6}', "https://lampstage.com"), params);
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error, "job_state_changed");
  }
  assert.equal(f.writes, 0);
});

test("successful close and replay preserve materials, expose safe summary, and terminal routes cannot revive it", async t => {
  const f = fixture(t);
  const before = structuredClone(f.job.data);
  const first = await sessionClose(request("session", '{"expected_revision":7}', "https://lampstage.com"), params);
  assert.equal(first.status, 200); noStore(first);
  const body = await first.json();
  assert.equal(body.job.cancellation_reason, "user_closed");
  assert.equal(body.job.can_close, false); assert.equal(body.job.counts_toward_limit, false);
  assert.equal(body.usage.active.count, 0);
  assert.ok(!JSON.stringify(body).includes("private/")); assert.ok(!JSON.stringify(body).includes("original instructions"));
  const { cancellation, ...retained } = f.job.data;
  assert.deepEqual(retained, before); assert.ok(cancellation);
  const replay = await bearerClose(request("bearer"), params);
  assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), body);
  for (const route of [render, review, assemble, reconcile, prepare]) {
    const response = await route(request("bearer", "{}"), params);
    assert.ok(response);
    assert.equal(response.status, 409); noStore(response);
  }
  for (const route of [nativeGenerate, nativeReconcile]) {
    const response = await route(request("session", "{}", "https://lampstage.com"), params);
    assert.equal(response.status, 409);
  }
  assert.equal(f.writes, 1); assert.equal(f.job.status, "cancelled"); assert.equal(f.foreign.status, "review");
});
