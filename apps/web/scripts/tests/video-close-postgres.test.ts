import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";

const enabled = process.env.RUN_VIDEO_DATABASE_TESTS === "1" && process.platform === "win32";
const fixedTime = new Date("2026-10-16T12:00:00Z");
const baseData = () => ({ version: 1, generationMode: "six_references", workflowProfile: "sixref-v1",
  imageCalls: 0, segments: [{ index: 0, attempt: 0, duration: 5 }] });
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { entered, enter, ready, release };
}
/** Hold a real Job row lock, so competing transactions must wait in PostgreSQL. */
function gatedClient(db: PrismaClient, lock: ReturnType<typeof gate>): PrismaClient {
  return new Proxy(db, { get(target, key) {
    if (key !== "$transaction") {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) =>
      target.$transaction(async tx => callback(new Proxy(tx, { get(real, member) {
        if (member === "$queryRaw") return async (...args: unknown[]) => {
          const result = await Reflect.apply(real.$queryRaw, real, args);
          if (String((args[0] as TemplateStringsArray)[0]).includes('FROM "VideoJob"')) {
            lock.enter(); await lock.ready;
          }
          return result;
        };
        const value = Reflect.get(real, member, real);
        return typeof value === "function" ? value.bind(real) : value;
      } })), options as never);
  } }) as PrismaClient;
}
async function waitingOnLock(db: PrismaClient) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (rows[0].count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Competing operation did not wait on the shared PostgreSQL row lock");
}

