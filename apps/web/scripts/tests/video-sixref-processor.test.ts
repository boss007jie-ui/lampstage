import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import type { VideoJob } from "@prisma/client";
import { prisma } from "../../lib/db";
import { sixRefRunner } from "../../lib/video/hypit-runner";
import { processSixRefVideoJob, verifySixConsent } from "../../lib/video/sixref-processor";
import { parseSixReferencePlan, sixPlanDigest } from "../../lib/video/six-reference-plan";
import { videoData } from "../../lib/video/types";
import { probeMedia } from "../../lib/video/media";

type Row = Record<string, any>;
const ffmpeg = promisify(execFile);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const startStateError = /每段第一张参考必须是唯一的 start_state 完整起态图/;

test("worker consent checks only selected segments for missing, later or repeated start_state", () => {
  const data = parseSixReferencePlan({ reference_assets: [{ asset_id: "state", role: "start_state", label: "complete initial scene" },
    { asset_id: "person", role: "character", label: "person" }], segment_plan: [0, 1].map(index => ({
    start: index * 4, source_duration: 4, duration: 4, instructions: `Action ${index}`,
    before_state: "Before", after_state: "After",
  })) });
  for (const segment of data.segments) {
    segment.clipKey = `videos/job/segments/${segment.index}/source.mp4`;
    segment.referenceImages = segment.referenceImages!.map((ref, index) => ({ ...ref,
      key: `videos/job/segments/${segment.index}/references/${index}.png`, sha256: "a".repeat(64) }));
  }
  const original = structuredClone(data.segments[1].referenceImages!);
  data.renderConsent = { at: new Date().toISOString(), maxCoins: 100, estimatedCoins: 100, perSegmentCoins: 100,
    segmentIndices: [1], referenceDigest: "" };
  for (const invalid of [
    original.map((ref, i) => i === 0 ? { ...ref, role: "scene" as const } : ref),
    [original[1], original[0]],
    [original[0], { ...original[1], role: "start_state" as const }],
  ]) {
    data.segments[1].referenceImages = invalid;
    data.renderConsent.referenceDigest = sixPlanDigest(data);
    assert.throws(() => verifySixConsent(data, 100, 1), startStateError);
  }
  data.segments[1].referenceImages = original;
  data.renderConsent.referenceDigest = sixPlanDigest(data);
  assert.doesNotThrow(() => verifySixConsent(data, 100, 1));
  data.segments[0].referenceImages = [original[1], original[0]];
  data.renderConsent.referenceDigest = sixPlanDigest(data);
  assert.doesNotThrow(() => verifySixConsent(data, 100, 1));
});

test("worker prepare rejects legacy malformed start_state before source or reference downloads", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sixref-start-state-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const previousRoot = process.env.VIDEO_WORK_ROOT;
  process.env.VIDEO_WORK_ROOT = root;
  t.after(() => { if (previousRoot === undefined) delete process.env.VIDEO_WORK_ROOT; else process.env.VIDEO_WORK_ROOT = previousRoot; });
  const data = parseSixReferencePlan({ reference_assets: [{ asset_id: "state", role: "start_state", label: "complete scene" },
    { asset_id: "person", role: "character", label: "person" }], segment_plan: [{ start: 0, source_duration: 4, duration: 4,
    instructions: "Action", before_state: "Before", after_state: "After" }] });
  const original = structuredClone(data.segments[0].referenceImages!);
  let state = { id: "startstatejob", user_id: "owner", source_asset_id: "source", instructions: "Action", preserve_audio: false,
    status: "preparing", phase: "prepare_sixref", stage: "", revision: 1, lease_owner: "worker",
    lease_until: new Date(Date.now() + 300_000), data } as unknown as VideoJob;
  let sourceReads = 0;
  const stub = (model: object, method: string, fn: (...args: any[]) => unknown) => {
    const delegate = model as Record<string, (...args: any[]) => unknown>;
    const previous = delegate[method]; delegate[method] = fn;
    t.after(() => { delegate[method] = previous; });
  };
  stub(prisma.videoAsset, "findFirst", async () => { sourceReads++; return null; });
  stub(prisma.videoJob, "findFirst", async () => structuredClone(state));
  stub(prisma.videoJob, "updateMany", async ({ data: patch }: Row) => {
    state = { ...state, ...structuredClone(patch), revision: state.revision + 1 } as VideoJob;
    return { count: 1 };
  });
  for (const invalid of [
    original.map((ref, i) => i === 0 ? { ...ref, role: "scene" as const } : ref),
    [original[1], original[0]],
    [original[0], { ...original[1], role: "start_state" as const }],
  ]) {
    state = { ...state, phase: "prepare_sixref", status: "preparing", data: { ...data, segments: [{ ...data.segments[0], referenceImages: invalid }] } } as unknown as VideoJob;
    await processSixRefVideoJob(state, "worker");
    assert.equal(sourceReads, 0);
    assert.match(state.error ?? "", startStateError);
  }
});

