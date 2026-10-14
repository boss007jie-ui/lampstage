import test from "node:test";
import assert from "node:assert/strict";
import {
  assertVideoPaidGenerationEnabled,
  paidBoundaryProblem,
  shouldClaimJobs,
  videoMaintenanceReason,
  videoPaidGenerationEnabled,
  videoWorkerPaused,
} from "../../lib/video/control";
import { generateReference } from "../../lib/video/image-reference";
import { createHypitRunner, type CliProcess } from "../../lib/video/hypit-runner";
import { createOpenLuxImageProvider } from "../../lib/providers/openlux-images";
import { nanoBanana21Provider } from "../../lib/providers/openlux-images";

const GENERATE_BASE = {
  prompt: "p", referenceImageUrl: "", aspectRatio: "1_1" as const,
  platformStyle: "brand_site" as const, outputCount: 1, jobId: "job-control-test",
};

test("the provider re-checks the gate AFTER async reference work and BEFORE the real HTTP POST", async () => {
  const sent: string[] = [];
  let referencesRead = 0;
  const provider = createOpenLuxImageProvider("nano_banana_21", {
    apiKey: () => "test-key-not-real",
    log: async () => undefined,
    readReferences: async () => { referencesRead += 1; await new Promise(r => setTimeout(r, 20)); return [{ bytes: PNG_1x1, mime: "image/png" }]; },
    fetch: (async (url: unknown) => { sent.push(String(url)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch,
    resolveImage: async () => ({ bytes: PNG_1x1, mime: "image/png" }),
  });

  // 负样本：参考图预处理完成之后闸门才失败 ⇒ 真正的 HTTP POST 一次都没发出去
  const denied = await provider.generate({ ...GENERATE_BASE, beforeSend: async () => { await new Promise(r => setTimeout(r, 10)); throw new Error("lease_lost"); } });
  assert.equal(denied.ok, false);
  assert.equal(sent.length, 0);
  assert.equal(referencesRead, 1, "预处理必须已经跑过，才能证明闸门确实在它之后");

  // 正样本：闸门通过 ⇒ 确实发出一次请求（证明上面的 0 不是假绿灯）
  await provider.generate({ ...GENERATE_BASE, beforeSend: async () => undefined });
  assert.equal(sent.length, 1);
  assert.equal(referencesRead, 2);
});

test("generateReference enforces the video paid switch by itself, with no callback passed", async () => {
  const calls: unknown[] = [];
  const original = nanoBanana21Provider.generate;
  // spy 必须忠实模拟真实 provider 的契约：**先 await beforeSend，再记一次调用**。
  // 否则"闸门能拦住"这件事在 spy 下永远成立不了，断言就失去意义。
  nanoBanana21Provider.generate = (async (input: { beforeSend?: () => Promise<void> }) => {
    await input.beforeSend?.();
    calls.push(input);
    return { ok: true, bytes: PNG_1x1, mime: "image/png" };
  }) as typeof nanoBanana21Provider.generate;
  try {
    // 关键：**不传** beforeSubmit。开关关闭时仍必须被拦下。
    await assert.rejects(
      generateReference({ product: { bytes: PNG_1x1, mime: "image/png" }, frame: PNG_1x1, endpoint: "opening", instructions: "", jobId: "job-self-gate", env: E() }),
      /video_paid_generation_disabled/);
    assert.equal(calls.length, 0);

    // 正样本：开关打开且不传回调 ⇒ 正常执行一次
    await generateReference({ product: { bytes: PNG_1x1, mime: "image/png" }, frame: PNG_1x1, endpoint: "opening", instructions: "", jobId: "job-self-gate", env: E({ VIDEO_PAID_GENERATION_ENABLED: "true" }) });
    assert.equal(calls.length, 1);
  } finally {
    nanoBanana21Provider.generate = original;
  }
});

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** 构一个只含被测变量的 env（ProcessEnv 在本项目里被 Next 的类型增强要求带 NODE_ENV）。 */
const E = (values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv;

test("video switches are fail-closed: only exact values open them", () => {
  // 缺失 / 空 / 拼错 一律视为关闭
  assert.equal(videoWorkerPaused(E()), true);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: "" })), true);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: "FALSE" })), true);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: "0" })), true);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: "no" })), true);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: "false" })), false);
  assert.equal(videoWorkerPaused(E({ VIDEO_WORKER_PAUSED: " false " })), false);

  assert.equal(videoPaidGenerationEnabled(E()), false);
  assert.equal(videoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "" })), false);
  assert.equal(videoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "TRUE" })), false);
  assert.equal(videoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "1" })), false);
  assert.equal(videoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "yes" })), false);
  assert.equal(videoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "true" })), true);

  assert.throws(() => assertVideoPaidGenerationEnabled(E()), /video_paid_generation_disabled/);
  assert.throws(() => assertVideoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "false" })), /video_paid_generation_disabled/);
  assert.doesNotThrow(() => assertVideoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "true" })));
});

