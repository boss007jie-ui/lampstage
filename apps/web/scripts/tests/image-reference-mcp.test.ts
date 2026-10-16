import { test } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { GET as capabilitiesGet } from "../../app/api/v1/capabilities/route";
import { MCP_TOOLS, dispatchMcp, invokeMcpTool } from "../../lib/mcp-tools";

const request = new Request("https://lampstage.com/api/mcp", { headers: { authorization: "Bearer lmp_live_test" } });
const refs = [
  { asset_id: "asset_character", role: "character", label: "Mara", character_version_id: "version_1", image_index: 2 },
  { asset_id: "asset_product", role: "product", label: "Lamp" },
  { asset_id: "asset_scene", role: "scene", label: "Warm room" },
  { asset_id: "asset_detail", role: "product_detail", label: "Switch" },
];

test("MCP schema distinguishes ordered inputs from requested outputs", () => {
  const tool = MCP_TOOLS.find(item => item.name === "create_image_job");
  assert.ok(tool);
  const schema = tool.inputSchema;
  assert.deepEqual(schema.required, ["custom_prompt", "image_count"]);
  assert.deepEqual(schema.oneOf, [{ required: ["asset_id"] }, { required: ["reference_assets"] }]);
  assert.equal(schema.properties.reference_assets.maxItems, 6);
  assert.equal(schema.properties.image_count.maximum, 4);
});

test("four ordered references reach the image route without a legacy asset alias", async () => {
  let calls = 0;
  const args = { reference_assets: refs, custom_prompt: "Place Mara beside the lamp", image_count: 2, image_model: "image_25", aspect_ratio: "1_1" };
  const value = await invokeMcpTool("create_image_job", args, request, { imageJobs: async route => {
    calls++;
    assert.equal(route.headers.get("authorization"), "Bearer lmp_live_test");
    assert.equal(route.nextUrl.pathname, "/api/v1/image-jobs");
    const body = await route.json();
    assert.deepEqual(body.reference_assets, refs);
    assert.equal(body.image_count, 2);
    assert.equal(body.image_model, "image_25");
    assert.equal("asset_id" in body, false);
    assert.equal("uploaded_asset_id" in body, false);
    return NextResponse.json({ job_id: "image_job_1" }, { status: 202 });
  } });
  assert.deepEqual(value, { job_id: "image_job_1" });
  assert.equal(calls, 1);
});

test("legacy single asset is routed with its alias", async () => {
  await invokeMcpTool("create_image_job", { asset_id: "asset_1", custom_prompt: "A lamp", image_count: 1 }, request, { imageJobs: async route => {
    const body = await route.json();
    assert.equal(body.asset_id, "asset_1");
    assert.equal(body.uploaded_asset_id, "asset_1");
    assert.equal(body.image_count, 1);
    return NextResponse.json({ job_id: "image_job_2" }, { status: 202 });
  } });
});

test("invalid or ambiguous MCP inputs fail before an image route call", async () => {
  let calls = 0;
  const imageJobs = async () => { calls++; return NextResponse.json({ job_id: "unexpected" }); };
  const base = { reference_assets: refs, custom_prompt: "A lamp", image_count: 2 };
  const invalid = [
    { ...base, asset_id: "asset_1" },
    { ...base, uploaded_asset_id: "asset_1" },
    { ...base, reference_assets: [...refs, refs[0]] },
    { ...base, reference_assets: refs.map((ref, index) => index === 0 ? { ...ref, image_index: undefined } : ref) },
    { ...base, reference_assets: refs.slice(0, 1).map(ref => ({ ...ref, image_index: 7 })) },
    { ...base, image_count: undefined },
    { ...base, image_count: 5 },
    { ...base, aspect_ratio: "4_5" },
    { ...base, image_model: "unknown" },
    { asset_id: "asset_1", custom_prompt: "A lamp", image_count: 1, reference_assets: [] },
    { custom_prompt: "A lamp", image_count: 1 },
  ];
  for (const args of invalid) await assert.rejects(invokeMcpTool("create_image_job", args, request, { imageJobs }), { code: -32602 });
  assert.equal(calls, 0);
  const rpc = await dispatchMcp({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "create_image_job", arguments: { ...base, uploaded_asset_id: "asset_1" } } }, request, { logCall: () => {} });
  assert.equal((rpc as { error?: { code?: number } }).error?.code, -32602);
});

test("capabilities publish application limits and the provider verification boundary", async () => {
  const catalog = await (await capabilitiesGet()).json();
  const image = catalog.capabilities.find((item: { id: string }) => item.id === "image.generate");
  assert.equal(image.status, "available");
  assert.deepEqual(image.limits, { max_reference_images: 6, max_output_images: 4, supported_aspect_ratios: ["1_1"] });
  assert.deepEqual(image.models.map((model: { id: string }) => model.id), ["nano_banana_21", "image_25"]);
  assert.equal(image.inputs.reference_assets.ordered, true);
  assert.equal(image.inputs.reference_assets.schema_version, 1);
  assert.equal(image.provider_validation.boundary, "offline_only");
});
