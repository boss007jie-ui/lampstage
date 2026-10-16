import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export async function isolatedVideoPostgres(options: { templateColumn?: boolean } = {}) {
  const tempBase = path.resolve(os.tmpdir());
  if (!/^[\x00-\x7F]+$/.test(tempBase)) throw new Error("Embedded PostgreSQL requires an ASCII temp path");
  const workspace = await mkdtemp(path.join(tempBase, "lamp-video-lifecycle-pg-"));
  const nativeSource = path.resolve(path.dirname(require.resolve("@embedded-postgres/windows-x64")), "..", "native");
  const native = path.join(workspace, "native");
  const data = path.join(workspace, "data");
  const passwordFile = path.join(workspace, "password.tmp");
  const port = await freeLoopbackPort();
  const password = randomBytes(20).toString("hex");
  const user = "lifecycle_test";
  const database = "lifecycle_test";
  let started = false;
  const bin = (name: string) => path.join(native, "bin", `${name}.exe`);
  const command = (name: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
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
    const resolved = path.resolve(workspace);
    assert.equal(path.dirname(resolved), tempBase);
    assert.ok(path.basename(resolved).startsWith("lamp-video-lifecycle-pg-"));
    // Windows can retain a native PostgreSQL file handle briefly after pg_ctl reports stop.
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
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
    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
    const schema = new PrismaClient({ datasourceUrl: url });
    try {
      // Match the Prisma field names/defaults used by the lifecycle service. No production URL is read or altered.
      await schema.$executeRawUnsafe(`CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT, "phone" TEXT,
        "password_hash" TEXT, "email_verified" TIMESTAMP(3), "credit_balance" INTEGER NOT NULL DEFAULT 0,
        "credits_unlimited" BOOLEAN NOT NULL DEFAULT false,
        "role" TEXT NOT NULL DEFAULT 'USER', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await schema.$executeRawUnsafe(`CREATE TABLE "VideoJob" (
        "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"),
        "source_asset_id" TEXT NOT NULL, ${options.templateColumn === false ? "" : '"template_version_id" TEXT,'} "product_asset_id" TEXT NOT NULL,
        "title" TEXT NOT NULL, "instructions" TEXT NOT NULL DEFAULT '',
        "preserve_audio" BOOLEAN NOT NULL DEFAULT true, "status" TEXT NOT NULL DEFAULT 'draft',
        "phase" TEXT NOT NULL DEFAULT 'prepare', "stage" TEXT NOT NULL DEFAULT 'waiting',
        "data" JSONB NOT NULL, "error" TEXT, "lease_owner" TEXT, "lease_until" TIMESTAMP(3),
        "revision" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await schema.$executeRawUnsafe(`CREATE INDEX "VideoJob_user_id_created_at_idx" ON "VideoJob"("user_id", "created_at")`);
      await schema.$executeRawUnsafe(`CREATE INDEX "VideoJob_status_created_at_idx" ON "VideoJob"("status", "created_at")`);
      await schema.$executeRawUnsafe(`CREATE TABLE "VideoPermit" (
        "attempt_id" TEXT PRIMARY KEY, "account_id" TEXT NOT NULL, "job_id" TEXT NOT NULL,
        "segment_index" INTEGER NOT NULL, "reserved_coins" INTEGER, "max_coins" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "unknown_at" TIMESTAMP(3), "released_at" TIMESTAMP(3)
      )`);
      await schema.$executeRawUnsafe(`CREATE INDEX "VideoPermit_job_id_segment_index_idx" ON "VideoPermit"("job_id", "segment_index")`);
    } finally { await schema.$disconnect(); }
    return { url, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
