import { test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { GET as capabilitiesGet } from "../../app/api/v1/capabilities/route";
import { MCP_TOOLS, dispatchMcp, invokeMcpTool, mcpToolInternals, safeVideoReferenceErrorContent, videoTemplateListPath } from "../../lib/mcp-tools";

const request = new Request("https://lampstage.com/api/mcp", { headers: { authorization: "Bearer test" } });
const sha = "a".repeat(64);

test("template and delivery schemas expose explicit bounded input", () => {
  const templateNames = ["get_video_delivery", "submit_video_feedback", "list_video_templates", "get_video_template", "update_video_template"];
  assert.deepEqual(MCP_TOOLS.filter(tool => templateNames.includes(tool.name)).map(tool => tool.name), templateNames);
  const schema = (name: string) => MCP_TOOLS.find(tool => tool.name === name)!.inputSchema as { required?: readonly string[]; additionalProperties?: boolean; properties: Record<string, unknown> };
  assert.deepEqual(schema("submit_video_feedback").required, ["job_id", "decision", "output_sha256"]);
  assert.deepEqual((schema("submit_video_feedback").properties as Record<string, { enum?: readonly string[] }>).decision.enum, ["satisfied_save_template", "satisfied", "needs_changes"]);
  assert.equal((schema("list_video_templates").properties as Record<string, { maximum?: number }>).limit.maximum, 50);
  assert.equal((schema("list_video_templates").properties as Record<string, { maxLength?: number }>).cursor.maxLength, 512);
  assert.equal((schema("submit_video_feedback").properties as Record<string, { pattern?: string }>).output_sha256.pattern, "^[a-f0-9]{64}$");
  assert.equal((schema("submit_video_feedback").properties as Record<string, { minLength?: number }>).name.minLength, undefined);
  const videoPlan = (schema("create_video_job").properties as Record<string, { items?: { properties?: Record<string, { maxLength?: number }> } }>).segment_plan.items!.properties!;
  assert.equal(videoPlan.instructions.maxLength, 1600);
  assert.equal(videoPlan.before_state.maxLength, 400);
  assert.equal(videoPlan.after_state.maxLength, 400);
  assert.equal((schema("create_video_job").properties as Record<string, unknown>).template_version_id !== undefined, true);
  for (const name of templateNames) assert.equal(schema(name).additionalProperties, false);
});

test("capabilities publish private template and delivery endpoints", async () => {
  const body = await (await capabilitiesGet()).json();
  assert.equal(body.endpoints.video_delivery, "/api/v1/video-jobs/:id/delivery");
  assert.equal(body.endpoints.video_feedback, "/api/v1/video-jobs/:id/feedback");
  assert.equal(body.endpoints.video_templates, "/api/v1/video-templates");
  assert.equal(body.endpoints.video_template, "/api/v1/video-templates/:id");
  assert.ok(body.capabilities.some((cap: { id: string }) => cap.id === "video.templates"));
});

test("validated feedback preserves exact output hash and cannot implicitly save", () => {
  const body = mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "satisfied", output_sha256: sha, notes: "Looks good" });
  assert.deepEqual(body, { job_id: "job_1", decision: "satisfied", output_sha256: sha, notes: "Looks good" });
  assert.throws(() => mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "satisfied", output_sha256: sha, template_id: "tpl_1" }), /requires satisfied_save_template/);
  assert.throws(() => mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "satisfied_save_template", output_sha256: "bad" }), /output_sha256/);
  assert.throws(() => mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "satisfied", output_sha256: sha.toUpperCase() }), /output_sha256/);
  assert.equal((mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "satisfied_save_template", output_sha256: sha, name: "" }) as { name: string }).name, "");
  assert.equal((mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "needs_changes", output_sha256: sha, notes: "First line\r\nSecond\titem" }) as { notes: string }).notes, "First line\r\nSecond\titem");
  assert.throws(() => mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "needs_changes", output_sha256: sha, notes: "bad\u0001control" }), /notes/);
  assert.throws(() => mcpToolInternals.validateTemplateArgs("submit_video_feedback", { job_id: "job_1", decision: "needs_changes", output_sha256: sha, notes: "x".repeat(2001) }), /notes/);
  assert.throws(() => mcpToolInternals.validateTemplateArgs("update_video_template", { template_id: "tpl_1", name: "" }), /name/);
});

