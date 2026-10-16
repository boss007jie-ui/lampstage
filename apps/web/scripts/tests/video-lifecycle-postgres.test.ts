import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";

const enabled = process.env.RUN_VIDEO_DATABASE_TESTS === "1" && process.platform === "win32";
const clock = new Date("2026-10-15T12:00:00.000Z");
const old = new Date(clock.getTime() - 86_401_000);
const fresh = new Date(clock.getTime() - 1_000);
const initialData = () => ({ version: 1, imageCalls: 0, segments: [] });
const sixReferenceData = () => ({ version: 1, imageCalls: 0, generationMode: "six_references", workflowProfile: "sixref-v1",
  referenceImages: [
    { assetId: "base-product", role: "product", label: "Product" },
    { assetId: "base-character", role: "character", label: "Character" },
  ],
  segments: [{ index: 0, start: 0, duration: 5, trimStart: 0, sourceWindowDuration: 5,
    instructions: "Show the product", beforeState: "Product is closed", afterState: "Product is open", attempt: 0,
    referenceImages: ["product", "character", "scene", "product_detail", "start_state", "end_state"]
      .map((role, i) => ({ assetId: `reference-${i}`, role, label: `Reference ${i}` })) }] });

test("isolated PostgreSQL serializes draft and active admission across independent clients", { skip: !enabled, timeout: 240_000 }, async () => {
  // A missing implementation must fail as an asserted behavior, not a module-load crash.
  const modulePath = "../../lib/video/job-quota";
  const lifecycle: Record<string, any> = await import(modulePath).catch(() => ({}));
  assert.equal(typeof lifecycle.createVideoDraft, "function", "createVideoDraft must be exported");
  assert.equal(typeof lifecycle.prepareVideoDraft, "function", "prepareVideoDraft must be exported");
  assert.equal(typeof lifecycle.cancelVideoDraft, "function", "cancelVideoDraft must be exported");
  assert.equal(typeof lifecycle.getVideoJobUsage, "function", "getVideoJobUsage must be exported");
  assert.equal(typeof lifecycle.listVideoJobs, "function", "listVideoJobs must be exported");
  assert.equal(typeof lifecycle.sweepExpiredDrafts, "function", "sweepExpiredDrafts must be exported");

  const cluster = await isolatedVideoPostgres();
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const fixture = client();
  const account = async (id: string) => { await fixture.$executeRaw`INSERT INTO "User" ("id") VALUES (${id})`; return id; };
  const draftInput = (label: string, data: object = initialData()) => ({ source_asset_id: `source-${label}`,
    product_asset_id: `product-${label}`, title: label, instructions: `instructions-${label}`,
    preserve_audio: true, stage: "waiting", data });
  const seed = async (userId: string, label: string, status = "draft", createdAt = fresh,
    data: object = initialData(), extra: Record<string, unknown> = {}) => fixture.videoJob.create({ data: {
      user_id: userId, ...draftInput(label, data as any), status, created_at: createdAt, ...extra,
    } });
  const create = (userId: string, label: string, db = fixture, now = clock) =>
    lifecycle.createVideoDraft(userId, draftInput(label), { db, now });
  const prepare = (userId: string, id: string, db = fixture, now = clock) =>
    lifecycle.prepareVideoDraft(userId, id, { db, now });
  const cancel = (userId: string, id: string, db = fixture, now = clock) =>
    lifecycle.cancelVideoDraft(userId, id, { db, now });
  const usage = (userId: string) => lifecycle.getVideoJobUsage(userId, { db: fixture, now: clock });
  try {
    const raceUser = await account("draft-race");
    const raceClients = Array.from({ length: 11 }, client);
    const createResults = await Promise.all(raceClients.map((db, i) => create(raceUser, `race-${i}`, db)));
    assert.equal(createResults.filter(result => result.ok).length, 10);
    assert.equal(createResults.filter(result => !result.ok && result.status === 429 &&
      result.body?.error === "video_draft_limit_reached").length, 1);
    assert.equal(await fixture.videoJob.count({ where: { user_id: raceUser, status: "draft" } }), 10);
    assert.equal((await usage(raceUser)).drafts.count, 10);

    const activeUser = await account("active-race");
    await Promise.all(Array.from({ length: 9 }, (_, i) => seed(activeUser, `active-${i}`, "queued")));
    const first = await seed(activeUser, "first-prepare");
    const second = await seed(activeUser, "second-prepare");
    const admissions = await Promise.all([
      prepare(activeUser, first.id, client()), prepare(activeUser, second.id, client()),
    ]);
    assert.equal(admissions.filter(result => result.ok && result.value?.queued).length, 1);
    assert.equal(admissions.filter(result => !result.ok && result.status === 429 &&
      result.body?.error === "video_job_limit_reached").length, 1);
    assert.equal(await fixture.videoJob.count({ where: { user_id: activeUser, status: "queued" } }), 10);

    const extra = await create(activeUser, "draft-while-active-full");
    assert.equal(extra.ok, true, "active capacity must not block a new draft");
    if (!extra.ok) throw new Error("Draft creation failed");
    const denial = await prepare(activeUser, extra.value.id);
    assert.equal(denial.ok, false);
    assert.equal(denial.status, 429);
    assert.equal(denial.body.error, "video_job_limit_reached");
    assert.ok(!denial.body.actions?.includes("cancel_video_job"), "active denial must not imply draft cancellation frees it");
    const anotherDraft = await seed(activeUser, "cancel-other-draft");
    assert.equal((await cancel(activeUser, anotherDraft.id)).ok, true);
    assert.equal((await usage(activeUser)).active.count, 10);
    const completing = await fixture.videoJob.findFirstOrThrow({ where: { user_id: activeUser, status: "queued" } });
    await fixture.videoJob.update({ where: { id: completing.id }, data: { status: "completed" } });
    assert.equal((await usage(activeUser)).active.count, 9);
    const afterCompletion = await prepare(activeUser, extra.value.id);
    assert.equal(afterCompletion.ok, true, "completion frees exactly one active slot");
    assert.equal(afterCompletion.value.queued, true);
    assert.equal((await usage(activeUser)).active.count, 10);

    const historyUser = await account("history-over-ten");
    await Promise.all(Array.from({ length: 12 }, (_, i) => seed(historyUser, `done-${i}`, "completed")));
    const newAfterHistory = await create(historyUser, "new-after-history");
    assert.equal(newAfterHistory.ok, true, "completed history consumes no draft capacity");
    if (!newAfterHistory.ok) throw new Error("History creation failed");
    assert.equal((await prepare(historyUser, newAfterHistory.value.id)).ok, true,
      "completed history consumes no active capacity");

    const foreignUser = await account("other-account");
    assert.equal((await cancel(foreignUser, extra.value.id)).status, 404);
    assert.equal((await prepare(foreignUser, extra.value.id)).status, 404);
    assert.equal((await usage(foreignUser)).active.count, 0);

    const pageUser = await account("page-account");
    const sameCreatedAt = new Date(clock.getTime() - 30_000);
    for (let i = 0; i < 5; i++) await seed(pageUser, `page-${i}`, "draft", sameCreatedAt,
      initialData(), { id: `page-0${i}` });
    await seed(pageUser, "queued", "queued", sameCreatedAt, initialData(), { id: "page-queued" });
    await seed(pageUser, "unknown", "vendor_unknown", sameCreatedAt, initialData(), { id: "page-unknown" });
    for (const status of ["completed", "failed", "cancelled"])
      await seed(pageUser, status, status, sameCreatedAt, initialData(), { id: `page-${status}` });
    const pageIds: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const listed = await lifecycle.listVideoJobs(pageUser, { status: "draft", limit: 2, ...(cursor ? { cursor } : {}) },
        { db: fixture, now: clock });
      assert.equal(listed.ok, true);
      pageIds.push(...listed.value.jobs.map((job: any) => job.id));
      cursor = listed.value.next_cursor ?? undefined;
      if (!cursor) break;
    }
    assert.deepEqual(pageIds, ["page-04", "page-03", "page-02", "page-01", "page-00"],
      "keyset cursor preserves id order when created_at ties");
    const activeList = await lifecycle.listVideoJobs(pageUser, { status: "active" }, { db: fixture, now: clock });
    assert.deepEqual(activeList.value.jobs.map((job: any) => job.status).sort(), ["queued", "vendor_unknown"]);
    const historyList = await lifecycle.listVideoJobs(pageUser, { status: "history" }, { db: fixture, now: clock });
    assert.deepEqual(historyList.value.jobs.map((job: any) => job.status).sort(), ["cancelled", "completed", "failed"]);
    assert.equal(activeList.value.usage.active.count, 2);
    assert.equal(historyList.value.usage.drafts.count, 5);
    const firstPage = await lifecycle.listVideoJobs(pageUser, { status: "draft", limit: 2 }, { db: fixture, now: clock });
    const foreignPageOwner = await account("foreign-page-account");
    await seed(foreignPageOwner, "foreign-own", "draft", sameCreatedAt, initialData(), { id: "page-00-foreign" });
    const foreignCursorPage = await lifecycle.listVideoJobs(foreignPageOwner,
      { status: "all", cursor: firstPage.value.next_cursor }, { db: fixture, now: clock });
    assert.equal(foreignCursorPage.ok, true);
    assert.deepEqual(foreignCursorPage.value.jobs.map((job: any) => job.id), ["page-00-foreign"],
      "a cursor obtained for another account cannot expose its jobs");
  } finally {
    await Promise.all(clients.map(db => db.$disconnect()));
    await cluster.cleanup();
  }
});

