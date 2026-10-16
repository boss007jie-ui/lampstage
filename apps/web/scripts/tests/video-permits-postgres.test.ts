import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const enabled = process.env.RUN_VIDEO_DATABASE_TESTS === "1" && process.platform === "win32";

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function isolatedPostgres() {
  const tempBase = path.resolve(os.tmpdir());
  if (!/^[\x00-\x7F]+$/.test(tempBase)) throw new Error("Embedded PostgreSQL requires an ASCII temp path");
  const workspace = await mkdtemp(path.join(tempBase, "lamp-permit-pg-"));
  const nativeSource = path.resolve(path.dirname(require.resolve("@embedded-postgres/windows-x64")), "..", "native");
  const native = path.join(workspace, "native");
  const data = path.join(workspace, "data");
  const passwordFile = path.join(workspace, "password.tmp");
  const port = await freeLoopbackPort();
  const password = randomBytes(20).toString("hex");
  const user = "permit_test";
  const database = "permit_test";
  let started = false;
  const bin = (name: string) => path.join(native, "bin", `${name}.exe`);
  const command = (name: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
    // pg_ctl starts a long-lived postgres child. Ignored stdio lets us wait for
    // pg_ctl's exit rather than inherited pipes that remain open until shutdown.
    const child = spawn(bin(name), args, { cwd: workspace, windowsHide: true, stdio: "ignore" });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out`)); }, 60_000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(); else reject(new Error(`${name} exited with code ${code}`));
    });
  });
  const cleanup = async () => {
    if (started) {
      await command("pg_ctl", ["-D", data, "stop", "-m", "fast", "-w", "-t", "30"]).catch(() => undefined);
      started = false;
    }
    // The exact mkdtemp child is the only recursive deletion target.
    const resolved = path.resolve(workspace);
    assert.equal(path.dirname(resolved), tempBase);
    assert.ok(path.basename(resolved).startsWith("lamp-permit-pg-"));
    // Windows may retain a native file handle briefly after pg_ctl reports shutdown.
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    // Postgres binaries are copied under ASCII temp because this repository path may contain CJK characters.
    await cp(nativeSource, native, { recursive: true });
    await writeFile(passwordFile, password, { mode: 0o600 });
    await command("initdb", ["-D", data, "-U", user, "--auth=scram-sha-256",
      `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"]);
    await rm(passwordFile);
    await command("pg_ctl", ["-D", data, "-l", path.join(workspace, "postgres.log"),
      "-o", `-p ${port} -h 127.0.0.1`, "start", "-w", "-t", "30"]);
    started = true;
    const adminUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres?schema=public`;
    const admin = new PrismaClient({ datasourceUrl: adminUrl });
    try { await admin.$executeRawUnsafe(`CREATE DATABASE ${database}`); }
    finally { await admin.$disconnect(); }
    const migration = await readFile(path.join(process.cwd(), "prisma", "migrations",
      "20261015120000_video_permits", "migration.sql"), "utf8");
    const permitOnly = migration.split('ALTER TABLE "VideoWorker"')[0];
    assert.match(permitOnly, /CREATE TABLE "VideoPermit"/);
    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
    const schemaClient = new PrismaClient({ datasourceUrl: url });
    try {
      await schemaClient.$executeRawUnsafe(`CREATE TABLE "VideoJob" (
        "id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "phase" TEXT NOT NULL,
        "lease_owner" TEXT, "lease_until" TIMESTAMP(3), "data" JSONB NOT NULL,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const legacyJobs = [
        { id: "job-legacy-build", data: { segments: [{ index: 0, attempt: 2, buildId: "existing-paid-build" }],
          renderConsent: { maxCoins: 1200 } } },
        { id: "job-legacy-intent", data: { segments: [{ index: 1, submissionIntentAt: "saved-before-upgrade" }],
          renderConsent: { maxCoins: "invalid" } } },
        { id: "job-legacy-candidate", data: { segments: [{ index: 0, buildId: "paid", candidateKey: "already-collected" }] } },
        { id: "job-legacy-empty", data: { unrelated: true } },
        { id: "job-legacy-malformed-index", data: { segments: [{ index: "bad", buildId: "paid" }] } },
        { id: "job-legacy-malformed-candidate", data: { segments: [{ index: 0, buildId: "paid", candidateKey: 42 }] } },
      ];
      for (const legacy of legacyJobs) {
        const dataJson = JSON.stringify(legacy.data);
        await schemaClient.$executeRaw`INSERT INTO "VideoJob" ("id", "status", "phase", "data")
          VALUES (${legacy.id}, 'attention', 'reconcile', ${dataJson}::jsonb)`;
      }
      for (const statement of permitOnly.split(";").map(sql => sql.trim()).filter(Boolean)) {
        await schemaClient.$executeRawUnsafe(statement);
      }
    } finally { await schemaClient.$disconnect(); }
    return { url, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("real PostgreSQL locks hold the account at three permits across clients and restarts", { skip: !enabled, timeout: 180_000 }, async () => {
  // The imported module's default client must never inherit a developer database URL.
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://unusable:unusable@127.0.0.1:1/unusable";
  const { acquireVideoPermit, adoptExistingVideoPermit, assertVideoPermitMaySubmit, markVideoPermitUnknown,
    releaseVideoPermit, VideoPermitSubmissionBlockedError } = await import("../../lib/video/permits");
  const cluster = await isolatedPostgres();
  const clients: PrismaClient[] = [];
  const client = () => {
    const db = new PrismaClient({ datasourceUrl: cluster.url });
    clients.push(db);
    return db;
  };
  const jobId = (label: string) => `job-${label}`;
  const attemptId = (label: string) => `${jobId(label)}:0:0`;
  const request = (label: string, accountId = "runninghub-account-01") => ({
    accountId, attemptId: attemptId(label), jobId: jobId(label), segmentIndex: 0,
    reservedCoins: 650, maxCoins: 700,
  });
  try {
    const fixture = client();
    const insertJob = async (label: string, leaseUntil = new Date(Date.now() + 5 * 60_000), attempt = 0) => {
      const data = JSON.stringify({ version: 1, imageCalls: 0, segments: [{ index: 0, attempt }] });
      await fixture.$executeRaw`INSERT INTO "VideoJob" ("id", "status", "phase", "lease_owner", "lease_until", "data")
        VALUES (${jobId(label)}, 'generating', 'render', 'test-worker',
          (${leaseUntil.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${data}::jsonb)`;
    };
    await Promise.all([...Array.from({ length: 4 }, (_, i) => `first-${i}`), "after-restart", "after-release",
      ...Array.from({ length: 20 }, (_, i) => `race-${i}`),
      "expired-original", "expired-new", "mismatch-original", "mismatch-new",
      "adopt-0", "adopt-1", "adopt-2", "adopt-existing"].map(label => insertJob(label)));
    const migrated = await fixture.videoPermit.findMany({ where: { account_id: "runninghub.account01" } });
    assert.deepEqual(migrated.map(row => row.attempt_id).sort(), [
      "job-legacy-build:0:2", "job-legacy-intent:1:0", "job-legacy-malformed-candidate:0:0", "job-legacy-malformed-index:0:0",
    ]);
    assert.ok(migrated.every(row => row.status === "unknown" && row.reserved_coins === null));
    assert.equal(migrated.find(row => row.attempt_id === "job-legacy-build:0:2")?.max_coins, 1200);
    assert.equal(migrated.find(row => row.attempt_id === "job-legacy-intent:1:0")?.max_coins, 0);
    assert.deepEqual(await acquireVideoPermit(request("migrated-new", "runninghub.account01"), fixture),
      { acquired: false, reason: "blocked", blockedBy: "unknown" });
    const migratedRequest = { accountId: "runninghub.account01", attemptId: "job-legacy-build:0:2",
      jobId: "job-legacy-build", segmentIndex: 0, reservedCoins: null, maxCoins: 0 };
    assert.deepEqual(await adoptExistingVideoPermit(migratedRequest, fixture),
      { attemptId: migratedRequest.attemptId, status: "unknown", alreadyPresent: true });
    assert.equal((await fixture.videoPermit.findUniqueOrThrow({ where: { attempt_id: migratedRequest.attemptId } })).max_coins, 1200);
    const lateData = JSON.stringify({ segments: [{ index: 0, attempt: 0, buildId: "existing-before-adoption" }] });
    await fixture.$executeRaw`INSERT INTO "VideoJob" ("id", "status", "phase", "data")
      VALUES ('job-legacy-late', 'attention', 'reconcile', ${lateData}::jsonb)`;
    const lateRequest = { accountId: "runninghub.account01", attemptId: "job-legacy-late:0:0",
      jobId: "job-legacy-late", segmentIndex: 0, reservedCoins: null, maxCoins: 0 };
    assert.deepEqual(await adoptExistingVideoPermit(lateRequest, fixture),
      { attemptId: lateRequest.attemptId, status: "unknown", alreadyPresent: false });
    assert.deepEqual(await adoptExistingVideoPermit(lateRequest, client()),
      { attemptId: lateRequest.attemptId, status: "unknown", alreadyPresent: true });
    const firstClients = Array.from({ length: 4 }, client);
    const first = await Promise.all(firstClients.map((db, i) => acquireVideoPermit(request(`first-${i}`), db)));
    assert.equal(first.filter(result => result.acquired).length, 3);
    assert.equal(first.filter(result => !result.acquired && result.reason === "busy").length, 1);
    assert.equal(await firstClients[0].videoPermit.count({ where: { account_id: "runninghub-account-01", status: "active" } }), 3);

    const activeAttempt = first.findIndex(result => result.acquired);
    const anotherActive = first.findIndex((result, i) => i !== activeAttempt && result.acquired);
    assert.equal(await markVideoPermitUnknown(attemptId(`first-${activeAttempt}`), firstClients[0]), "unknown");
    const restarted = client();
    assert.deepEqual(await acquireVideoPermit(request("after-restart"), restarted),
      { acquired: false, reason: "blocked", blockedBy: "unknown" });
    await assert.rejects(assertVideoPermitMaySubmit(attemptId(`first-${anotherActive}`), restarted),
      (error: unknown) => error instanceof VideoPermitSubmissionBlockedError && error.reason === "account_unknown");
    const persisted = await restarted.videoPermit.findUniqueOrThrow({ where: { attempt_id: attemptId(`first-${activeAttempt}`) } });
    assert.equal(persisted.status, "unknown");
    assert.equal(persisted.reserved_coins, 650);
    assert.equal(await releaseVideoPermit(attemptId(`first-${activeAttempt}`), restarted), "released");
    assert.equal((await acquireVideoPermit(request("after-release"), restarted)).acquired, true);
    assert.equal(await restarted.videoPermit.count({ where: { account_id: "runninghub-account-01", status: "active" } }), 3);

    const raceClients = Array.from({ length: 8 }, client);
    const race = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      acquireVideoPermit(request(`race-${i}`, "separate-account"), raceClients[i % raceClients.length])));
    assert.equal(race.filter(result => result.acquired).length, 3);
    assert.equal(race.filter(result => !result.acquired && result.reason === "busy").length, 17);
    assert.equal(await restarted.videoPermit.count({ where: { account_id: "separate-account", status: "active" } }), 3);

    for (let i = 0; i < 3; i++) assert.equal((await acquireVideoPermit(request(`adopt-${i}`, "adopt-full-account"), fixture)).acquired, true);
    await fixture.videoJob.updateMany({ where: { id: jobId("adopt-existing") },
      data: { data: { version: 1, imageCalls: 0, segments: [{ index: 0, attempt: 0, buildId: "existing-receipt" }] } } });
    assert.deepEqual(await adoptExistingVideoPermit(request("adopt-existing", "adopt-full-account"), fixture),
      { attemptId: attemptId("adopt-existing"), status: "unknown", alreadyPresent: false });
    assert.equal(await fixture.videoPermit.count({ where: { account_id: "adopt-full-account", status: "active" } }), 3);
    assert.equal(await fixture.videoPermit.count({ where: { account_id: "adopt-full-account", status: "unknown" } }), 1);
    assert.deepEqual(await acquireVideoPermit(request("blocked-by-adoption", "adopt-full-account"), client()),
      { acquired: false, reason: "blocked", blockedBy: "unknown" });
    assert.equal(await releaseVideoPermit(attemptId("adopt-0"), fixture), "released");
    assert.deepEqual(await adoptExistingVideoPermit(request("adopt-0", "adopt-full-account"), fixture),
      { attemptId: attemptId("adopt-0"), status: "released", alreadyPresent: true });

    assert.equal((await acquireVideoPermit(request("expired-original", "expired-account"), fixture)).acquired, true);
    await fixture.videoJob.updateMany({ where: { id: jobId("expired-original") },
      data: { lease_until: new Date(Date.now() - 1000) } });
    const expiredJob = await fixture.videoJob.findFirst({ where: { id: jobId("expired-original") },
      select: { id: true, status: true, phase: true, lease_owner: true, lease_until: true, data: true } });
    assert.ok(expiredJob?.lease_until && expiredJob.lease_until < new Date(),
      `lease=${expiredJob?.lease_until?.toISOString()} now=${new Date().toISOString()}`);
    assert.deepEqual(await acquireVideoPermit(request("expired-new", "expired-account"), client()),
      { acquired: false, reason: "blocked", blockedBy: "unknown" });
    assert.equal((await fixture.videoPermit.findUniqueOrThrow({ where: { attempt_id: attemptId("expired-original") } })).status, "unknown");

    assert.equal((await acquireVideoPermit(request("mismatch-original", "mismatch-account"), fixture)).acquired, true);
    await fixture.videoJob.updateMany({ where: { id: jobId("mismatch-original") },
      data: { data: { version: 1, imageCalls: 0, segments: [{ index: 0, attempt: 1 }] } } });
    assert.deepEqual(await acquireVideoPermit(request("mismatch-new", "mismatch-account"), client()),
      { acquired: false, reason: "blocked", blockedBy: "unknown" });
    assert.equal((await fixture.videoPermit.findUniqueOrThrow({ where: { attempt_id: attemptId("mismatch-original") } })).status, "unknown");
  } finally {
    await Promise.all(clients.map(db => db.$disconnect()));
    await cluster.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
