import { test } from "node:test";
import assert from "node:assert/strict";
import { MCP_TOOLS, dispatchMcp as dispatch, invokeMcpTool } from "../../lib/mcp-tools";
import { mcpDownloadInternals } from "../../lib/mcp-download";

const request = new Request("https://lampstage.com/api/mcp", { headers: { authorization: "Bearer lmp_live_test" } });

test("MCP exposes the nine tools and requires explicit generic image inputs", () => {
  assert.equal(MCP_TOOLS.length, 9);
  const image = MCP_TOOLS.find((tool) => tool.name === "create_image_job");
  assert.deepEqual(image?.inputSchema.required, ["asset_id", "custom_prompt", "image_count"]);
  assert.equal((image?.inputSchema.properties as Record<string, { minimum?: number; maximum?: number }>).image_count.minimum, 1);
  assert.equal((image?.inputSchema.properties as Record<string, { minimum?: number; maximum?: number }>).image_count.maximum, 4);
});

test("protocol rejects invalid and id-less calls before invoking tools", async () => {
  const missingId = await dispatch({ jsonrpc: "2.0", method: "tools/call", params: { name: "create_video_job", arguments: {} } }, request);
  assert.equal((missingId as { error?: { code?: number } }).error?.code, -32600);
  const invalid = await dispatch({}, request);
  assert.equal((invalid as { error?: { code?: number } }).error?.code, -32600);
  const unknown = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "missing" } }, request);
  assert.equal((unknown as { error?: { code?: number } }).error?.code, -32602);
});

test("tool failures are safe results and source URL checks reject private and mapped addresses", async () => {
  const failure = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "upload_asset", arguments: { source_url: "http://127.0.0.1/file.jpg" } } }, request);
  assert.equal((failure as { result?: { isError?: boolean } }).result?.isError, true);
  assert.equal(mcpDownloadInternals.isPublicAddress("127.0.0.1"), false);
  assert.equal(mcpDownloadInternals.isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(mcpDownloadInternals.isPublicAddress("fc00::1"), false);
  assert.equal(mcpDownloadInternals.isPublicAddress("2001:db8::1"), false);
  assert.equal(mcpDownloadInternals.isPublicAddress("8.8.8.8"), true);
});

test("image input validation fails without making a REST call", async () => {
  await assert.rejects(invokeMcpTool("create_image_job", { asset_id: "asset", custom_prompt: "", image_count: 3 }, request), /custom_prompt/);
  await assert.rejects(invokeMcpTool("create_image_job", { asset_id: "asset", custom_prompt: "product", image_count: 5 }, request), /image_count/);
});