async function fixture(t: test.TestContext, mode: "complete" | "unknown" = "complete") {
  let currentMode: "complete" | "unknown" | "terminal" = mode;
  const root = await mkdtemp(path.join(os.tmpdir(), "sixref-processor-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const storage = path.join(root, "storage"), work = path.join(root, "work"), jobId = "sixrefjob";
  const env = { VIDEO_STORAGE_DIR: storage, VIDEO_WORK_ROOT: work, R2_ENDPOINT: "", VIDEO_PAID_GENERATION_ENABLED: "true", VIDEO_SIXREF_SEGMENT_QUOTE_COINS: "100" };
  for (const [name, value] of Object.entries(env)) {
    const prior = process.env[name]; process.env[name] = value;
    t.after(() => { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; });
  }
  const candidate = path.join(root, "candidate.mp4");
  await ffmpeg(process.env.VIDEO_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=120x216:rate=12", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", candidate], { windowsHide: true });
  const referenceAssets = Array.from({ length: 5 }, (_, i) => ({ asset_id: `global${i}`, role: i === 0 ? "start_state" : "character", label: `global ${i}` }));
  const data = parseSixReferencePlan({ reference_assets: referenceAssets, segment_plan: Array.from({ length: 4 }, (_, i) => ({
    start: i * 4, source_duration: 4, duration: 4, instructions: `Action ${i}`, before_state: `Before ${i}`, after_state: `After ${i}`,
    reference_assets: Array.from({ length: 5 }, (_, j) => ({ asset_id: `seg${i}ref${j}`, role: j === 0 ? "start_state" : "character", label: `segment ${i} picture ${j}` })),
  })) });
  data.sourceDuration = 16;
  for (const segment of data.segments) {
    const clipKey = `videos/${jobId}/segments/${segment.index}/source.mp4`;
    await mkdir(path.dirname(path.join(storage, clipKey)), { recursive: true });
    await copyFile(candidate, path.join(storage, clipKey));
    segment.clipKey = clipKey;
    for (const [i, ref] of segment.referenceImages!.entries()) {
      const bytes = await sharp({ create: { width: 12, height: 18, channels: 3, background: { r: 20 * (segment.index + 1), g: 30 * (i + 1), b: 70 } } }).png().toBuffer();
      const key = `videos/${jobId}/segments/${segment.index}/references/${i}.png`;
      await mkdir(path.dirname(path.join(storage, key)), { recursive: true });
      await writeFile(path.join(storage, key), bytes);
      ref.key = key; ref.sha256 = sha(bytes);
    }
  }
  data.renderConsent = { at: new Date().toISOString(), maxCoins: 500, estimatedCoins: 400, perSegmentCoins: 100,
    segmentIndices: [0, 1, 2, 3], referenceDigest: sixPlanDigest(data) };
  let state = { id: jobId, user_id: "owner", source_asset_id: "source", instructions: "Keep the operation", preserve_audio: false,
    status: "generating", phase: "render", stage: "", revision: 1, lease_owner: "worker", lease_until: new Date(Date.now() + 300_000), data } as unknown as VideoJob;
  const permits = new Map<string, Row>();
  let lock: Promise<void> = Promise.resolve();
  const permit = {
    findUnique: async ({ where }: Row) => permits.get(where.attempt_id) ?? null,
    findFirst: async ({ where }: Row) => [...permits.values()].find(p => p.account_id === where.account_id && p.status === where.status) ?? null,
    count: async ({ where }: Row) => [...permits.values()].filter(p => p.account_id === where.account_id && p.status === where.status).length,
    create: async ({ data }: Row) => { permits.set(data.attempt_id, { ...data, created_at: new Date() }); },
    update: async ({ where, data }: Row) => { Object.assign(permits.get(where.attempt_id)!, data); },
    findMany: async ({ where }: Row) => [...permits.values()].filter(p => p.account_id === where.account_id &&
      (typeof where.status === "string" ? p.status === where.status : where.status.in.includes(p.status))),
  };
  const tx = { $queryRaw: async () => [{ id: state.id }], videoPermit: permit,
    videoPermitAccount: { upsert: async () => undefined, update: async () => undefined },
    videoJob: { findUnique: async () => structuredClone(state),
      findMany: async () => [{ id: state.id, status: state.status, phase: state.phase, lease_owner: state.lease_owner,
        lease_until: state.lease_until, data: structuredClone(state.data) }] } };
  const stub = (model: object, method: string, fn: (...args: any[]) => unknown) => {
    const delegate = model as Record<string, (...args: any[]) => unknown>;
    const previous = delegate[method]; delegate[method] = fn;
    t.after(() => { delegate[method] = previous; });
  };
  stub(prisma, "$transaction", async (fn: (value: typeof tx) => Promise<unknown>) => {
    const prior = lock; let unlock!: () => void;
    lock = new Promise<void>(resolve => { unlock = resolve; });
    await prior;
    try { await pause(2); return await fn(tx); } finally { unlock(); }
  });
  stub(prisma.videoPermit, "findUnique", permit.findUnique);
  stub(prisma.videoJob, "findMany", async () => [structuredClone(state)]);
  stub(prisma.videoJob, "findFirst", async ({ where }: Row) => {
    if (where?.revision !== undefined && where.revision !== state.revision) return null;
    return structuredClone(state);
  });
  stub(prisma.videoJob, "updateMany", async ({ where, data: patch }: Row) => {
    await pause(3);
    if (where.id !== state.id || where.lease_owner !== "worker" || (where.revision !== undefined && where.revision !== state.revision)) return { count: 0 };
    state = { ...state, ...structuredClone(patch), revision: patch.revision ? state.revision + 1 : state.revision } as VideoJob;
    return { count: 1 };
  });
  const submitted: string[] = [], seenRefs: string[][] = [];
  const inspected: string[] = [];
  let resumed = 0;
  let active = 0, maxActive = 0;
  t.mock.method(sixRefRunner, "runnerReadiness", async () => ({ ready: true }));
  t.mock.method(sixRefRunner, "submitH3", async (input: Row) => {
    await input.beforeSubmit();
    const index = Number(path.basename(path.dirname(input.workspace)).replace("segment-", ""));
    assert.equal(input.referencePaths.length, 5);
    seenRefs[index] = await Promise.all(input.referencePaths.map((file: string) => readFile(file).then(sha)));
    const buildId = `build-${index}`;
    submitted.push(buildId); active++; maxActive = Math.max(maxActive, active);
    await input.onBuildId(buildId);
    return { buildId };
  });
  t.mock.method(sixRefRunner, "inspectH3", async ({ buildId }: Row) => {
    inspected.push(buildId);
    if (currentMode === "unknown" && buildId === "build-0") return { state: "unknown", taskId: "remote-0" };
    if (currentMode === "terminal" && buildId === "build-0") return { state: "failed", taskId: "remote-0" };
    await pause(80);
    return { state: "completed", taskId: `remote-${buildId}` };
  });
  t.mock.method(sixRefRunner, "resumeH3Worker", async () => { resumed++; return { ready: true }; });
  t.mock.method(sixRefRunner, "collectH3", async ({ buildId, to }: Row) => {
    assert.match(buildId, /^build-[0-3]$/);
    await copyFile(candidate, to);
    active--;
  });
  return { storage, work, candidate, permits, submitted, seenRefs, inspected, getState: () => state, getMaxActive: () => maxActive,
    setMode: (value: "complete" | "unknown" | "terminal") => { currentMode = value; }, getResumed: () => resumed };
}

test("four independent segments overlap within three permits and retain every candidate for review", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const f = await fixture(t);
  const result = await processSixRefVideoJob(f.getState(), "worker");
  assert.equal(result, "safe");
  assert.equal(f.getState().status, "review");
  assert.equal(f.submitted.length, 4, f.getState().error ?? "no worker error");
  assert.equal(new Set(f.submitted).size, 4);
  assert.ok(f.getMaxActive() >= 2 && f.getMaxActive() <= 3);
  const data = videoData(f.getState().data);
  assert.equal(data.segments.length, 4);
  assert.ok(data.segments.every(s => s.candidateKey && s.candidateSha256 && s.tailKey && s.tailSha256 && !s.accepted));
  assert.equal(f.seenRefs.length, 4);
  for (const s of data.segments) {
    assert.deepEqual(f.seenRefs[s.index], s.referenceImages!.map(r => r.sha256));
    assert.equal(sha(await readFile(path.join(f.storage, s.candidateKey!))), s.candidateSha256);
    assert.equal(sha(await readFile(path.join(f.storage, s.tailKey!))), s.tailSha256);
  }
  assert.equal([...f.permits.values()].filter(p => p.status === "released").length, 4);
  assert.equal(data.outputKey, undefined);
});

