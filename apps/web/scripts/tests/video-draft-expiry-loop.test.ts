import test from "node:test";
import assert from "node:assert/strict";
import { createDraftExpiryLoop } from "../../lib/video/draft-expiry-loop";

test("expiry sweep is bounded, cannot overlap, and carries its cursor past protected records", async () => {
  let paused = false;
  let now = new Date("2026-10-15T12:00:00Z");
  const calls: { cursor: { createdAt: string; id: string } | null; cutoff: Date; limit: number }[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const next = { createdAt: "2026-10-14T01:00:00Z", id: "protected-last" };
  const loop = createDraftExpiryLoop({ paused: () => paused, now: () => now, sweep: async input => {
    calls.push(input);
    if (calls.length === 1) { await gate; return { cursor: next, scanned: 50, blocked: 50, cancelled: 0, done: false }; }
    return { cursor: null, scanned: 1, blocked: 0, cancelled: 1, done: true };
  } });
  const first = loop.run();
  assert.equal(await loop.run(), null);
  assert.equal(calls.length, 1, "overlapping timer must not start another sweep");
  assert.equal(calls[0].limit, 50);
  assert.equal(calls[0].cutoff.toISOString(), "2026-10-14T12:00:00.000Z");
  release(); await first;
  paused = true; assert.equal(await loop.run(), null); assert.equal(calls.length, 1);
  paused = false; now = new Date("2026-10-15T13:00:00Z"); await loop.run();
  assert.deepEqual(calls[1].cursor, next);
  assert.equal(calls[1].cutoff.toISOString(), calls[0].cutoff.toISOString(), "one scan cycle retains its cutoff");
  await loop.run();
  assert.equal(calls[2].cursor, null);
  assert.equal(calls[2].cutoff.toISOString(), "2026-10-14T13:00:00.000Z");
  await loop.stop(); assert.equal(await loop.run(), null);
});
test("a failed sweep releases its busy guard and retries the same page", async () => {
  let calls = 0;
  const loop = createDraftExpiryLoop({ paused: () => false, sweep: async () => {
    calls++; if (calls === 1) throw new Error("isolated fixture failure");
    return { cursor: null, scanned: 0, cancelled: 0, blocked: 0, done: true };
  } });
  await assert.rejects(loop.run(), /fixture/);
  assert.ok(await loop.run()); assert.equal(calls, 2); await loop.stop();
});
