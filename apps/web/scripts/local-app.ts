import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { access, readFile, writeFile, unlink, mkdir, cp, open } from "node:fs/promises";
import path from "node:path";
import { LOCAL_ROOT, LOCAL_DATA_ROOT, LOCAL_DB_PORT, LOCAL_CONTROL_PORT, LOCAL_WEB_PORT, WEB_ROOT, loadLocalProfile } from "./local-profile";
import { recoverInterruptedLocalImages } from "./local-recovery";

const execFileAsync = promisify(execFile);
const requireFromWeb = createRequire(path.join(WEB_ROOT, "package.json"));
const children: ChildProcess[] = [];
let stage = "starting";
let stopping = false;
let databaseStarted = false;
let ctlPath = "";
let ownsState = false;
const controlToken = randomBytes(24).toString("hex");
const dbDir = path.join(LOCAL_DATA_ROOT, "postgres");
const statePath = path.join(LOCAL_ROOT, "state.json");
const lockPath = path.join(LOCAL_ROOT, "launch.lock");

async function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000, () => done(false)); socket.once("connect", () => done(true)); socket.once("error", () => done(false)); });
}
async function state(message: string) {
  stage = message;
  await writeFile(statePath, JSON.stringify({ version: 1, pid: process.pid, controlToken, stage, url: `http://127.0.0.1:${LOCAL_WEB_PORT}`, updatedAt: new Date().toISOString() }));
  console.log(`[local] ${message}`);
}
async function runNode(script: string, args: string[] = []) {
  // Never send child stdout/stderr to the UI: failed provider/DB diagnostics may include credentials.
  try { await execFileAsync(process.execPath, [script, ...args], { cwd: WEB_ROOT, env: process.env, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
  catch { throw new Error(`Local initialization failed at ${path.basename(script)}. No cloud database was used.`); }
}
async function launch(args: string[], name: string) {
  const log = await open(path.join(LOCAL_ROOT, `${name}.log`), "a", 0o600);
  const child = spawn(process.execPath, ["--require", path.join(WEB_ROOT, "scripts", "local-network.cjs"), ...args], { cwd: WEB_ROOT, env: process.env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
  await log.close();
  children.push(child);
  child.on("error", () => { void state(`${name} failed`).then(() => shutdown(1)); });
  child.on("exit", () => { if (!stopping) void state(`${name} stopped`).then(() => shutdown(1)); });
  return child;
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (ownsState) await state("stopping").catch(() => undefined);
  // Reject shutdown while upstream work is active, through the control endpoint below.
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    else child.kill("SIGTERM");
  }
  if (databaseStarted) await execFileAsync(ctlPath, ["-D", dbDir, "stop", "-m", "fast", "-w", "-t", "30"], { windowsHide: true, timeout: 35000 }).catch(() => undefined);
  if (ownsState) {
    await state(code ? "failed" : "stopped").catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
  process.exit(code);
}
async function main() {
  await mkdir(LOCAL_ROOT, { recursive: true });
  if (process.platform !== "win32") throw new Error("This desktop launcher currently supports Windows x64.");
  for (const port of [LOCAL_WEB_PORT, LOCAL_DB_PORT, LOCAL_CONTROL_PORT]) if (await portOpen(port)) throw new Error(`Port ${port} is already in use. Stop the existing local instance first.`);
  try { await writeFile(lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const oldLock = JSON.parse(await readFile(lockPath, "utf8"));
    let alive = true;
    try { process.kill(oldLock.pid, 0); } catch (checkError) { if ((checkError as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
    if (alive) throw new Error("Local initialization is already running.");
    await unlink(lockPath);
    await writeFile(lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  }
  ownsState = true;
  const config = await loadLocalProfile();
  await state("initializing database");
  if (!/^[\x00-\x7F]+$/.test(LOCAL_DATA_ROOT)) throw new Error("Invalid local database path; Postgres requires an ASCII local data directory.");
  await mkdir(LOCAL_DATA_ROOT, { recursive: true });
  const originalNative = path.resolve(path.dirname(requireFromWeb.resolve("@embedded-postgres/windows-x64")), "..", "native");
  const nativeRoot = path.join(LOCAL_DATA_ROOT, "postgres-bin-18.4.0");
  try { await access(path.join(nativeRoot, ".ready")); } catch {
    await cp(originalNative, nativeRoot, { recursive: true });
    await writeFile(path.join(nativeRoot, ".ready"), "18.4.0-beta.17");
  }
  ctlPath = path.join(nativeRoot, "bin", "pg_ctl.exe");
  let initialized = false;
  try { await access(path.join(dbDir, "PG_VERSION")); initialized = true; } catch { /* new local database */ }
  if (!initialized) {
    const passwordFile = path.join(LOCAL_DATA_ROOT, "init-password.tmp");
    await writeFile(passwordFile, config.dbPassword, { flag: "wx", mode: 0o600 });
    try { await execFileAsync(path.join(nativeRoot, "bin", "initdb.exe"), ["-D", dbDir, "-U", "lampstage", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--locale=C"], { cwd: LOCAL_DATA_ROOT, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }); }
    catch { throw new Error("Could not initialize the isolated local database."); }
    finally { await unlink(passwordFile).catch(() => undefined); }
  }
  await execFileAsync(ctlPath, ["-D", dbDir, "-l", path.join(LOCAL_DATA_ROOT, "postgres.log"), "-o", `-p ${LOCAL_DB_PORT} -h 127.0.0.1`, "start", "-w", "-t", "30"], { cwd: LOCAL_DATA_ROOT, windowsHide: true, timeout: 35000, maxBuffer: 2 * 1024 * 1024 });
  databaseStarted = true;
  await runNode(requireFromWeb.resolve("prisma/build/index.js"), ["generate"]);
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL!.replace("/lampstage_local?", "/postgres?") });
  try {
    const exists = await admin.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = 'lampstage_local')`;
    if (!exists[0].exists) await admin.$executeRawUnsafe('CREATE DATABASE "lampstage_local"');
  } finally { await admin.$disconnect(); }
  await state("syncing local schema");
  await runNode(requireFromWeb.resolve("prisma/build/index.js"), ["db", "push", "--skip-generate"]);
  await state("seeding local account and scenes");
  await runNode(requireFromWeb.resolve("tsx/cli"), ["prisma/seed.ts"]);
  await runNode(requireFromWeb.resolve("tsx/cli"), ["scripts/local-seed.ts"]);
  const localDb = new PrismaClient();
  try { await recoverInterruptedLocalImages(localDb); await localDb.videoWorker.deleteMany(); } finally { await localDb.$disconnect(); }
  await state("starting website and worker");
  await launch([requireFromWeb.resolve("next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(LOCAL_WEB_PORT)], "website");
  await launch(["--import", "tsx", "scripts/video-worker.ts"], "worker");
  const db = new PrismaClient();
  const server = createServer(async (req, res) => {
    if (req.headers["x-local-token"] !== controlToken) { res.writeHead(403); res.end(); return; }
    if (req.method === "POST" && req.url === "/stop") {
      const active = await Promise.all([db.videoJob.count({ where: { status: { in: ["queued", "preparing", "generating", "assembling"] } } }), db.generationJob.count({ where: { status: "generating" } })]).then(values => values[0] + values[1], () => -1);
      if (active !== 0) { res.writeHead(409); res.end("There are active tasks. Wait for them to finish before stopping."); return; }
      res.writeHead(200); res.end("Stopping local instance."); void shutdown(); return;
    }
    if (req.method === "GET" && req.url === "/health") {
      const database = await db.user.count().then(() => true, () => false);
      const worker = await db.videoWorker.findFirst({ where: { heartbeat_at: { gt: new Date(Date.now() - 60000) } }, orderBy: { heartbeat_at: "desc" } }).catch(() => null);
      const website = await fetch(`http://127.0.0.1:${LOCAL_WEB_PORT}/api/videos/capabilities`, { signal: AbortSignal.timeout(15000) }).then(r => r.ok, () => false);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ stage, database, website, worker: Boolean(worker), image: worker?.image_ready ?? false, video: worker?.video_ready ?? false, pricing: Boolean(process.env.VIDEO_H3_SEGMENT_QUOTE_COINS), url: `http://127.0.0.1:${LOCAL_WEB_PORT}` }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(LOCAL_CONTROL_PORT, "127.0.0.1", resolve); });
  await state("running");
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}
void main().catch(async error => {
  // Only messages we own are emitted; database/provider error payloads stay private.
  const message = error instanceof Error && /^(Port |This desktop|Invalid local|Could not initialize|Local initialization)/.test(error.message) ? error.message : "Local startup failed. Check the local runtime and database logs.";
  console.error(message);
  if (ownsState) await state(`failed: ${message}`).catch(() => undefined);
  await shutdown(1);
});