test("unknown first task retains its permit while other in-flight candidates collect and fourth does not submit", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const f = await fixture(t, "unknown");
  const result = await processSixRefVideoJob(f.getState(), "worker");
  assert.equal(result, "needs_review");
  assert.equal(f.getState().status, "attention");
  assert.deepEqual(f.submitted.sort(), ["build-0", "build-1", "build-2"]);
  const data = videoData(f.getState().data);
  assert.equal(data.segments[0].buildId, "build-0");
  assert.equal(data.segments[0].candidateKey, undefined);
  assert.ok(data.segments[1].candidateKey && data.segments[2].candidateKey);
  assert.equal(data.segments[3].buildId, undefined);
  assert.equal(f.permits.get("sixrefjob:0:0")?.status, "unknown");
  assert.equal(f.permits.get("sixrefjob:1:0")?.status, "released");
  assert.equal(f.permits.get("sixrefjob:2:0")?.status, "released");
});

test("reconcile inspects only the existing build and releases its slot after proven terminal failure", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const f = await fixture(t, "unknown");
  await processSixRefVideoJob(f.getState(), "worker");
  assert.equal(f.permits.get("sixrefjob:0:0")?.status, "unknown");
  const job = f.getState();
  job.phase = "reconcile";
  job.status = "generating";
  job.lease_owner = "worker";
  job.lease_until = new Date(Date.now() + 300_000);
  const priorSubmissions = [...f.submitted];
  const priorInspectCount = f.inspected.length;
  f.setMode("terminal");
  assert.equal(await processSixRefVideoJob(job, "worker"), "safe");
  assert.deepEqual(f.submitted, priorSubmissions);
  assert.deepEqual(f.inspected.slice(priorInspectCount), ["build-0", "build-0"]);
  assert.equal(f.getResumed(), 0);
  assert.equal(f.permits.get("sixrefjob:0:0")?.status, "released");
  assert.equal(videoData(f.getState().data).segments[0].terminalFailure, true);
  assert.equal(f.getState().status, "review");
});

