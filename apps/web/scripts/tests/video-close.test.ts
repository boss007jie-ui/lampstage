import assert from "node:assert/strict";
import test from "node:test";
import { summarizeVideoJob, videoJobClosureBlock, type ClosePermit } from "../../lib/video/job-lifecycle";

function job(data: Record<string, unknown> = {}) {
  return { id: "job", title: "Original task", status: "review", phase: "render", stage: "Review",
    revision: 4, lease_owner: null as string | null, lease_until: null as Date | null, error: "retained failure",
    created_at: new Date("2026-10-16T01:00:00Z"), updated_at: new Date("2026-10-16T01:05:00Z"),
    data: { version: 1, generationMode: "six_references", imageCalls: 0, segments: [{ index: 0, attempt: 0 }], ...data } };
}
const released: ClosePermit[] = [{ attempt_id: "job:0:0", status: "released" }];

test("only quiescent review and attention jobs are closable; expired leases still block", () => {
  assert.equal(videoJobClosureBlock(job(), []), null);
  assert.equal(videoJobClosureBlock({ ...job(), status: "attention" }, []), null);
  for (const status of ["draft", "queued", "preparing", "generating", "assembling", "completed", "failed", "cancelled", "future"]) {
    assert.equal(videoJobClosureBlock({ ...job(), status }, []), "not_closable_state", status);
  }
  for (const lease of [
    { lease_owner: "worker", lease_until: null },
    { lease_owner: null, lease_until: new Date(0) },
    { lease_owner: "worker", lease_until: new Date(0) },
    { lease_owner: "worker", lease_until: new Date(Date.now() + 60000) },
  ]) assert.equal(videoJobClosureBlock({ ...job(), ...lease }, []), "lease_present");
  for (const status of ["active", "unknown", "future"]) {
    assert.equal(videoJobClosureBlock(job(), [{ attempt_id: "job:0:0", status }]), "unreleased_permit");
  }
});

test("current and historical submission evidence needs a matching terminal proof", () => {
  for (const field of ["submissionIntentAt", "buildId", "providerTaskId"]) {
    const segment = { index: 0, attempt: 0, [field]: "retained-receipt" };
    assert.equal(videoJobClosureBlock(job({ segments: [segment] }), []), "unresolved_submission");
    assert.equal(videoJobClosureBlock(job({ segments: [segment] }), released), null);
    assert.equal(videoJobClosureBlock(job({ segments: [segment] }), [{ attempt_id: "job:0:1", status: "released" }]), "unresolved_submission");
    assert.equal(videoJobClosureBlock(job({ segments: [{ ...segment, candidateKey: "private/candidate.mp4" }] }), []), null);
    assert.equal(videoJobClosureBlock(job({ segments: [{ ...segment, terminalFailure: true }] }), []), null);
    const history = { attempt: 0, [field]: "old-receipt", reason: "requested revision" };
    const next = { index: 0, attempt: 1, history: [history] };
    assert.equal(videoJobClosureBlock(job({ segments: [next] }), []), "unresolved_submission");
    assert.equal(videoJobClosureBlock(job({ segments: [next] }), released), null);
    assert.equal(videoJobClosureBlock(job({ segments: [{ ...next, history: [{ ...history, candidateKey: "private/old.mp4" }] }] }), []), null);
  }
  assert.equal(videoJobClosureBlock(job({ segments: [{ index: 0, buildId: "x", candidateKey: "kept" }] }),
    [{ attempt_id: "job:0:0", status: "unknown" }]), "unreleased_permit");
});

test("legacy reference image intent without a persisted result remains blocked", () => {
  assert.equal(videoJobClosureBlock(job({ generationMode: "legacy_frames", imageCalls: 1 }), []), "unresolved_image_submission");
  assert.equal(videoJobClosureBlock(job({ generationMode: "legacy_frames", imageCalls: 2,
    segments: [{ index: 0, openingKey: "private/opening.png" }] }), []), "unresolved_image_submission");
  assert.equal(videoJobClosureBlock(job({ generationMode: "legacy_frames", imageCalls: 2,
    segments: [{ index: 0, openingKey: "private/opening.png", endingKey: "private/ending.png" }] }), []), null);
  for (const generationMode of ["direct_references", "six_references"]) {
    assert.equal(videoJobClosureBlock(job({ generationMode, imageCalls: 1 }), []), "unresolved_image_submission");
  }
});

test("malformed or unsupported job data fails closed", () => {
  for (const data of [null, [], { version: 2 }, { segments: null }, { imageCalls: -1 },
    { imageCalls: 0.5 }, { generationMode: "future" }, { segments: [{ index: 0 }, { index: 0 }] },
    { segments: [{ index: -1 }] }, { segments: [{ index: 0, attempt: -1 }] },
    { segments: [{ index: 0, history: {} }] }, { segments: [{ index: 0, history: [{ attempt: "0" }] }] }]) {
    const value = data === null || Array.isArray(data) ? data : { ...job().data, ...data };
    assert.equal(videoJobClosureBlock({ ...job(), data: value }, []), "invalid_job_data", JSON.stringify(data));
  }
  assert.equal(videoJobClosureBlock({ ...job(), data: {} }, []), "invalid_job_data");
  assert.equal(videoJobClosureBlock({ ...job(), phase: "future" }, []), "invalid_job_data");
});

test("summary exposes only checked close eligibility and retains explicit closure audit", () => {
  assert.equal(summarizeVideoJob(job()).can_close, false);
  assert.equal(summarizeVideoJob(job(), false, []).can_close, true);
  const summary = summarizeVideoJob({ ...job({ cancellation: { at: "2026-10-16T02:00:00Z",
    reason: "user_closed", previous_revision: 4, previous_status: "review" } }), status: "cancelled", revision: 5 }, false, []);
  assert.equal(summary.can_close, false);
  assert.equal(summary.counts_toward_limit, false);
  assert.equal(summary.quota_bucket, null);
  assert.equal(summary.cancellation_reason, "user_closed");
  assert.equal(summary.cancelled_at, "2026-10-16T02:00:00.000Z");
});