test("isolated PostgreSQL closes only proven-quiescent owned jobs and fences concurrent work",
  { skip: !enabled, timeout: 180000 }, async t => {
  const { closeVideoJob, getVideoJobUsage, listVideoJobs, prepareVideoDraft } = await import("../../lib/video/job-quota");
  const { acquireVideoPermit, adoptExistingVideoPermit, VideoPermitSubmissionBlockedError } = await import("../../lib/video/permits");
  const { claimJob, patchJob, heartbeatLease, LeaseLostError } = await import("../../lib/video/repository");
  const cluster = await isolatedVideoPostgres();
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const db = client();
  const seed = async (id: string, extra: Partial<Prisma.VideoJobUncheckedCreateInput> = {}) => {
    const owner = typeof extra.user_id === "string" ? extra.user_id : "owner";
    // The shared isolated fixture deliberately uses a TEXT role rather than production enums.
    await db.$executeRawUnsafe('INSERT INTO "User" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING', owner);
    return db.videoJob.create({ data: { id, user_id: owner, source_asset_id: "private-source",
      product_asset_id: "private-product", title: id, instructions: "original instructions", preserve_audio: true,
      status: "review", phase: "render", stage: "original stage", revision: 7, data: baseData(), ...extra } });
  };
  const permit = async (jobId: string, status: string, attempt = 0) => db.videoPermit.create({ data: {
    account_id: "account-" + jobId, attempt_id: jobId + ":0:" + attempt, job_id: jobId, segment_index: 0,
    reserved_coins: null, max_coins: 100, status, released_at: status === "released" ? fixedTime : null,
  } });
  const request = (jobId: string) => ({ accountId: "account-" + jobId, attemptId: jobId + ":0:0",
    jobId, segmentIndex: 0, reservedCoins: null, maxCoins: 100 });
  const close = (jobId: string, revision = 7, chosen = db, owner = "owner") =>
    closeVideoJob(owner, jobId, revision, { db: chosen, now: fixedTime });
  const denied = (result: Awaited<ReturnType<typeof close>>, error: string, reason?: string) => {
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409); assert.equal(result.body.error, error);
      if (reason) assert.equal(result.body.reason, reason);
    }
  };
  try {
    await db.$executeRawUnsafe('CREATE TABLE "VideoPermitAccount" ("id" TEXT PRIMARY KEY, "lock_version" INTEGER NOT NULL DEFAULT 0)');

    await t.test("foreign and missing jobs return 404; stale revisions never mutate", async () => {
      await seed("foreign", { user_id: "other" }); await seed("own");
      for (const id of ["foreign", "missing"]) {
        const result = await close(id);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.status, 404);
      }
      const before = await db.videoJob.findUniqueOrThrow({ where: { id: "own" } });
      denied(await close("own", 6), "job_state_changed");
      assert.deepEqual(await db.videoJob.findUniqueOrThrow({ where: { id: "own" } }), before);
    });

    await t.test("leases, unresolved permits and current/history/image intents prevent closure", async () => {
      const cases: Array<{ id: string; extra?: Partial<Prisma.VideoJobUncheckedCreateInput>; permit?: string; reason: string }> = [
        { id: "lease-owner", extra: { lease_owner: "old-worker" }, reason: "lease_present" },
        { id: "lease-expired", extra: { lease_until: new Date(0) }, reason: "lease_present" },
        { id: "lease-both", extra: { lease_owner: "old-worker", lease_until: new Date(0) }, reason: "lease_present" },
        { id: "permit-active", permit: "active", reason: "unreleased_permit" },
        { id: "permit-unknown", permit: "unknown", reason: "unreleased_permit" },
        { id: "pending-current", extra: { status: "attention", data: { ...baseData(), segments: [{ index: 0, attempt: 0, submissionIntentAt: fixedTime.toISOString() }] } }, reason: "unresolved_submission" },
        { id: "pending-history", extra: { data: { ...baseData(), segments: [{ index: 0, attempt: 1, history: [{ attempt: 0, buildId: "old-build", reason: "retry" }] }] } }, reason: "unresolved_submission" },
        { id: "pending-image", extra: { status: "attention", phase: "prepare", data: { version: 1, imageCalls: 2, segments: [{ index: 0, openingKey: "saved" }] } }, reason: "unresolved_image_submission" },
      ];
      for (const entry of cases) {
        await seed(entry.id, entry.extra);
        if (entry.permit) await permit(entry.id, entry.permit);
        const before = await db.videoJob.findUniqueOrThrow({ where: { id: entry.id } });
        denied(await close(entry.id), "video_job_not_closable", entry.reason);
        assert.deepEqual(await db.videoJob.findUniqueOrThrow({ where: { id: entry.id } }), before);
      }
    });

    await t.test("close retains business records and releases quota exactly once; selected draft stays unchanged", async () => {
      const owner = "retention-owner";
      const records = { ...baseData(), referenceImages: [{ assetId: "image-a", key: "private/ref.png", sha256: "ref-hash" }],
        usage: { imageCalls: 0, tokens: null, actual_cost: null }, renderConsent: { maxCoins: 100, estimatedCoins: null },
        outputKey: "private/output.mp4", outputSha256: "output-hash", progress: { lastProgressAt: fixedTime.toISOString() },
        segments: [{ index: 0, attempt: 1, candidateKey: "private/current.mp4", accepted: false, buildId: "build-current",
          history: [{ attempt: 0, buildId: "old-build", candidateKey: "private/old.mp4", reason: "quality revision" }] }] };
      const original = await seed("retain", { user_id: owner, status: "attention", phase: "assemble", error: "original error", data: records });
      await permit("retain", "released", 0); await permit("retain", "released", 1);
      const permitBefore = await db.videoPermit.findMany({ where: { job_id: "retain" }, orderBy: { attempt_id: "asc" } });
      const draft = await seed("current-draft-v6", { user_id: owner, status: "draft", phase: "prepare", revision: 0 });
      assert.equal((await getVideoJobUsage(owner, { db })).active.count, 1);
      const result = await close("retain", 7, db, owner); assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.usage.active.count, 0); assert.equal(result.value.usage.drafts.count, 1);
        assert.equal(result.value.job.cancellation_reason, "user_closed");
      }
      const after = await db.videoJob.findUniqueOrThrow({ where: { id: "retain" } });
      const { cancellation, ...retained } = after.data as typeof records & { cancellation: unknown };
      assert.deepEqual(retained, records);
      assert.deepEqual(cancellation, { at: fixedTime.toISOString(), reason: "user_closed", previous_status: "attention", previous_revision: 7 });
      for (const key of ["user_id", "source_asset_id", "product_asset_id", "instructions", "preserve_audio", "phase", "error", "created_at"] as const)
        assert.deepEqual(after[key], original[key], key);
      assert.deepEqual(await db.videoPermit.findMany({ where: { job_id: "retain" }, orderBy: { attempt_id: "asc" } }), permitBefore);
      assert.deepEqual(await db.videoJob.findUniqueOrThrow({ where: { id: draft.id } }), draft);
      const replay = await close("retain", 7, client(), owner); assert.equal(replay.ok, true);
      assert.deepEqual(await db.videoJob.findUniqueOrThrow({ where: { id: "retain" } }), after);
      denied(await close("retain", 8, db, owner), "video_job_not_closable", "not_closable_state");
      const listed = await listVideoJobs(owner, { status: "history" }, { db });
      assert.ok(listed.ok && listed.value.jobs.some(item => item.id === "retain" && !item.can_close));
      const prepared = await prepareVideoDraft(owner, "retain", { db });
      denied(prepared as Awaited<ReturnType<typeof close>>, "video_job_cancelled");
      assert.equal(await claimJob("new-worker", db), null);
      await assert.rejects(heartbeatLease("retain", "old-worker", db), LeaseLostError);
      await assert.rejects(patchJob("retain", "old-worker", { expectedRevision: 8, status: "queued" }, undefined, db), LeaseLostError);
    });

    await t.test("matching released attempts can close even when final collection was interrupted", async () => {
      await seed("terminal-receipt", { status: "attention", data: { ...baseData(), segments: [{ index: 0, attempt: 0, buildId: "completed-uncollected" }] } });
      await permit("terminal-receipt", "released");
      assert.equal((await close("terminal-receipt")).ok, true);
    });

    await t.test("closure wins Job lock: late acquire, adopt and render CAS cannot create work", async () => {
      for (const operation of ["acquire", "adopt", "render"] as const) {
        const id = "close-first-" + operation; await seed(id);
        const hold = gate();
        const closing = close(id, 7, gatedClient(client(), hold));
        await hold.entered;
        let result: Promise<unknown>;
        if (operation === "acquire") result = acquireVideoPermit(request(id), client());
        else if (operation === "adopt") result = adoptExistingVideoPermit(request(id), client()).catch(error => error);
        else result = client().videoJob.updateMany({ where: { id, user_id: "owner", status: "review", revision: 7 },
          data: { status: "queued", phase: "render", revision: { increment: 1 } } }).then(value => value);
        try { await waitingOnLock(db); } finally { hold.release(); }
        assert.equal((await closing).ok, true);
        const outcome = await result;
        if (operation === "acquire") assert.deepEqual(outcome, { acquired: false, reason: "blocked", blockedBy: "job_inactive" });
        else if (operation === "adopt") assert.ok(outcome instanceof VideoPermitSubmissionBlockedError);
        else assert.deepEqual(outcome, { count: 0 });
        assert.equal(await db.videoPermit.count({ where: { job_id: id } }), 0);
        assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id } })).status, "cancelled");
      }
    });

    await t.test("adoption wins Job lock: close sees the new unknown permit and refuses", async () => {
      const id = "adopt-first"; await seed(id);
      const hold = gate();
      const adopting = adoptExistingVideoPermit(request(id), gatedClient(client(), hold));
      await hold.entered;
      const closing = close(id, 7, client());
      try { await waitingOnLock(db); } finally { hold.release(); }
      assert.equal((await adopting).status, "unknown");
      denied(await closing, "video_job_not_closable", "unreleased_permit");
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id } })).status, "review");
    });

    await t.test("render CAS wins Job lock: stale close cannot cancel newly queued work", async () => {
      const id = "render-first"; await seed(id);
      const hold = gate();
      const rendering = client().$transaction(async tx => {
        const changed = await tx.videoJob.updateMany({ where: { id, status: "review", revision: 7 },
          data: { status: "queued", phase: "render", revision: { increment: 1 } } });
        hold.enter(); await hold.ready; return changed;
      });
      await hold.entered;
      const closing = close(id, 7, client());
      try { await waitingOnLock(db); } finally { hold.release(); }
      assert.equal((await rendering).count, 1);
      denied(await closing, "job_state_changed");
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id } })).status, "queued");
    });

    await t.test("a genuine live render may reserve, but close cannot cancel it or permit new terminal work", async () => {
      const id = "acquire-first";
      await seed(id, { status: "generating", lease_owner: "worker", lease_until: new Date(Date.now() + 60000) });
      const hold = gate();
      const acquiring = acquireVideoPermit(request(id), gatedClient(client(), hold));
      await hold.entered;
      const closing = close(id, 7, client());
      try { await waitingOnLock(db); } finally { hold.release(); }
      assert.equal((await acquiring).acquired, true);
      denied(await closing, "video_job_not_closable", "not_closable_state");
      assert.equal((await db.videoPermit.findUniqueOrThrow({ where: { attempt_id: id + ":0:0" } })).status, "active");
      for (const status of ["cancelled", "failed", "completed"]) {
        const terminalId = "terminal-" + status; await seed(terminalId, { status });
        assert.deepEqual(await acquireVideoPermit(request(terminalId), db), { acquired: false, reason: "blocked", blockedBy: "job_inactive" });
        await assert.rejects(adoptExistingVideoPermit(request(terminalId), db), VideoPermitSubmissionBlockedError);
        assert.equal(await db.videoPermit.count({ where: { job_id: terminalId } }), 0);
      }
    });
  } finally {
    await Promise.all(clients.map(item => item.$disconnect()));
    await cluster.cleanup();
  }
});
