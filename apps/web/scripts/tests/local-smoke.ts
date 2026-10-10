import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LOCAL_ROOT, WEB_ROOT } from "../local-profile";
import { recoverInterruptedLocalImages } from "../local-recovery";

const origin = "http://127.0.0.1:3000";
async function main() {
  const config = JSON.parse(await readFile(path.join(LOCAL_ROOT, "config.json"), "utf8"));
  const state = JSON.parse(await readFile(path.join(LOCAL_ROOT, "state.json"), "utf8"));
  const health = await fetch("http://127.0.0.1:55433/health", { headers: { "x-local-token": state.controlToken } }).then(r => r.json());
  assert.equal(health.database, true); assert.equal(health.website, true); assert.equal(health.worker, true);
  const dbUrl = `postgresql://lampstage:${config.dbPassword}@127.0.0.1:55432/lampstage_local?schema=public`;
  process.env.DATABASE_URL = dbUrl;
  const db = new PrismaClient({ datasourceUrl: dbUrl });
  let checks = 0;
  const suffix = randomBytes(6).toString("hex");
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const templates = await fetch(`${origin}/api/templates`).then(r => r.json());
    assert.equal(templates.templates.length, 6);
    for (const template of templates.templates) { assert.equal((await fetch(new URL(template.preview_image_url, origin))).status, 200); checks++; }
    const [owner, other] = await Promise.all(["owner", "other"].map(name => db.user.create({ data: { email: `qa-${name}-${suffix}@lampstage.local`, password_hash: passwordHash, role: "ADMIN", credit_balance: 20 } })));
    async function signIn(email: string) {
      const response = await fetch(`${origin}/api/auth/sign-in`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie); checks++;
      return cookie;
    }
    const ownerCookie = await signIn(owner.email!); const otherCookie = await signIn(other.email!);
    async function request(url: string, cookie = ownerCookie, init: RequestInit = {}) {
      return fetch(new URL(url, origin), { ...init, headers: { Cookie: cookie, Origin: origin, ...init.headers } });
    }
    async function post(url: string, body?: unknown, cookie = ownerCookie) {
      return request(url, cookie, { method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    assert.equal((await fetch(`${origin}/api/videos/projects`)).status, 401); checks++;
    const cap = await request("/api/videos/capabilities").then(r => r.json()); assert.equal(cap.eligible, true); assert.equal(cap.database_ready, true); checks++;
    assert.equal((await request("/api/videos/uploads", ownerCookie, { method: "POST", headers: { Origin: "https://unrelated.example", "Content-Type": "application/json" }, body: JSON.stringify({ name: "test.mp4", mime: "video/mp4", size: 100 }) })).status, 403); checks++;
    const fixtures = path.join(LOCAL_ROOT, "qa"); await mkdir(fixtures, { recursive: true });
    const videoPath = path.join(fixtures, "local-test-video.mp4");
    await promisify(execFile)(process.env.VIDEO_FFMPEG_PATH || "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath], { windowsHide: true, timeout: 30000 });
    const videoBytes = await readFile(videoPath);
    const ticketResponse = await post("/api/videos/uploads", { name: "local-test-video.mp4", mime: "video/mp4", size: videoBytes.length }); assert.equal(ticketResponse.status, 201); checks++;
    const ticket = await ticketResponse.json();
    assert.equal((await request(ticket.upload_url, ownerCookie, { method: "PUT", headers: ticket.headers, body: new Uint8Array(videoBytes) })).status, 200); checks++;
    assert.equal((await post(`/api/videos/uploads/${ticket.asset_id}/complete`)).status, 200); checks++;
    assert.equal((await post(`/api/videos/uploads/${ticket.asset_id}/complete`)).status, 200); checks++;
    const asset = await db.videoAsset.findUniqueOrThrow({ where: { id: ticket.asset_id } }); assert.equal(asset.status, "ready"); assert.match(asset.storage_key, /\/source\//); checks++;
    const form = new FormData(); const productBytes = await readFile(path.join(WEB_ROOT, "public", "c28-products", "source-prod_table_classic.png"));
    form.set("file", new Blob([new Uint8Array(productBytes)], { type: "image/png" }), "local-test-product.png");
    const productResponse = await request("/api/uploads", ownerCookie, { method: "POST", body: form }); assert.equal(productResponse.status, 200); const product = await productResponse.json(); assert.ok(product.id); assert.match(product.image_url, /^\/uploads\//); checks++;
    const projectBody = { source_asset_id: ticket.asset_id, product_asset_id: product.id, title: "本地接口验收 · 测试素材", instructions: "仅验证本地保存，没有生成授权。", preserve_audio: false };
    assert.equal((await post("/api/videos/projects", projectBody, otherCookie)).status, 400); checks++;
    const projectResponse = await post("/api/videos/projects", projectBody); assert.equal(projectResponse.status, 201); const { project } = await projectResponse.json(); assert.equal(project.status, "draft"); checks++;
    const ranged = await request(project.source_url, ownerCookie, { headers: { Range: "bytes=0-31" } }); assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 32); checks++;
    assert.equal((await request(project.source_url, otherCookie)).status, 404); checks++;
    assert.equal((await fetch(new URL(project.source_url, origin))).status, 401); checks++;
    const preview = await request(project.product_url); assert.equal(preview.status, 200); assert.equal(preview.headers.get("content-type"), "image/jpeg"); checks++;
    assert.ok((await request("/api/videos/projects").then(r => r.json())).projects.some((item: {id:string}) => item.id === project.id)); checks++;
    const saved = await db.videoJob.findUniqueOrThrow({ where: { id: project.id } }); assert.equal(saved.status, "draft"); assert.equal((saved.data as {imageCalls:number}).imageCalls, 0); assert.equal(saved.lease_owner, null); checks++;
    assert.equal(await db.toolCallLog.count({ where: { created_at: { gte: saved.created_at } } }), 0); checks++;
    // Only this synthetic interrupted test job is created. No live generation is submitted.
    const orphan = await db.generationJob.create({ data: { user_id: owner.id, uploaded_asset_id: product.id, platform_style: "brand_site", aspect_ratio: "ratio_1_1", status: "generating", credit_cost: 2 } });
    await db.$transaction([db.user.update({ where: { id: owner.id }, data: { credit_balance: { decrement: 2 } } }), db.creditTransaction.create({ data: { user_id: owner.id, related_job_id: orphan.id, type: "consume", amount: -2 } })]);
    await recoverInterruptedLocalImages(db, [orphan.id]); await recoverInterruptedLocalImages(db, [orphan.id]);
    assert.equal((await db.generationJob.findUniqueOrThrow({ where: { id: orphan.id } })).status, "failed"); assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).credit_balance, 20); assert.equal(await db.creditTransaction.count({ where: { related_job_id: orphan.id, type: "refund" } }), 1); checks++;
    await writeFile(path.join(fixtures, "last-smoke.json"), JSON.stringify({ passed: checks, createdAt: new Date().toISOString(), projectId: project.id, ownerId: owner.id, sourceBytes: videoBytes.length, paidCalls: 0 }, null, 2));
    console.log(`${checks} local checks passed: real login, upload, sealed media, ownership, durable draft, interruption recovery. Paid calls: 0.`);
  } finally { await db.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof assert.AssertionError ? `Local verification failed: ${error.message}` : "Local verification failed. Check the local runtime; no generation was submitted."); process.exitCode = 1; });
