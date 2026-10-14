import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import type { VideoJob } from "@prisma/client";
import { prisma } from "../../lib/db";
import { processVideoJob } from "../../lib/video/processor";
import { parseVideoReferenceInput, preparedReferencesReady } from "../../lib/video/reference-inputs";
import { videoData } from "../../lib/video/types";

test("real direct prepare reaches review with 3 snapshots, 4 clips and zero image or video generation", { skip: process.env.RUN_VIDEO_MEDIA_TESTS !== "1" }, async t => {
  const root = path.resolve(os.tmpdir());
  const workspace = await mkdtemp(path.join(root, "lamp-direct-prepare-"));
  const config = { VIDEO_STORAGE_DIR: path.join(workspace, "storage"), VIDEO_WORK_ROOT: path.join(workspace, "work"),
    R2_ENDPOINT: "", OPENLUX_API_KEY: "", VIDEO_PAID_GENERATION_ENABLED: "false" };
  for (const [key, value] of Object.entries(config)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const image = await sharp({ create: { width: 18, height: 24, channels: 3, background: "pink" } }).png().toBuffer();
  const fetched: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const value = String(url);
    assert.match(value, /^https:\/\/images\.example\.invalid\/(product|baby|mom)\.png$/);
    fetched.push(value);
    return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png" } });
  });
  let state = { id: "job", user_id: "owner", source_asset_id: "source", product_asset_id: "product", instructions: "保留原穿法", preserve_audio: true,
    status: "preparing", phase: "prepare_references", stage: "", revision: 1, lease_owner: "worker", lease_until: new Date(Date.now() + 90_000),
    data: parseVideoReferenceInput({ generation_mode: "direct_references", reference_assets: [
      { asset_id: "baby", role: "character", label: "宝宝" }, { asset_id: "mom", role: "character", label: "妈妈" },
    ] }, "product") } as unknown as VideoJob;
  type Query = { where: { id: string; user_id?: string; lease_owner?: string; revision?: number }; data?: Record<string, unknown> };
  const stub = (model: object, method: string, fn: (q: Query) => unknown) => {
    const delegate = model as Record<string, (q: Query) => Promise<unknown>>;
    const original = delegate[method]; delegate[method] = async q => fn(q);
    t.after(() => { delegate[method] = original; });
  };
  try {
    const source = path.join(config.VIDEO_STORAGE_DIR, "videos/source/source.mp4");
    await mkdir(path.dirname(source), { recursive: true });
    await promisify(execFile)(process.env.VIDEO_FFMPEG_PATH || "ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=30", "-t", "16.3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source], { windowsHide: true });
    const bytes = (await stat(source)).size;
    stub(prisma.videoAsset, "findFirst", q => { assert.equal(q.where.user_id, "owner"); return { storage_key: "videos/source/source.mp4", size_bytes: bytes }; });
    stub(prisma.uploadedAsset, "findFirst", q => { assert.equal(q.where.user_id, "owner"); return { id: q.where.id, image_url: `https://images.example.invalid/${q.where.id}.png` }; });
    stub(prisma.videoJob, "findFirst", () => structuredClone(state));
    stub(prisma.videoJob, "updateMany", q => {
      assert.equal(q.where.id, state.id);
      assert.equal(q.where.lease_owner, "worker");
      if (q.where.revision !== undefined) assert.equal(q.where.revision, state.revision);
      const data = q.data!;
      state = { ...state, ...structuredClone(data), revision: data.revision ? state.revision + 1 : state.revision } as VideoJob;
      return { count: 1 };
    });
    assert.equal(await processVideoJob(state, "worker"), "safe");
    assert.equal(state.status, "review");
    const result = videoData(state.data);
    assert.equal(result.imageCalls, 0);
    assert.equal(result.sourceDuration, 16.3);
    assert.equal(result.segments.length, 4);
    assert.equal(preparedReferencesReady(result), true);
    assert.deepEqual(fetched.map(url => url.split("/").at(-1)), ["product.png", "baby.png", "mom.png"]);
    assert.ok(result.segments.every(s => s.clipKey && !s.openingKey && !s.endingKey && !s.submissionIntentAt && !s.buildId));
    const localFiles = await readdir(path.join(config.VIDEO_WORK_ROOT, "job"));
    assert.deepEqual(localFiles.sort(), ["source-0.mp4", "source-1.mp4", "source-2.mp4", "source-3.mp4", "source.mp4"]);
    for (const ref of result.referenceImages!) assert.ok((await readFile(path.join(config.VIDEO_STORAGE_DIR, ref.key!))).length > 0);
  } finally {
    const resolved = path.resolve(workspace);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith("lamp-direct-prepare-"));
    await rm(resolved, { recursive: true, force: true });
  }
});
