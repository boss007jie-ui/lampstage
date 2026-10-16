import { test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { GET as capabilitiesGet } from "../../app/api/v1/capabilities/route";
import { MCP_TOOLS, dispatchMcp, invokeMcpTool, mcpToolInternals } from "../../lib/mcp-tools";

const request = new Request("https://lampstage.com/api/mcp", { headers: { authorization: "Bearer test" } });
const refs = [{ asset_id: "asset_1", label: "Front" }];
const baseVideo = { source_asset_id: "source_1", generation_mode: "six_references", reference_assets: [{ asset_id: "asset_1", role: "character", label: "Front" }],
  segment_plan: [{ start: 0, source_duration: 4, duration: 4, instructions: "Walk", before_state: "Standing", after_state: "Walking" }] };

test("six character tools publish frozen schemas and capabilities", async () => {
  assert.equal(MCP_TOOLS.length, 26);
  assert.deepEqual(MCP_TOOLS.slice(-6).map(t => t.name), ["list_characters", "get_character", "save_character", "save_character_version", "update_character", "list_character_assets"]);
  const schema = (name: string) => MCP_TOOLS.find(t => t.name === name)!.inputSchema as { required?: readonly string[]; additionalProperties?: boolean; properties: Record<string, unknown> };
  assert.deepEqual(schema("save_character").required, ["idempotency_key", "name", "reference_assets"]);
  assert.deepEqual(schema("save_character_version").required, ["character_id", "expected_latest_version_id", "reference_assets"]);
  for (const tool of MCP_TOOLS.slice(-6)) assert.equal(schema(tool.name).additionalProperties, false);
  const cap = await (await capabilitiesGet()).json();
  assert.ok(cap.capabilities.some((item: { id: string }) => item.id === "characters.library"));
  assert.equal(cap.endpoints.characters, "/api/v1/characters");
  assert.equal(cap.endpoints.character_assets, "/api/v1/character-assets");
});

test("character request validation emits exact route paths and bodies", () => {
  const build = mcpToolInternals.characterRequest;
  assert.deepEqual(build("list_characters", { status: "all", q: "C001 妈妈", limit: 20 }), { path: "/characters?status=all&q=C001+%E5%A6%88%E5%A6%88&limit=20" });
  assert.deepEqual(build("get_character", { character_id: "char_1", version_id: "version_2" }), { path: "/characters/char_1?version_id=version_2" });
  assert.deepEqual(build("save_character", { idempotency_key: "stable_1", name: "Mom", reference_assets: refs, description: "Line 1\r\nLine 2\tmore" }),
    { path: "/characters", method: "POST", body: { idempotency_key: "stable_1", name: "Mom", description: "Line 1\r\nLine 2\tmore", reference_assets: refs } });
  assert.deepEqual(build("save_character_version", { character_id: "char_1", expected_latest_version_id: "version_1", reference_assets: refs }),
    { path: "/characters/char_1/versions", method: "POST", body: { expected_latest_version_id: "version_1", reference_assets: refs } });
  assert.deepEqual(build("update_character", { character_id: "char_1", archived: true }), { path: "/characters/char_1", method: "PATCH", body: { archived: true } });
  assert.deepEqual(build("list_character_assets", { limit: 6 }), { path: "/character-assets?limit=6" });
});

test("six valid character tools reach the correct private v1 handlers", async () => {
  const seen: string[] = [];
  const auth = (route: Request) => assert.equal(route.headers.get("authorization"), "Bearer test");
  const routes = {
    listCharacters: async (route: Request) => {
      seen.push("list"); auth(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/characters");
      assert.equal(new URL(route.url).searchParams.get("q"), "C001 Mom");
      return NextResponse.json({ characters: [], next_cursor: null });
    },
    getCharacter: async (route: Request, context: { params: { id: string } }) => {
      seen.push("detail"); auth(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/characters/char_1");
      assert.equal(new URL(route.url).searchParams.get("version_id"), "version_1"); assert.equal(context.params.id, "char_1");
      return NextResponse.json({ character: { id: "char_1" } });
    },
    saveCharacter: async (route: Request) => {
      seen.push("save"); auth(route);
      assert.equal(route.method, "POST"); assert.equal(new URL(route.url).pathname, "/api/v1/characters");
      assert.deepEqual(await route.json(), { idempotency_key: "stable_1", name: "Mom", reference_assets: refs });
      return NextResponse.json({ character: { id: "char_1" }, reused: false }, { status: 201 });
    },
    saveCharacterVersion: async (route: Request, context: { params: { id: string } }) => {
      seen.push("version"); auth(route);
      assert.equal(route.method, "POST"); assert.equal(new URL(route.url).pathname, "/api/v1/characters/char_1/versions"); assert.equal(context.params.id, "char_1");
      assert.deepEqual(await route.json(), { expected_latest_version_id: "version_1", reference_assets: refs });
      return NextResponse.json({ selected_version: { id: "version_2" }, reused: false }, { status: 201 });
    },
    updateCharacter: async (route: Request, context: { params: { id: string } }) => {
      seen.push("update"); auth(route);
      assert.equal(route.method, "PATCH"); assert.equal(new URL(route.url).pathname, "/api/v1/characters/char_1"); assert.equal(context.params.id, "char_1");
      assert.deepEqual(await route.json(), { archived: true });
      return NextResponse.json({ character: { id: "char_1", archived: true } });
    },
    listCharacterAssets: async (route: Request) => {
      seen.push("assets"); auth(route);
      assert.equal(route.method, "GET"); assert.equal(new URL(route.url).pathname, "/api/v1/character-assets");
      assert.equal(new URL(route.url).searchParams.get("limit"), "12");
      return NextResponse.json({ assets: [], next_cursor: null });
    },
  };
  await invokeMcpTool("list_characters", { q: "C001 Mom" }, request, routes);
  await invokeMcpTool("get_character", { character_id: "char_1", version_id: "version_1" }, request, routes);
  await invokeMcpTool("save_character", { idempotency_key: "stable_1", name: "Mom", reference_assets: refs }, request, routes);
  await invokeMcpTool("save_character_version", { character_id: "char_1", expected_latest_version_id: "version_1", reference_assets: refs }, request, routes);
  await invokeMcpTool("update_character", { character_id: "char_1", archived: true }, request, routes);
  await invokeMcpTool("list_character_assets", { limit: 12 }, request, routes);
  assert.deepEqual(seen, ["list", "detail", "save", "version", "update", "assets"]);
});

test("character MCP preserves private route 401/404 and rejects malformed args before handler", async () => {
  let calls = 0;
  const routes = { getCharacter: async (route: Request) => {
    calls += 1;
    return NextResponse.json({ error: route.headers.get("authorization") ? "not_found" : "unauthorized" },
      { status: route.headers.get("authorization") ? 404 : 401 });
  } };
  await assert.rejects(invokeMcpTool("get_character", { character_id: "foreign" }, request, routes), /not_found/);
  await assert.rejects(invokeMcpTool("get_character", { character_id: "mine" }, new Request(request.url), routes), /unauthorized/);
  await assert.rejects(invokeMcpTool("get_character", { character_id: "bad/id" }, request, routes), { code: -32602 });
  assert.equal(calls, 2);
});

test("character conflict codes keep HTTP 409 while private diagnostics stay hidden", async () => {
  for (const errorCode of ["character_idempotency_conflict", "character_binding_required"]) {
    const upstream = { error: errorCode, private_url: "https://private.example/media", diagnostic: "Bearer secret" };
    await assert.rejects(mcpToolInternals.routeResult(NextResponse.json(upstream, { status: 409 })), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 409);
      assert.equal((error as Error).message, errorCode);
      return true;
    });
    const result = await dispatchMcp({ jsonrpc: "2.0", id: 91, method: "tools/call", params: { name: "save_character", arguments: {} } }, request, {
      invokeTool: () => mcpToolInternals.routeResult(NextResponse.json(upstream, { status: 409 })), logCall: () => {},
    });
    assert.match(JSON.stringify(result), new RegExp(errorCode));
    assert.equal(JSON.stringify(result).includes("private.example"), false);
    assert.equal(JSON.stringify(result).includes("Bearer secret"), false);
  }
});

test("invalid character input fails before any route", () => {
  const build = mcpToolInternals.characterRequest;
  const invalid: [string, Record<string, unknown>][] = [
    ["list_characters", { limit: 51 }], ["list_characters", { q: "x".repeat(81) }],
    ["get_character", { character_id: "foreign/id" }], ["save_character", { idempotency_key: "key_1", name: "Mom", reference_assets: [...refs, ...refs] }],
    ["save_character", { idempotency_key: "key_1", name: "", reference_assets: refs }],
    ["save_character", { idempotency_key: "key_1", name: "Mom", reference_assets: refs, description: "bad\u0001" }],
    ["save_character_version", { character_id: "char_1", reference_assets: refs }],
    ["update_character", { character_id: "char_1" }], ["list_character_assets", { cursor: "x".repeat(513) }],
    ["list_character_assets", { unexpected: true }],
  ];
  for (const [name, args] of invalid) assert.throws(() => build(name, args), { code: -32602 }, name);
});

test("top and segment character binding schemas admit fixed versions or explicit one-off null", () => {
  const schema = MCP_TOOLS.find(t => t.name === "create_video_job")!.inputSchema as { properties: Record<string, any> };
  for (const item of [schema.properties.reference_assets.items, schema.properties.segment_plan.items.properties.reference_assets.items]) {
    assert.deepEqual(item.properties.character_version_id.type, ["string", "null"]);
    assert.deepEqual([item.properties.image_index.minimum, item.properties.image_index.maximum], [0, 5]);
    assert.equal(item.additionalProperties, false);
  }
});

test("invalid character binding pairs and unsupported modes fail before create route", async () => {
  const variants = [
    { character_version_id: "version_1" },
    { character_version_id: null, image_index: 0 },
    { image_index: 0 },
    { character_version_id: "version_1", image_index: 6 },
    { character_version_id: "version/1", image_index: 0 },
    { character_version_id: "version_1", image_index: 0, extra: true },
  ];
  for (const variant of variants) await assert.rejects(invokeMcpTool("create_video_job", { ...baseVideo, reference_assets: [{ ...baseVideo.reference_assets[0], ...variant }] }, request), { code: -32602 });
  await assert.rejects(invokeMcpTool("create_video_job", { ...baseVideo, segment_plan: [{ ...baseVideo.segment_plan[0], reference_assets: [{ asset_id: "asset_1", role: "scene", label: "Front", character_version_id: null }] }] }, request), { code: -32602 });
  await assert.rejects(invokeMcpTool("create_video_job", { source_asset_id: "source_1", generation_mode: "direct_references", reference_assets: [{ ...baseVideo.reference_assets[0], character_version_id: "version_1", image_index: 0 }] }, request), { code: -32602 });
});

test("valid fixed/null character bindings survive create dispatch without mutation", async () => {
  const args = { ...baseVideo, template_version_id: "template_v2", reference_assets: [{ ...baseVideo.reference_assets[0], character_version_id: "version_1", image_index: 0 }],
    segment_plan: [{ ...baseVideo.segment_plan[0], reference_assets: [{ asset_id: "asset_2", role: "character", label: "One off", character_version_id: null }] }] };
  const result = await invokeMcpTool("create_video_job", args, request, { videoJobs: async route => {
    assert.equal(route.method, "POST");
    assert.equal(new URL(route.url).pathname, "/api/v1/video-jobs");
    assert.equal(route.headers.get("authorization"), "Bearer test");
    assert.deepEqual(await route.json(), args);
    return NextResponse.json({ id: "job_1", template_version_id: "template_v2" });
  } });
  assert.deepEqual(result, { id: "job_1", template_version_id: "template_v2" });
});