async function readyAssembly(t: test.TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(await processSixRefVideoJob(f.getState(), "worker"), "safe");
  const source = path.join(f.storage, "videos/sixrefjob/source.mp4");
  await mkdir(path.dirname(source), { recursive: true });
  await ffmpeg(process.env.VIDEO_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=30", "-t", "16", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source], { windowsHide: true });
  const sourceBytes = (await readFile(source)).length;
  const delegate = prisma.videoAsset as unknown as Record<string, unknown>;
  const previous = delegate.findFirst;
  delegate.findFirst = async () => ({ storage_key: "videos/sixrefjob/source.mp4", size_bytes: sourceBytes });
  t.after(() => { delegate.findFirst = previous; });
  const job = f.getState();
  for (const segment of videoData(job.data).segments) segment.accepted = true;
  job.phase = "assemble";
  job.status = "assembling";
  job.lease_owner = "worker";
  job.lease_until = new Date(Date.now() + 300_000);
  return job;
}

test("accepted candidates assemble to one full 16-second 720x1280 30fps output without another paid call", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const f = await fixture(t);
  const job = await readyAssembly(t, f);
  const builds = [...f.submitted];
  assert.equal(await processSixRefVideoJob(job, "worker"), "safe");
  assert.equal(f.getState().status, "completed");
  assert.deepEqual(f.submitted, builds);
  const data = videoData(f.getState().data);
  assert.equal(data.outputKey, "videos/sixrefjob/output.mp4");
  const output = path.join(f.storage, data.outputKey!);
  const media = await probeMedia(output);
  assert.equal(media.width, 720);
  assert.equal(media.height, 1280);
  assert.ok(Math.abs(media.duration - 16) < 0.12);
  const { stdout } = await ffmpeg(process.env.VIDEO_FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,nb_frames", "-of", "json", output], { windowsHide: true });
  const stream = JSON.parse(stdout).streams?.[0];
  assert.equal(stream?.avg_frame_rate, "30/1");
  assert.equal(Number(stream?.nb_frames), 480);
  const outputHash = sha(await readFile(output));
  assert.match(outputHash, /^[a-f0-9]{64}$/);
  assert.equal(outputHash, sha(await readFile(path.join(f.work, "sixrefjob/six-output.mp4"))));
});

test("assembly refuses a candidate whose stored bytes changed after review", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const f = await fixture(t);
  const job = await readyAssembly(t, f);
  const data = videoData(job.data);
  await writeFile(path.join(f.storage, data.segments[2].candidateKey!), Buffer.from("changed after review"));
  const builds = [...f.submitted];
  await processSixRefVideoJob(job, "worker");
  assert.deepEqual(f.submitted, builds);
  assert.equal(videoData(f.getState().data).outputKey, undefined);
  assert.notEqual(f.getState().status, "completed");
  assert.match(f.getState().error ?? "", /不一致/);
});