test("six-reference text bounds reject oversize fields before the create route", async () => {
  const base = { source_asset_id: "asset_1", generation_mode: "six_references", reference_assets: [{ asset_id: "ref_1", role: "scene", label: "Scene" }],
    segment_plan: [{ start: 0, source_duration: 4, duration: 4, instructions: "Move", before_state: "Before", after_state: "After" }] };
  for (const [field, length] of [["instructions", 1601], ["before_state", 401], ["after_state", 401]] as const) {
    const args = { ...base, segment_plan: [{ ...base.segment_plan[0], [field]: "x".repeat(length) }] };
    await assert.rejects(invokeMcpTool("create_video_job", args, request), (error: unknown) => {
      assert.equal((error as { code?: number }).code, -32602);
      assert.equal((error as Error).message, `Invalid segment_plan[0].${field}`);
      return true;
    });
  }
});

test("template list query values are URL encoded after validation", () => {
  const cursor = Buffer.from(JSON.stringify({ v: 1, created_at: "2026-10-15T00:00:00.000Z", id: "tpl_1" })).toString("base64url");
  const path = videoTemplateListPath({ status: "archived", source_asset_id: "asset_1", source_sha256: sha, limit: 20, cursor });
  assert.equal(path, `/video-templates?status=archived&source_asset_id=asset_1&source_sha256=${sha}&limit=20&cursor=${cursor}`);
  assert.equal(videoTemplateListPath({}), "/video-templates");
  assert.throws(() => videoTemplateListPath({ cursor: "page+/=" }), /cursor/);
  assert.throws(() => videoTemplateListPath({ cursor: "x".repeat(513) }), /cursor/);
});

