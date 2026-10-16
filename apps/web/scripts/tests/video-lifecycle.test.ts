import assert from "node:assert/strict";
import test from "node:test";
import { draftCancellationBlock } from "../../lib/video/job-lifecycle";
import { parseSixReferencePlan } from "../../lib/video/six-reference-plan";

const sixData = () => parseSixReferencePlan({ reference_assets: [{ asset_id: "state", role: "start_state", label: "完整起态" }, { asset_id: "product", role: "product", label: "商品" }],
  segment_plan: [{ start: 0, source_duration: 5, duration: 5, instructions: "动作", before_state: "开始", after_state: "完成" }] });
function job(data: unknown = sixData()) { return { status: "draft", phase: "prepare", revision: 0, lease_owner: null, lease_until: null, error: null, data }; }
test("untouched legacy, direct and planned six-reference drafts can be cancelled", () => {
  assert.equal(draftCancellationBlock(job(), false), null);
  // 历史持久化数据可能没有新合同字段；直接构造旧形状，绕过当前 parser。
  const historicalSix = sixData();
  historicalSix.referenceImages![0].role = "product";
  historicalSix.segments[0].referenceImages![0].role = "product";
  assert.equal(draftCancellationBlock(job(historicalSix), false), null);
  assert.equal(draftCancellationBlock(job({ version: 1, segments: [], imageCalls: 0 }), false), null);
  assert.equal(draftCancellationBlock(job({ version: 1, generationMode: "direct_references", segments: [], imageCalls: 0,
    referenceImages: [{ assetId: "a", role: "product", label: "商品" }, { assetId: "b", role: "character", label: "人物" }, { assetId: "c", role: "scene", label: "场景" }] }), false), null);
});
test("state, lease and every permit history deny cancellation", () => {
  for (const patch of [{ status: "review" }, { phase: "prepare_sixref" }, { revision: 1 }, { lease_owner: "worker" }, { lease_until: new Date(0) }, { error: "old failure" }])
    assert.notEqual(draftCancellationBlock({ ...job(), ...patch }, false), null);
  assert.equal(draftCancellationBlock(job(), true), "permit_history");
});
test("raw malformed or unknown data is never normalized into an empty safe draft", () => {
  for (const data of [null, [], {}, { segments: [] }, { version: 1, segments: [], imageCalls: "0" },
    { version: 1, segments: [], imageCalls: 0, futureExecutionField: true }, { ...sixData(), workflowProfile: "unknown" },
    { ...sixData(), segments: [{}] }]) assert.notEqual(draftCancellationBlock(job(data), false), null);
});
test("reference role checks reject JSON arrays and objects without throwing", () => {
  for (const location of ["global", "segment"]) for (const role of [["product"], { toString: null }, null, 0, true]) {
    const data = sixData(); const refs = location === "global" ? data.referenceImages! : data.segments[0].referenceImages!;
    Object.assign(refs[0], { role });
    assert.notEqual(draftCancellationBlock(job(data), false), null);
  }
});
test("all preparation and generation evidence is protected even when false, empty or terminal", () => {
  for (const [key, value] of Object.entries({ sourceDuration: 5, sourceHasAudio: false, renderConsent: null, progress: {}, outputKey: "", outputSha256: "", outputMedia: {} }))
    assert.notEqual(draftCancellationBlock(job({ ...sixData(), [key]: value }), false), null, key);
  for (const [key, value] of Object.entries({ attempt: 1, history: [], terminalFailure: false, accepted: false, clipKey: "", openingKey: "", endingKey: "", candidateKey: "", candidateSha256: "", candidateMedia: {}, candidateTrimStart: 0, tailKey: "", tailSha256: "", submissionIntentAt: "", buildId: "", providerTaskId: "", error: "" })) {
    const data = sixData(); Object.assign(data.segments[0], { [key]: value });
    assert.notEqual(draftCancellationBlock(job(data), false), null, key);
  }
  for (const location of ["global", "segment"]) {
    const data = sixData(); const refs = location === "global" ? data.referenceImages! : data.segments[0].referenceImages!;
    Object.assign(refs[0], { key: "", sha256: "" });
    assert.notEqual(draftCancellationBlock(job(data), false), null);
  }
});