test("isolated PostgreSQL preserves safe cancellation, expiry and read-only summaries", { skip: !enabled, timeout: 240_000 }, async () => {
  const modulePath = "../../lib/video/job-quota";
  const lifecycle: Record<string, any> = await import(modulePath).catch(() => ({}));
  assert.equal(typeof lifecycle.cancelVideoDraft, "function", "cancelVideoDraft must be exported");
  const cluster = await isolatedVideoPostgres();
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const db = client();
  const userId = "guard-account";
  const create = async (label: string, data: object = initialData(), createdAt = fresh,
    extra: Record<string, unknown> = {}) => db.videoJob.create({ data: {
      user_id: userId, source_asset_id: `source-${label}`, product_asset_id: `product-${label}`,
      title: label, instructions: "keep input", preserve_audio: true, stage: "waiting",
      data: data as any, created_at: createdAt, ...extra,
    } });
  try {
    await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId})`;
    const valid = await create("six-references", sixReferenceData());
    const cancelled = await lifecycle.cancelVideoDraft(userId, valid.id, { db, now: clock });
    assert.equal(cancelled.ok, true, "planned references at attempt 0 are safe draft content");
    const saved = await db.videoJob.findUniqueOrThrow({ where: { id: valid.id } });
    assert.equal(saved.status, "cancelled");
    assert.equal((saved.data as any).cancellation?.reason, "user_cancelled");
    assert.deepEqual((saved.data as any).segments, (sixReferenceData() as any).segments);
    const repeated = await lifecycle.cancelVideoDraft(userId, valid.id, { db, now: new Date(clock.getTime() + 1000) });
    assert.equal(repeated.ok, true);
    assert.equal(((await db.videoJob.findUniqueOrThrow({ where: { id: valid.id } })).data as any).cancellation?.at,
      (saved.data as any).cancellation.at, "repeat cancellation preserves original audit time");
    const cancelledPrepare = await lifecycle.prepareVideoDraft(userId, valid.id, { db, now: clock });
    assert.equal(cancelledPrepare.status, 409);
    assert.equal(cancelledPrepare.body.error, "video_job_cancelled");

    const unsafeCases: [string, object, Record<string, unknown>?][] = [
      ["malformed", { unrelated: true }],
      ["generated", { ...initialData(), outputKey: "saved-output" }],
      ["consent", { ...initialData(), renderConsent: { maxCoins: 1 } }],
      ["attempt", { ...initialData(), segments: [{ index: 0, attempt: 1 }] }],
      ["intent", { ...initialData(), segments: [{ index: 0, attempt: 0, submissionIntentAt: "prior" }] }],
      ["history", { ...initialData(), segments: [{ index: 0, attempt: 0, history: [] }] }],
      ["progress", { ...initialData(), progress: { lastProgressAt: clock.toISOString() } }],
      ["revision", initialData(), { revision: 1 }],
      ["lease", initialData(), { lease_owner: "worker" }],
      ["phase", initialData(), { phase: "prepare_sixref" }],
    ];
    for (const [label, data, extra] of unsafeCases) {
      const row = await create(label, data, fresh, extra);
      const response = await lifecycle.cancelVideoDraft(userId, row.id, { db, now: clock });
      assert.equal(response.status, 409, `${label} must be protected`);
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: row.id } })).status, "draft");
    }
    for (const state of ["active", "unknown", "released"]) {
      const permitted = await create(`${state}-permit`);
      const attemptId = `${state}-attempt`;
      await db.$executeRaw`INSERT INTO "VideoPermit" ("attempt_id", "account_id", "job_id", "segment_index", "max_coins", "status")
        VALUES (${attemptId}, 'provider-test', ${permitted.id}, 0, 0, ${state})`;
      const result = await lifecycle.cancelVideoDraft(userId, permitted.id, { db, now: clock });
      assert.equal(result.status, 409, `${state} permit history protects cancellation`);
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: permitted.id } })).status, "draft");
    }

    const expired = await create("expired", initialData(), old);
    const justFresh = await create("boundary", initialData(), new Date(clock.getTime() - 86_399_000));
    const expiredPrepare = await lifecycle.prepareVideoDraft(userId, expired.id, { db, now: clock });
    assert.equal(expiredPrepare.status, 409);
    assert.equal(expiredPrepare.body.error, "video_job_cancelled");
    const expiredSaved = await db.videoJob.findUniqueOrThrow({ where: { id: expired.id } });
    assert.equal(expiredSaved.status, "cancelled");
    assert.equal((expiredSaved.data as any).cancellation?.reason, "draft_expired");
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: justFresh.id } })).status, "draft");
    const exactBoundary = await create("exact-24-hours", initialData(), new Date(clock.getTime() - 86_400_000));
    const oneMillisecondShort = await create("one-millisecond-short", initialData(), new Date(clock.getTime() - 86_399_999));
    assert.equal((await lifecycle.prepareVideoDraft(userId, exactBoundary.id, { db, now: clock })).body.error,
      "video_job_cancelled", "draft expires at exactly 24 hours");
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: exactBoundary.id } })).status, "cancelled");
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: oneMillisecondShort.id } })).status, "draft");

    const before = await db.videoJob.count({ where: { user_id: userId, status: "draft" } });
    const list = await lifecycle.listVideoJobs(userId, { status: "all", limit: 3 }, { db, now: clock });
    assert.equal(list.ok, true);
    assert.equal(list.value.jobs.length, 3);
    assert.equal(list.value.usage.drafts.count, before, "counts cover the account, not the page");
    await lifecycle.getVideoJobUsage(userId, { db, now: clock });
    assert.equal(await db.videoJob.count({ where: { user_id: userId, status: "draft" } }), before,
      "GET-like summaries must not expire drafts");
  } finally {
    await Promise.all(clients.map(client => client.$disconnect()));
    await cluster.cleanup();
  }
});

test("isolated PostgreSQL commits expiry on quota denial and advances sweep past protected rows", { skip: !enabled, timeout: 240_000 }, async () => {
  const modulePath = "../../lib/video/job-quota";
  const lifecycle: Record<string, any> = await import(modulePath).catch(() => ({}));
  assert.equal(typeof lifecycle.sweepExpiredDrafts, "function", "sweepExpiredDrafts must be exported");
  const cluster = await isolatedVideoPostgres();
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const db = client();
  const seed = (userId: string, label: string, status = "draft", createdAt = fresh,
    data: object = initialData(), extra: Record<string, unknown> = {}) => db.videoJob.create({ data: {
      user_id: userId, source_asset_id: `source-${label}`, product_asset_id: `product-${label}`,
      title: label, instructions: "retained input", preserve_audio: true, stage: "waiting",
      status, created_at: createdAt, data: data as any, ...extra,
    } });
  const input = (label: string) => ({ source_asset_id: `source-${label}`, product_asset_id: `product-${label}`,
    title: label, instructions: "retained input", preserve_audio: true, stage: "waiting", data: initialData() });
  try {
    const createUser = "create-denial";
    const prepareUser = "prepare-denial";
    const sweepUser = "sweep-account";
    const raceUser = "same-job-race";
    for (const userId of [createUser, prepareUser, sweepUser, raceUser])
      await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${userId})`;

    const oldCreate = await seed(createUser, "expired-before-create", "draft", old);
    await Promise.all(Array.from({ length: 10 }, (_, i) => seed(createUser, `fresh-${i}`)));
    const createDenied = await lifecycle.createVideoDraft(createUser, input("denied-create"), { db: client(), now: clock });
    assert.equal(createDenied.status, 429);
    assert.equal(createDenied.body.error, "video_draft_limit_reached");
    const oldCreateSaved = await db.videoJob.findUniqueOrThrow({ where: { id: oldCreate.id } });
    assert.equal(oldCreateSaved.status, "cancelled", "expiry survives denied draft admission");
    assert.equal((oldCreateSaved.data as any).cancellation?.reason, "draft_expired");
    assert.equal((oldCreateSaved.data as any).imageCalls, 0, "expiry retains original input");

    await Promise.all(Array.from({ length: 10 }, (_, i) => seed(prepareUser, `busy-${i}`, "queued")));
    const oldPrepare = await seed(prepareUser, "expired-before-prepare", "draft", old);
    const freshPrepare = await seed(prepareUser, "prepare-denied");
    const prepareDenied = await lifecycle.prepareVideoDraft(prepareUser, freshPrepare.id, { db: client(), now: clock });
    assert.equal(prepareDenied.status, 429);
    assert.equal(prepareDenied.body.error, "video_job_limit_reached");
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: oldPrepare.id } })).status, "cancelled",
      "expiry survives denied active admission");
    assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: freshPrepare.id } })).status, "draft");

    const protectedRows = await Promise.all(Array.from({ length: 3 }, (_, i) =>
      seed(sweepUser, `protected-${i}`, "draft", new Date(old.getTime() - 10_000 + i), { unrelated: true })));
    const eligibleRows = await Promise.all(Array.from({ length: 3 }, (_, i) =>
      seed(sweepUser, `eligible-${i}`, "draft", new Date(old.getTime() + i))));
    let cursor: { createdAt: string; id: string } | null = null;
    let done = false;
    let totalScanned = 0;
    for (let page = 0; page < 8 && !done; page++) {
      const result: any = await lifecycle.sweepExpiredDrafts({ cursor, limit: 2,
        cutoff: new Date(clock.getTime() - 86_400_000) }, { db: client(), now: clock });
      assert.ok(result.scanned <= 2, "sweep respects the scan bound");
      totalScanned += result.scanned;
      cursor = result.cursor;
      done = result.done;
    }
    assert.equal(done, true, "sweep eventually traverses protected older rows");
    assert.ok(totalScanned >= 6);
    for (const row of protectedRows)
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: row.id } })).status, "draft");
    for (const row of eligibleRows)
      assert.equal((await db.videoJob.findUniqueOrThrow({ where: { id: row.id } })).status, "cancelled");

    const race = await seed(raceUser, "race-target");
    const outcomes = await Promise.all([
      lifecycle.prepareVideoDraft(raceUser, race.id, { db: client(), now: clock }),
      lifecycle.cancelVideoDraft(raceUser, race.id, { db: client(), now: clock }),
    ]);
    const raceSaved = await db.videoJob.findUniqueOrThrow({ where: { id: race.id } });
    assert.ok(["queued", "cancelled"].includes(raceSaved.status));
    assert.equal(outcomes.filter(result => result.ok).length, 1,
      "prepare and cancel cannot both win for the same draft");

    const expiryRace = await seed(raceUser, "expiry-race-target", "draft",
      new Date(clock.getTime() - 86_400_000));
    const [prepareNearExpiry, sweepAtExpiry] = await Promise.all([
      lifecycle.prepareVideoDraft(raceUser, expiryRace.id,
        { db: client(), now: new Date(clock.getTime() - 1) }),
      lifecycle.sweepExpiredDrafts({ limit: 20, cutoff: new Date(clock.getTime() - 86_400_000) },
        { db: client(), now: clock }),
    ]);
    const expiryRaceSaved = await db.videoJob.findUniqueOrThrow({ where: { id: expiryRace.id } });
    assert.ok(["queued", "cancelled"].includes(expiryRaceSaved.status),
      "prepare and sweep cannot leave an expired draft in an ambiguous state");
    if (expiryRaceSaved.status === "queued") {
      assert.equal(prepareNearExpiry.ok, true);
      assert.equal(sweepAtExpiry.cancelled, 0);
    } else {
      assert.equal(prepareNearExpiry.status, 409);
      assert.equal(prepareNearExpiry.body.error, "video_job_cancelled");
      assert.equal(sweepAtExpiry.cancelled, 1);
    }
  } finally {
    await Promise.all(clients.map(client => client.$disconnect()));
    await cluster.cleanup();
  }
});