test("valid tools dispatch to the matching private v1 routes with exact method, path and body", async () => {
  const seen: string[] = [];
  const authenticated = (route: Request) => assert.equal(route.headers.get("authorization"), "Bearer test");
  const routes = {
    delivery: async (route: Request, context: { params: { id: string } }) => {
      seen.push("delivery"); authenticated(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/video-jobs/job_1/delivery"); assert.equal(context.params.id, "job_1");
      return NextResponse.json({ job_id: "job_1", output: null });
    },
    feedback: async (route: Request, context: { params: { id: string } }) => {
      seen.push("feedback"); authenticated(route);
      assert.equal(route.method, "POST"); assert.equal(new URL(route.url).pathname, "/api/v1/video-jobs/job_1/feedback"); assert.equal(context.params.id, "job_1");
      assert.deepEqual(await route.json(), { decision: "satisfied_save_template", output_sha256: sha, name: "Approved", template_id: "tpl_1" });
      return NextResponse.json({ version_id: "ver_1" });
    },
    list: async (route: Request) => {
      seen.push("list"); authenticated(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/video-templates");
      assert.equal(new URL(route.url).searchParams.get("source_sha256"), sha);
      assert.equal(new URL(route.url).searchParams.get("limit"), "20");
      return NextResponse.json({ templates: [], next_cursor: null });
    },
    detail: async (route: Request, context: { params: { id: string } }) => {
      seen.push("detail"); authenticated(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/video-templates/tpl_1");
      assert.equal(new URL(route.url).searchParams.get("version_id"), "ver_1"); assert.equal(context.params.id, "tpl_1");
      return NextResponse.json({ template: { id: "tpl_1" } });
    },
    update: async (route: Request, context: { params: { id: string } }) => {
      seen.push("update"); authenticated(route);
      assert.equal(route.method, "PATCH"); assert.equal(new URL(route.url).pathname, "/api/v1/video-templates/tpl_1"); assert.equal(context.params.id, "tpl_1");
      assert.deepEqual(await route.json(), { name: "Renamed", archived: true });
      return NextResponse.json({ template: { id: "tpl_1", name: "Renamed" } });
    },
  };
  assert.deepEqual(await invokeMcpTool("get_video_delivery", { job_id: "job_1" }, request, routes), { job_id: "job_1", output: null });
  assert.deepEqual(await invokeMcpTool("submit_video_feedback", { job_id: "job_1", decision: "satisfied_save_template", output_sha256: sha, name: "Approved", template_id: "tpl_1" }, request, routes), { version_id: "ver_1" });
  assert.deepEqual(await invokeMcpTool("list_video_templates", { source_sha256: sha, limit: 20 }, request, routes), { templates: [], next_cursor: null });
  assert.deepEqual(await invokeMcpTool("get_video_template", { template_id: "tpl_1", version_id: "ver_1" }, request, routes), { template: { id: "tpl_1" } });
  assert.deepEqual(await invokeMcpTool("update_video_template", { template_id: "tpl_1", name: "Renamed", archived: true }, request, routes), { template: { id: "tpl_1", name: "Renamed" } });
  assert.deepEqual(seen, ["delivery", "feedback", "list", "detail", "update"]);
});

test("private route outcomes remain 401 for no auth and 404 for foreign ids", async () => {
  const routes = {
    detail: async (route: Request) => NextResponse.json({ error: route.headers.get("authorization") ? "not_found" : "unauthorized" }, { status: route.headers.get("authorization") ? 404 : 401 }),
  };
  await assert.rejects(invokeMcpTool("get_video_template", { template_id: "foreign_tpl" }, request, routes), /not_found/);
  await assert.rejects(invokeMcpTool("get_video_template", { template_id: "tpl_1" }, new Request(request.url), routes), /unauthorized/);
});

test("invalid new-tool arguments fail before a route is invoked", async () => {
  const invalid: [string, Record<string, unknown>][] = [
    ["get_video_delivery", { job_id: "job_1", unexpected: true }],
    ["submit_video_feedback", { job_id: "job_1", decision: "needs_changes", output_sha256: sha, notes: "x".repeat(2001) }],
    ["list_video_templates", { limit: 51 }],
    ["get_video_template", { template_id: "tpl/1" }],
    ["update_video_template", { template_id: "tpl_1", archived: "yes" }],
    ["create_video_job", { source_asset_id: "asset_1", template_version_id: "bad/id" }],
  ];
  for (const [name, args] of invalid) {
    await assert.rejects(invokeMcpTool(name, args, request), (error: unknown) => (error as { code?: number }).code === -32602, name);
  }
});

test("only fixed known reference validation messages survive the MCP boundary", async () => {
  const known = "动作分段未覆盖完整原视频，请根据实际时长修正计划。";
  assert.deepEqual(safeVideoReferenceErrorContent(400, { error: "invalid_video_references", message: known, secret: "DO_NOT_LEAK" }), { error: "invalid_video_references", message: known });
  assert.equal(safeVideoReferenceErrorContent(400, { error: "invalid_video_references", message: "Bearer secret" }), null);
  assert.equal(safeVideoReferenceErrorContent(500, { error: "invalid_video_references", message: known }), null);
  const result = await dispatchMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_video_job", arguments: {} } }, request, {
    invokeTool: () => mcpToolInternals.routeResult(Response.json({ error: "invalid_video_references", message: known, secret: "DO_NOT_LEAK" }, { status: 400 })), logCall: () => {},
  });
  const payload = (result as { result: { structuredContent: unknown; content: { text: string }[] } }).result;
  assert.deepEqual(payload.structuredContent, { error: "invalid_video_references", message: known });
  assert.equal(JSON.stringify(payload).includes("DO_NOT_LEAK"), false);
});

test("arbitrary thrown route exceptions never reach tool output", async () => {
  const result = await dispatchMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_video_delivery", arguments: { job_id: "job_1" } } }, request, {
    invokeTool: async () => { throw new Error("https://private.example/Bearer-secret"); }, logCall: () => {},
  });
  assert.equal(JSON.stringify(result).includes("private.example"), false);
  assert.match(JSON.stringify(result), /Tool request failed/);
});
