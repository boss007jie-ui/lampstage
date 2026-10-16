import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { acquireVideoPermit, assertVideoPermitMaySubmit, listUnresolvedVideoPermits, markVideoPermitUnknown, releaseVideoPermit, VideoPermitSubmissionBlockedError } from "../../lib/video/permits";

type Row = {
  attempt_id: string; account_id: string; job_id: string; segment_index: number;
  reserved_coins: number | null; max_coins: number; status: string;
  created_at: Date; unknown_at: Date | null; released_at: Date | null;
};

// The shared state models a persisted database; separate facades model worker restarts.
// Its transaction lock deliberately yields once so four acquisitions actually contend.
function database() {
  const rows = new Map<string, Row>();
  const accounts = new Set<string>();
  let tail = Promise.resolve();
  function facade(): PrismaClient {
    const videoPermit = {
      findUnique: async ({ where }: { where: { attempt_id: string } }) => rows.get(where.attempt_id) ?? null,
      findFirst: async ({ where }: { where: { account_id: string; status: string } }) =>
        [...rows.values()].find(row => row.account_id === where.account_id && row.status === where.status) ?? null,
      count: async ({ where }: { where: { account_id: string; status: string } }) =>
        [...rows.values()].filter(row => row.account_id === where.account_id && row.status === where.status).length,
      create: async ({ data }: { data: Row }) => {
        if (rows.has(data.attempt_id)) throw new Error("duplicate attempt");
        rows.set(data.attempt_id, { ...data, created_at: new Date(), unknown_at: null, released_at: null });
      },
      update: async ({ where, data }: { where: { attempt_id: string }; data: Partial<Row> }) => {
        const row = rows.get(where.attempt_id)!;
        rows.set(where.attempt_id, { ...row, ...data });
      },
      findMany: async ({ where }: { where: { account_id: string; status: string | { in: string[] } } }) =>
        [...rows.values()].filter(row => row.account_id === where.account_id && (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status))),
    };
    const tx = {
      videoPermit,
      $queryRaw: async (_strings: TemplateStringsArray, id: string) => [{ id }],
      videoJob: {
        findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, status: "generating", phase: "render", lease_owner: "worker", lease_until: new Date(Date.now() + 90000), data: { segments: [{ index: 0, attempt: 0 }] } }),
        findMany: async () => [...rows.values()].map(r => ({ id: r.job_id, status: "generating", phase: "render", lease_owner: "worker", lease_until: new Date(Date.now() + 90000), data: { segments: [{ index: 0, attempt: 0 }] } })),
      },
      videoPermitAccount: {
        upsert: async ({ where }: { where: { id: string } }) => { accounts.add(where.id); },
        update: async ({ where }: { where: { id: string } }) => { assert.ok(accounts.has(where.id)); },
      },
    };
    return {
      videoPermit,
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => {
        const previous = tail;
        let unlock!: () => void;
        tail = new Promise<void>(resolve => { unlock = resolve; });
        await previous;
        try {
          await new Promise<void>(resolve => setImmediate(resolve));
          return await callback(tx);
        } finally { unlock(); }
      },
    } as unknown as PrismaClient;
  }
  return { facade, rows };
}

function request(attemptId: string, accountId = "runninghub-account-01") {
  return { accountId, attemptId: `job-${attemptId}:0:0`, jobId: `job-${attemptId}`, segmentIndex: 0, reservedCoins: 650, maxCoins: 700 };
}

test("four simultaneous paid attempts on one account acquire exactly three durable slots", async () => {
  const db = database();
  const workers = Array.from({ length: 4 }, () => db.facade());
  const results = await Promise.all(workers.map((client, i) => acquireVideoPermit(request(`a${i}`), client)));
  assert.equal(results.filter(result => result.acquired).length, 3);
  assert.equal(results.filter(result => !result.acquired && result.reason === "busy").length, 1);
  assert.equal(db.rows.size, 3);
  assert.deepEqual(await acquireVideoPermit(request("a0"), db.facade()),
    { acquired: true, alreadyAcquired: true, attemptId: "job-a0:0:0" });
  assert.equal((await acquireVideoPermit(request("a4", "another-account"), db.facade())).acquired, true);
});

test("uncertain outcome survives a worker restart and blocks new account submissions until terminal release", async () => {
  const db = database();
  assert.equal((await acquireVideoPermit(request("a0"), db.facade())).acquired, true);
  assert.equal((await acquireVideoPermit(request("a1"), db.facade())).acquired, true);
  await assertVideoPermitMaySubmit("job-a1:0:0", db.facade());
  assert.equal(await markVideoPermitUnknown("job-a0:0:0", db.facade()), "unknown");
  const restartedWorker = db.facade();
  await assert.rejects(assertVideoPermitMaySubmit("job-a1:0:0", restartedWorker),
    (error: unknown) => error instanceof VideoPermitSubmissionBlockedError && error.reason === "account_unknown");
  assert.deepEqual(await acquireVideoPermit(request("a2"), restartedWorker),
    { acquired: false, reason: "blocked", blockedBy: "unknown" });
  assert.deepEqual(await acquireVideoPermit(request("a0"), restartedWorker),
    { acquired: false, reason: "blocked", blockedBy: "attempt_finalized" });
  const unresolved = await listUnresolvedVideoPermits("runninghub-account-01", restartedWorker);
  assert.equal(unresolved.length, 2);
  assert.equal(unresolved[0].attempt_id, "job-a0:0:0");
  assert.equal(unresolved[0].job_id, "job-a0");
  assert.equal(unresolved[0].reserved_coins, 650);
  assert.equal(await releaseVideoPermit("job-a0:0:0", restartedWorker), "released");
  assert.equal(await releaseVideoPermit("job-a0:0:0", restartedWorker), "released");
  await assertVideoPermitMaySubmit("job-a1:0:0", restartedWorker);
  assert.equal((await acquireVideoPermit(request("a2"), db.facade())).acquired, true);
  assert.deepEqual(await acquireVideoPermit(request("a0"), db.facade()),
    { acquired: false, reason: "blocked", blockedBy: "attempt_finalized" });
});
