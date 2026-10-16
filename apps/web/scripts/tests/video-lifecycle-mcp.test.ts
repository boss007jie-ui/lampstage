import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as capabilitiesGet } from "../../app/api/v1/capabilities/route";
import { MCP_TOOLS, dispatchMcp, mcpToolInternals, safeLifecycleErrorContent } from "../../lib/mcp-tools";

test("lifecycle tools expose the frozen arguments", () => {
  const usage = MCP_TOOLS.find((tool) => tool.name === "get_account_usage");
  const list = MCP_TOOLS.find((tool) => tool.name === "list_video_jobs");
  const cancel = MCP_TOOLS.find((tool) => tool.name === "cancel_video_job");
  const close = MCP_TOOLS.find((tool) => tool.name === "close_video_job");
  assert.deepEqual(usage?.inputSchema.properties, {});
  assert.deepEqual((list?.inputSchema.properties as Record<string, { enum?: readonly string[] }>).status.enum, ["all", "draft", "active", "history"]);
  assert.equal((list?.inputSchema.properties as Record<string, { minimum?: number; maximum?: number }>).limit.minimum, 1);
  assert.equal((list?.inputSchema.properties as Record<string, { minimum?: number; maximum?: number }>).limit.maximum, 50);
  assert.deepEqual(cancel?.inputSchema.required, ["job_id"]);
  assert.deepEqual(close?.inputSchema.required, ["job_id", "expected_revision"]);
  assert.equal((close?.inputSchema.properties as Record<string, { minimum?: number }>).expected_revision.minimum, 0);
});

test("capabilities advertise independent draft and active capacity", async () => {
  const body = await (await capabilitiesGet()).json();
  const lifecycle = body.capabilities.find((entry: { id: string }) => entry.id === "video.replicate").lifecycle;
  assert.deepEqual(lifecycle, { version: 1, draft_limit: 10, active_limit: 10, draft_ttl_seconds: 86400, cancellation: "never_started_drafts", closing: "explicitly_abandoned_stopped_review_or_attention", terminal_statuses: ["completed", "failed", "cancelled"] });
  assert.equal(body.endpoints.account_usage, "/api/v1/account/usage");
  assert.equal(body.endpoints.video_cancel, "/api/v1/video-jobs/:id/cancel");
  assert.equal(body.endpoints.video_close, "/api/v1/video-jobs/:id/close");
});

test("structured quota and cancellation errors retain safe contract only", () => {
  const usage = { observed_at: "2026-10-15T00:00:00.000Z", active: { count: 10, limit: 10, remaining: 0, counted_statuses: ["queued"], includes_unknown_statuses: true }, drafts: { count: 1, limit: 10, remaining: 9, ttl_seconds: 86400 }, terminal_statuses: ["completed", "failed", "cancelled"] };
  const quota = safeLifecycleErrorContent(429, { error: "video_job_limit_reached", scope: "account", quota_bucket: "active", limit: 10, count: 10, remaining: 0, retryable: false, message: "Active capacity is full", usage, actions: ["list_video_jobs", "continue_existing_job"], secret: "DO_NOT_LEAK" });
  assert.equal(quota?.error, "video_job_limit_reached");
  assert.deepEqual(quota?.actions, ["list_video_jobs", "continue_existing_job"]);
  assert.deepEqual(safeLifecycleErrorContent(429, { error: "video_job_limit_reached", scope: "account", quota_bucket: "active", limit: 10, count: 10, remaining: 0, retryable: false, message: "Active capacity is full", usage, actions: ["list_video_jobs", "continue_existing_job", "close_video_job"] })?.actions, ["list_video_jobs", "continue_existing_job", "close_video_job"]);
  assert.equal(JSON.stringify(quota).includes("DO_NOT_LEAK"), false);
  assert.equal(safeLifecycleErrorContent(429, { error: "video_job_limit_reached", message: "oops", authorization: "Bearer leak" }), null);
  const cancel = safeLifecycleErrorContent(409, { error: "video_job_not_cancellable", reason: "permit_history", message: "Cannot cancel", job: { id: "job_1", title: "Demo", status: "queued", stage: "prepare", revision: 1, created_at: "2026-10-15T00:00:00.000Z", updated_at: "2026-10-15T00:00:00.000Z", progress_updated_at: null, counts_toward_limit: true, quota_bucket: "active", can_cancel: false, cancel_blocked_reason: "permit_history", draft_expires_at: null, cancelled_at: null, cancellation_reason: null, provider_secret: "DO_NOT_LEAK" } });
  assert.equal(cancel?.reason, "permit_history");
  assert.equal(JSON.stringify(cancel).includes("DO_NOT_LEAK"), false);
  const close = safeLifecycleErrorContent(409, { error: "video_job_not_closable", reason: "work_in_progress", message: "Cannot close", job: { ...(cancel?.job as Record<string, unknown>), can_close: false, close_blocked_reason: "work_in_progress", provider_secret: "DO_NOT_LEAK" } });
  assert.equal(close?.reason, "work_in_progress");
  assert.equal((close?.job as Record<string, unknown>)?.can_close, false);
  assert.equal(JSON.stringify(close).includes("DO_NOT_LEAK"), false);
  assert.deepEqual(safeLifecycleErrorContent(409, { error: "video_job_cancelled", message: "The draft has expired", diagnostic: "DO_NOT_LEAK" }), { error: "video_job_cancelled", message: "The draft has expired" });
  assert.doesNotThrow(() => safeLifecycleErrorContent(429, { error: { toString() { throw new Error("untrusted coercion"); } } }));
});

test("remote MCP returns the structured safe quota body from a failed HTTP route", async () => {
  const usage = { observed_at: "2026-10-15T00:00:00.000Z", active: { count: 10, limit: 10, remaining: 0, counted_statuses: ["queued"], includes_unknown_statuses: true }, drafts: { count: 1, limit: 10, remaining: 9, ttl_seconds: 86400 }, terminal_statuses: ["completed", "failed", "cancelled"] };
  const upstream = { error: "video_job_limit_reached", scope: "account", quota_bucket: "active", limit: 10, count: 10, remaining: 0, retryable: false, message: "Active capacity is full", usage, actions: ["list_video_jobs", "continue_existing_job"], diagnostic: "DO_NOT_LEAK" };
  assert.equal(typeof mcpToolInternals.routeResult, "function");
  const result = await dispatchMcp({ jsonrpc: "2.0", id: 31, method: "tools/call", params: { name: "prepare_video_job", arguments: { job_id: "job_1" } } }, new Request("https://lampstage.com/api/mcp"), {
    invokeTool: () => mcpToolInternals.routeResult(Response.json(upstream, { status: 429 })),
    logCall: () => {},
  });
  const payload = (result as unknown as { result: { isError: boolean; structuredContent: Record<string, unknown>; content: [{ text: string }] } }).result;
  assert.equal(payload.isError, true);
  assert.equal(payload.structuredContent.error, "video_job_limit_reached");
  assert.equal(payload.structuredContent.quota_bucket, "active");
  assert.deepEqual(JSON.parse(payload.content[0].text), payload.structuredContent);
  assert.equal(JSON.stringify(payload).includes("DO_NOT_LEAK"), false);
});
