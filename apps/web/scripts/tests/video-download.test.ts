import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { downloadStreamToFile } from "../../lib/video/download-stream";
import { privateDownloadTo } from "../../lib/video/storage";

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), "lamp-download-test-"));
}

// 旧实现的写法：FileHandle + autoClose:false。pipeline 会返回，卡住的是后面的 handle.close()。
// 必须在**独立进程**里跑：它可能永远不返回，留在本进程会拖死整个套件。
// 目标路径用环境变量传递（`node -e` 下 argv 的位置容易搞错，env 无歧义）。
const OLD_PATTERN = `
import { createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const target = process.env.LAMP_OLD_TARGET;
const handle = await open(target, "w");
try {
  await pipeline(Readable.from([Buffer.alloc(4 * 1024 * 1024, 7)]), handle.createWriteStream({ autoClose: false }));
} finally {
  await handle.close();
}
process.stdout.write("RETURNED");
`;

test("regression: the old FileHandle pattern never completes (bounded child)", { timeout: 10_000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "old-source.mp4");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", OLD_PATTERN],
      { timeout: 2500, encoding: "utf8", env: { ...process.env, LAMP_OLD_TARGET: target } });
    // 唯一硬断言：它没有正常跑完。这是根因的直接体现——await handle.close() 永不 settle。
    assert.equal(child.stdout?.includes("RETURNED") ?? false, false,
      `旧写法意外完成了：stdout=${JSON.stringify(child.stdout)} stderr=${JSON.stringify(child.stderr)}`);
    // 两种失败形态都算复现（都源于同一个未 settle 的 close）：
    //   ① 进程一直挂住 → 被超时 SIGTERM 杀掉（生产长驻进程的形态）；
    //   ② 短命脚本里事件循环耗尽 → Node 以 13 退出并给 unsettled top-level await 警告。
    const killedByDeadline = child.signal === "SIGTERM";
    const unsettledTopLevelAwait = child.status === 13 || /unsettled top-level await/.test(child.stderr ?? "");
    assert.ok(killedByDeadline || unsettledTopLevelAwait,
      `预期旧写法无法完成，实际 status=${child.status} signal=${child.signal} stderr=${JSON.stringify(child.stderr)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("download returns after writing exact bytes", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "source.mp4");
    const data = Buffer.alloc(1024 * 1024, 7);
    const count = await downloadStreamToFile({ target, maxBytes: data.length,
      timeoutMs: 1000, open: async () => ({ body: Readable.from([data]), expectedBytes: data.length }) });
    assert.equal(count, data.length);
    assert.deepEqual(await readFile(target), data);
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unfinished stream aborts without replacing an existing target", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  const source = new Readable({ read() {} });
  try {
    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    await assert.rejects(downloadStreamToFile({ target, maxBytes: 100, timeoutMs: 80,
      open: async () => ({ body: source }) }));
    assert.equal(source.destroyed, true);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally { source.destroy(); await rm(root, { recursive: true, force: true }); }
});

test("without Content-Length the byte cap still applies and normal EOF succeeds", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "source.mp4");
    const data = Buffer.alloc(4096, 1);
    const count = await downloadStreamToFile({ target, maxBytes: 4096, timeoutMs: 1000,
      open: async () => ({ body: Readable.from([data]) }) });
    assert.equal(count, 4096);
    assert.deepEqual(await readFile(target), data);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("over-limit payload rejects and leaves the old target untouched", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    await assert.rejects(
      downloadStreamToFile({ target, maxBytes: 100, timeoutMs: 1000,
        open: async () => ({ body: Readable.from([Buffer.alloc(200, 3)]) }) }),
      /download_too_large/);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("declared length mismatch and empty stream both reject without leftovers", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    await assert.rejects(
      downloadStreamToFile({ target, maxBytes: 1000, timeoutMs: 1000,
        open: async () => ({ body: Readable.from([Buffer.alloc(50, 3)]), expectedBytes: 100 }) }),
      /download_length_mismatch/);
    await assert.rejects(
      downloadStreamToFile({ target, maxBytes: 1000, timeoutMs: 1000,
        open: async () => ({ body: Readable.from([]), expectedBytes: 10 }) }),
      /download_length_mismatch/);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("declared length above the cap is refused before any bytes are accepted", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  try {
    const target = path.join(root, "source.mp4");
    await assert.rejects(
      downloadStreamToFile({ target, maxBytes: 100, timeoutMs: 1000,
        open: async () => ({ body: Readable.from([Buffer.alloc(10, 3)]), expectedBytes: 5000 }) }),
      /invalid_download_length/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a mid-stream source error is bounded and destroys the source", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  const source = new Readable({
    read() { this.push(Buffer.alloc(16, 5)); queueMicrotask(() => this.destroy(new Error("upstream_reset"))); },
  });
  try {
    const target = path.join(root, "source.mp4");
    await assert.rejects(downloadStreamToFile({ target, maxBytes: 1024, timeoutMs: 1500, open: async () => ({ body: source }) }));
    assert.equal(source.destroyed, true);
    assert.deepEqual(await readdir(root), []);
  } finally { source.destroy(); await rm(root, { recursive: true, force: true }); }
});

test("a request that never yields a body is aborted by the deadline (signal reaches the opener)", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  let sawAbort = false;
  try {
    const target = path.join(root, "source.mp4");
    await assert.rejects(downloadStreamToFile({ target, maxBytes: 1024, timeoutMs: 80,
      open: (signal) => new Promise((_resolve, reject) => {
        sawAbort = true;
        signal.addEventListener("abort", () => reject(new Error("aborted_by_deadline")), { once: true });
      }) }));
    assert.equal(sawAbort, true);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unreachable destination fails bounded, keeps the original file and cancels the source", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  const source = new Readable({ read() { this.push(Buffer.alloc(16, 5)); } });
  try {
    const blocker = path.join(root, "blocker");
    await writeFile(blocker, "original");
    // 父路径是一个普通文件 ⇒ mkdir 必然失败。注意：这只覆盖"目标不可达"，
    // 真正的写入阶段错误由下一条用例（注入写入流）覆盖。
    await assert.rejects(downloadStreamToFile({ target: path.join(blocker, "nested", "source.mp4"),
      maxBytes: 1024, timeoutMs: 1500, open: async () => ({ body: source }) }));
    assert.equal(await readFile(blocker, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["blocker"]);
  } finally { source.destroy(); await rm(root, { recursive: true, force: true }); }
});

test("a real write-stage failure destroys the source, cleans the temp file and keeps the existing target", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  const source = new Readable({ read() { this.push(Buffer.alloc(64, 3)); } });
  try {
    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    // 注入一个必然写失败的写入流：这是"磁盘真的写不进去"，不是 mkdir 失败。
    const failing = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("disk_write_failed")); } });
    await assert.rejects(
      downloadStreamToFile({ target, maxBytes: 1024, timeoutMs: 1500,
        open: async () => ({ body: source }), createWrite: () => failing }),
      /disk_write_failed/);
    assert.equal(source.destroyed, true);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]); // 没有残留 .part
  } finally { source.destroy(); await rm(root, { recursive: true, force: true }); }
});

test("a parent signal cancels the download and cleans up", { timeout: 3000 }, async () => {
  const root = await tempRoot();
  const source = new Readable({ read() { this.push(Buffer.alloc(32, 9)); } });
  const parent = new AbortController();
  try {
    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    const pending = downloadStreamToFile({ target, maxBytes: 1024 * 1024, timeoutMs: 5000,
      signal: parent.signal, open: async () => ({ body: source }) });
    setTimeout(() => parent.abort(), 30);
    await assert.rejects(pending);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally { source.destroy(); await rm(root, { recursive: true, force: true }); }
});

test("invalid limits are refused before touching the filesystem", { timeout: 3000 }, async () => {
  await assert.rejects(downloadStreamToFile({ target: "x", maxBytes: 0, timeoutMs: 10, open: async () => ({ body: Readable.from([]) }) }), /invalid_download_limits/);
  await assert.rejects(downloadStreamToFile({ target: "x", maxBytes: 10, timeoutMs: 0, open: async () => ({ body: Readable.from([]) }) }), /invalid_download_limits/);
});

test("local storage branch keeps temp-file semantics and replaces the target only on success", { timeout: 5000 }, async () => {
  const root = await tempRoot();
  const store = await mkdtemp(path.join(os.tmpdir(), "lamp-video-store-"));
  const saved = {
    endpoint: process.env.R2_ENDPOINT, id: process.env.R2_ACCESS_KEY_ID, secret: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.VIDEO_R2_BUCKET, dir: process.env.VIDEO_STORAGE_DIR,
  };
  try {
    // 摘掉 R2 配置 ⇒ 走本地分支（r2Enabled() 每次调用都读 process.env，不受模块缓存影响）。
    delete process.env.R2_ENDPOINT; delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY; delete process.env.VIDEO_R2_BUCKET;
    process.env.VIDEO_STORAGE_DIR = store;

    const key = "videos/abc/source.mp4";
    await mkdir(path.join(store, "videos", "abc"), { recursive: true });
    await writeFile(path.join(store, key), Buffer.alloc(64, 2));

    const target = path.join(root, "source.mp4");
    await writeFile(target, "original");
    const bytes = await privateDownloadTo(key, target);
    assert.equal(bytes, 64);
    assert.equal((await readFile(target)).length, 64);
    assert.deepEqual(await readdir(root), ["source.mp4"]); // 没有残留 .part

    // 长度不符时不得覆盖已有目标（期望 999 但实际 64）。
    await writeFile(target, "original");
    await assert.rejects(privateDownloadTo(key, target, { expectedBytes: 999 }), /download_length_mismatch/);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.deepEqual(await readdir(root), ["source.mp4"]);
  } finally {
    if (saved.endpoint === undefined) delete process.env.R2_ENDPOINT; else process.env.R2_ENDPOINT = saved.endpoint;
    if (saved.id === undefined) delete process.env.R2_ACCESS_KEY_ID; else process.env.R2_ACCESS_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.R2_SECRET_ACCESS_KEY; else process.env.R2_SECRET_ACCESS_KEY = saved.secret;
    if (saved.bucket === undefined) delete process.env.VIDEO_R2_BUCKET; else process.env.VIDEO_R2_BUCKET = saved.bucket;
    if (saved.dir === undefined) delete process.env.VIDEO_STORAGE_DIR; else process.env.VIDEO_STORAGE_DIR = saved.dir;
    await rm(root, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
});
