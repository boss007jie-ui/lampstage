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
import { nanoBanana21Provider } from "../../lib/providers/openlux-images";

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
  nanoBanana21Provider.generate = (async (input: never) => {
    calls.push(input);
    return { ok: true, bytes: PNG_1x1, mime: "image/png" };
  }) as typeof nanoBanana21Provider.generate;
  try {
    const base = { product: { bytes: PNG_1x1, mime: "image/png" }, frame: PNG_1x1, endpoint: "opening" as const, instructions: "", jobId: "job-control-test" };

    // 开关关闭：beforeSubmit 抛出，provider 必须一次都没被调用
    await assert.rejects(generateReference({ ...base, beforeSubmit: async () => assertVideoPaidGenerationEnabled(E()) }),
      /video_paid_generation_disabled/);
    assert.equal(calls.length, 0);

    // 上游前置检查"延迟完成"后同样要拦：这里用延迟 + 抛错的 beforeSubmit 模拟
    await assert.rejects(generateReference({ ...base, beforeSubmit: async () => { await new Promise(r => setTimeout(r, 30)); throw new Error("lease_lost"); } }),
      /lease_lost/);
    assert.equal(calls.length, 0);

    // 正样本：开关打开时确实会调用 —— 证明上面的 0 不是"假绿灯"
    const out = await generateReference({ ...base, beforeSubmit: async () => assertVideoPaidGenerationEnabled(E({ VIDEO_PAID_GENERATION_ENABLED: "true" })) });
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
