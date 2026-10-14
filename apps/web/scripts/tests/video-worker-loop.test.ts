import test from "node:test";
import assert from "node:assert/strict";
import { runWorkerCycle } from "../../lib/video/worker-loop";
import type { VideoJobOutcome } from "../../lib/video/processor";

/** 用 A/B 两个任务的假队列证明：A 结果不明时，B 的领取次数必须为 0。 */
function queue(outcomes: { A: VideoJobOutcome | "throw"; B: VideoJobOutcome }) {
  const claimOrder: string[] = [];
  let calls = 0;
  return {
    claimOrder,
    get claimCalls() { return calls; },
    deps: {
      shouldClaim: () => true,
      claim: async () => {
        calls += 1;
        if (calls === 1) return "A";
        if (calls === 2) return "B";
        return null;
      },
      process: async (job: string): Promise<VideoJobOutcome> => {
        claimOrder.push(job);
        void outcomes.B;
        const outcome = outcomes[job as "A" | "B"];
        if (outcome === "throw") throw new Error("post_processing_state_query_failed");
        return outcome;
      },
    },
  };
}

test("a lease-lost job halts the worker: the queued job B is never claimed", async () => {
  const q = queue({ A: "needs_review", B: "safe" });
  const first = await runWorkerCycle(q.deps);
  assert.deepEqual(first, { claimed: true, processed: true, halted: true, paused: false });
  // 停手后不再进入下一轮 ⇒ B 一次都没被领取
  assert.equal(q.claimCalls, 1);
  assert.deepEqual(q.claimOrder, ["A"]);
});

test("a terminal-save failure (needs_review) also halts before claiming B", async () => {
  const q = queue({ A: "needs_review", B: "safe" });
  const result = await runWorkerCycle(q.deps);
  assert.equal(result.halted, true);
  assert.equal(q.claimCalls, 1);
});

test("a state-query failure that throws is treated as unknown and halts", async () => {
  const q = queue({ A: "throw", B: "safe" });
  const result = await runWorkerCycle(q.deps);
  assert.equal(result.halted, true);
  assert.equal(q.claimCalls, 1);
});

test("positive control: a cleanly finished job lets the worker claim the next one", async () => {
  const q = queue({ A: "safe", B: "safe" });
  const first = await runWorkerCycle(q.deps);
  assert.equal(first.halted, false);
  const second = await runWorkerCycle(q.deps);
  assert.equal(second.claimed, true);
  assert.equal(q.claimCalls, 2);
  assert.deepEqual(q.claimOrder, ["A", "B"]);
});

test("a paused worker does not touch the queue at all", async () => {
  let claimed = false;
  const result = await runWorkerCycle<{ id: string }>({
    shouldClaim: () => false,
    claim: async () => { claimed = true; return { id: "A" }; },
    process: async () => "safe",
  });
  assert.deepEqual(result, { claimed: false, processed: false, halted: false, paused: true });
  assert.equal(claimed, false);
});