test("free prepare snapshots the selected windows and blocks a changed character original before any paid call", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sixref-prepare-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const storage = path.join(root, "storage"), work = path.join(root, "work"), jobId = "preparejob";
  for (const [name, value] of Object.entries({ VIDEO_STORAGE_DIR: storage, VIDEO_WORK_ROOT: work, R2_ENDPOINT: "", VIDEO_PAID_GENERATION_ENABLED: "false" })) {
    const prior = process.env[name]; process.env[name] = value;
    t.after(() => { if (prior === undefined) delete process.env[name]; else process.env[name] = prior; });
  }
  const source = path.join(storage, `videos/${jobId}/source.mp4`);
  await mkdir(path.dirname(source), { recursive: true });
  await ffmpeg(process.env.VIDEO_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=30", "-t", "16.3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source], { windowsHide: true });
  const globalRefs = Array.from({ length: 5 }, (_, i) => ({ asset_id: `global${i}`, role: i === 0 ? "start_state" : "character", label: `global ${i}` }));
  const windows = [5, 6, 5.3];
  const data = parseSixReferencePlan({ reference_assets: globalRefs, segment_plan: windows.map((duration, i) => ({
    start: windows.slice(0, i).reduce((sum, n) => sum + n, 0), source_duration: duration, duration: i === 1 ? 6 : 5,
    instructions: `Action ${i}`, before_state: `Before ${i}`, after_state: `After ${i}`,
    reference_assets: Array.from({ length: 5 }, (_, j) => ({ asset_id: `owner${i}ref${j}`, role: j === 0 ? "start_state" : "character", label: `owner segment ${i} picture ${j}` })),
  })) });
  let state = { id: jobId, user_id: "owner", source_asset_id: "source", instructions: "Preserve action", preserve_audio: false,
    status: "preparing", phase: "prepare_sixref", stage: "", revision: 1, lease_owner: "worker", lease_until: new Date(Date.now() + 300_000), data } as unknown as VideoJob;
  const image = await sharp({ create: { width: 14, height: 18, channels: 3, background: "pink" } }).png().toBuffer();
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const value = String(url); fetched.push(value);
    assert.match(value, /^https:\/\/images\.example\.invalid\/owner\dref\d\.png$/);
    return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
  });
  let paidCalls = 0;
  t.mock.method(sixRefRunner, "submitH3", async () => { paidCalls++; throw new Error("paid call during prepare"); });
  const stub = (model: object, method: string, fn: (...args: any[]) => unknown) => {
    const delegate = model as Record<string, (...args: any[]) => unknown>;
    const previous = delegate[method]; delegate[method] = fn;
    t.after(() => { delegate[method] = previous; });
  };
  let characterPins: Row[] = [];
  stub(prisma.videoJobCharacterBinding, "findMany", async () => characterPins);
  stub(prisma.videoAsset, "findFirst", async () => ({ storage_key: `videos/${jobId}/source.mp4`, size_bytes: (await readFile(source)).length }));
  stub(prisma.uploadedAsset, "findFirst", async ({ where }: Row) => {
    assert.equal(where.user_id, "owner");
    return { id: where.id, image_url: `https://images.example.invalid/${where.id}.png` };
  });
  stub(prisma.videoJob, "findFirst", async () => structuredClone(state));
  stub(prisma.videoJob, "updateMany", async ({ where, data: patch }: Row) => {
    assert.equal(where.revision, state.revision);
    state = { ...state, ...structuredClone(patch), revision: state.revision + 1 } as VideoJob;
    return { count: 1 };
  });
  assert.equal(await processSixRefVideoJob(state, "worker"), "safe");
  assert.equal(state.status, "review");
  assert.equal(paidCalls, 0);
  const result = videoData(state.data);
  assert.equal(result.imageCalls, 0);
  assert.equal(result.segments.length, 3);
  assert.ok(Math.abs(result.sourceDuration! - 16.3) < 0.02);
  assert.deepEqual(result.segments.map(s => s.sourceWindowDuration), [5, 6, 5.3]);
  assert.equal(fetched.length, 15);
  for (const segment of result.segments) {
    assert.equal(segment.referenceImages?.length, 5);
    assert.ok(segment.referenceImages!.every(ref => ref.assetId.startsWith(`owner${segment.index}ref`) && ref.key && ref.sha256));
    for (const ref of segment.referenceImages!) assert.equal(sha(await readFile(path.join(storage, ref.key!))), ref.sha256);
    const clip = path.join(storage, segment.clipKey!);
    const media = await probeMedia(clip);
    assert.equal(media.hasAudio, true);
    assert.equal(media.audioCodec, "aac");
    assert.ok(Math.abs(media.duration - segment.duration) < 0.12);
    assert.equal(segment.candidateKey, undefined);
  }
  characterPins = [{ segment_index: 0, reference_index: 1, character_version_id: "fixed-version", image_index: 0,
    character_version: { character: { user_id: "owner", archived: true, latest_version_id: "a-newer-version" }, images: [{
      position: 0, asset_id: "owner0ref1", image_content_id: "fixed-content",
      asset: { user_id: "owner", image_content_id: "fixed-content" },
      image_content: { user_id: "owner", sha256: sha(Buffer.from("the-original-before-it-changed")) },
    }] } }];
  state = { ...state, data: structuredClone(data) as unknown as VideoJob["data"], status: "preparing", phase: "prepare_sixref", revision: 1,
    lease_owner: "worker", lease_until: new Date(Date.now() + 300_000), error: null };
  assert.equal(await processSixRefVideoJob(state, "worker"), "safe");
  assert.equal(state.status, "failed");
  assert.match(state.error ?? "", /人物原图与已选版本不一致/);
  assert.equal(paidCalls, 0);
  assert.ok(videoData(state.data).segments.every(s => !s.submissionIntentAt && !s.buildId));
});
