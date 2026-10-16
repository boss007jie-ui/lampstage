import assert from "node:assert/strict";
import test from "node:test";
import { dispatchMcp, mcpToolInternals } from "../../lib/mcp-tools";
import { safeCandidateReviewErrorContent } from "../../lib/video/candidate-review-error";

const timing = { status: "incompatible", reason: "duration_out_of_range", source_duration: 3.711,
  requested_duration: 4, actual_duration: 107 / 24, trim_start: 0, kept_duration: 107 / 24,
  delivery_duration: 3.7, retime_ratio: (107 / 24) / 3.7, max_retime_ratio: 1.15,
  allowed_kept_duration: { min: 3.711 / 1.15, max: 3.7 * 1.15 }, visual_review_required: true };
const body = { error: "invalid_candidate_review", reason: "duration_incompatible", segment_index: 0, timing };
async function mcpError(upstream: object) {
  return await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "review_video_segments", arguments: { job_id: "test" } } }, new Request("https://lampstage.com/api/mcp"), {
    invokeTool: () => mcpToolInternals.routeResult(Response.json(upstream, { status: 400 })), logCall: () => {},
  }) as any;
}
test("远端MCP保留候选审阅的安全原因与时长，去除任意正文和私有字段", async () => {
  const result = (await mcpError({ ...body, message: "DO_NOT_LEAK", url: "DO_NOT_LEAK", timing: { ...timing, token: "DO_NOT_LEAK" } })).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent?.reason, "duration_incompatible");
  assert.deepEqual(result.structuredContent.timing, timing);
  assert.match(result.structuredContent.message, /15%/);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(JSON.stringify(result).includes("DO_NOT_LEAK"), false);
});
test("未知原因或污染的数值不会进入安全诊断", () => {
  assert.equal(safeCandidateReviewErrorContent(400, { ...body, reason: "DO_NOT_LEAK" }), null);
  assert.equal(safeCandidateReviewErrorContent(500, body), null);
  assert.doesNotThrow(() => safeCandidateReviewErrorContent(400, { ...body, timing: { ...timing, status: { toString: "invalid" } } }));
  for (const bad of ["DO_NOT_LEAK", Infinity, NaN, 1000000, undefined]) {
    const result = safeCandidateReviewErrorContent(400, { ...body, segment_index: 99, timing: { ...timing, actual_duration: bad } });
    assert.equal(result?.timing, undefined);
    assert.equal(result?.segment_index, undefined);
  }
});
test("起态错误穿过远端MCP且不带原始私有字段", async () => {
  const message = "每段第一张参考必须是唯一的 start_state 完整起态图；请核对起始人物、衣物、场景和姿态。";
  const result = (await mcpError({ error: "invalid_video_references", message, secret: "DO_NOT_LEAK" })).result;
  assert.deepEqual(result.structuredContent, { error: "invalid_video_references", message });
  assert.equal(JSON.stringify(result).includes("DO_NOT_LEAK"), false);
});