test("worker does not claim jobs unless both switches are open", () => {
  assert.equal(shouldClaimJobs(E()), false);
  assert.equal(shouldClaimJobs(E({ VIDEO_WORKER_PAUSED: "false" })), false);
  assert.equal(shouldClaimJobs(E({ VIDEO_PAID_GENERATION_ENABLED: "true" })), false);
  assert.equal(shouldClaimJobs(E({ VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "false" })), false);
  assert.equal(shouldClaimJobs(E({ VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true" })), true);
});

test("maintenance reason is reported while either switch is closed", () => {
  assert.ok(videoMaintenanceReason(E()));
  assert.ok(videoMaintenanceReason(E({ VIDEO_WORKER_PAUSED: "false" })));
  assert.equal(videoMaintenanceReason(E({ VIDEO_WORKER_PAUSED: "false", VIDEO_PAID_GENERATION_ENABLED: "true" })), null);
});

test("a lease that lapses while inputs are being prepared blocks the next paid submission", () => {
  const now = new Date("2026-10-14T04:00:00Z");
  const live = new Date("2026-10-14T04:01:00Z");
  const expired = new Date("2026-10-14T03:59:59Z");
  const expected = { workerId: "video-a", revision: 7 };

  assert.equal(paidBoundaryProblem(null, expected, now), "no_job");
  assert.equal(paidBoundaryProblem({ leaseOwner: "video-b", leaseUntil: live, revision: 7 }, expected, now), "lease_lost");
  // 读参考帧/准备输入期间租约过期 —— 正是要防的"用旧授权继续花钱"
  assert.equal(paidBoundaryProblem({ leaseOwner: "video-a", leaseUntil: expired, revision: 7 }, expected, now), "lease_lost");
  assert.equal(paidBoundaryProblem({ leaseOwner: "video-a", leaseUntil: null, revision: 7 }, expected, now), "lease_lost");
  // 任务已被别处改动：旧 revision 的授权作废
  assert.equal(paidBoundaryProblem({ leaseOwner: "video-a", leaseUntil: live, revision: 8 }, expected, now), "revision_changed");
  assert.equal(paidBoundaryProblem({ leaseOwner: "video-a", leaseUntil: live, revision: 7 }, expected, now), null);
});

test("paid switch closed means zero reference-image provider calls (with a positive control)", async () => {
  const calls: unknown[] = [];
  const original = nanoBanana21Provider.generate;
  // spy 必须忠实模拟真实 provider 的契约：**先 await beforeSend，再记一次调用**。
  // 否则"闸门能拦住"这件事在 spy 下永远成立不了，断言就失去意义。
  nanoBanana21Provider.generate = (async (input: { beforeSend?: () => Promise<void> }) => {
    await input.beforeSend?.();
    calls.push(input);
    return { ok: true, bytes: PNG_1x1, mime: "image/png" };
  }) as typeof nanoBanana21Provider.generate;
  try {
    const base = { product: { bytes: PNG_1x1, mime: "image/png" }, frame: PNG_1x1, endpoint: "opening" as const, instructions: "", jobId: "job-control-test", env: E() };

    // 开关关闭：beforeSubmit 抛出，provider 必须一次都没被调用
    await assert.rejects(generateReference({ ...base, beforeSubmit: async () => assertVideoPaidGenerationEnabled(E()) }),
      /video_paid_generation_disabled/);
    assert.equal(calls.length, 0);

    // 上游前置检查"延迟完成"后同样要拦：开关打开、但 beforeSubmit 延迟后抛错（模拟租约失效）
    await assert.rejects(generateReference({ ...base, env: E({ VIDEO_PAID_GENERATION_ENABLED: "true" }), beforeSubmit: async () => { await new Promise(r => setTimeout(r, 30)); throw new Error("lease_lost"); } }),
      /lease_lost/);
    assert.equal(calls.length, 0);

    // 正样本：开关打开时确实会调用 —— 证明上面的 0 不是"假绿灯"
    const out = await generateReference({ ...base, env: E({ VIDEO_PAID_GENERATION_ENABLED: "true" }), beforeSubmit: async () => undefined });
    assert.equal(calls.length, 1);
    assert.equal(out.mime, "image/png");
    assert.ok(out.bytes.length > 0);
  } finally {
    nanoBanana21Provider.generate = original;
  }
});

test("paid switch closed means the H3 runner never invokes its CLI (no build, no local prep)", async () => {
  const cliCalls: string[][] = [];
  const fakeProcess: CliProcess = async (_cli, args) => {
    cliCalls.push(args);
    throw new Error("CLI must not run while paid generation is disabled");
  };
  const runner = createHypitRunner({ env: E({ VIDEO_PAID_GENERATION_ENABLED: "false" }), process: fakeProcess });

  await assert.rejects(
    runner.submitH3({
      workspace: "/tmp/never", sourcePath: "a.mp4", productPath: "b.png", openingPath: "c.png", endingPath: "d.png",
      prompt: "test", duration: 5, onBuildId: async () => undefined,
      // 即使调用方给了 beforeSubmit 也不该走到它：开关必须在最前面挡住
      beforeSubmit: async () => { throw new Error("must not be reached"); },
    }),
    /video_paid_generation_disabled/,
  );
  assert.equal(cliCalls.length, 0);
});
