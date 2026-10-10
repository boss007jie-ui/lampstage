#!/usr/bin/env node
// Small dependency-free MCP bridge. The Expert calls this process; this process
// attaches the user's secret to Lampstage API requests. Provider secrets never
// enter the Expert package.
import readline from "node:readline";

const base = (process.env.LAMPSTAGE_API_BASE_URL || "https://lampstage.com/api/v1").replace(/\/$/, "");
const key = process.env.LAMPSTAGE_API_KEY || "";

const tools = [
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload an image or video asset", inputSchema: { type: "object", properties: { source_url: { type: "string" }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "create_image_job", description: "Create an image generation job", inputSchema: { type: "object", properties: { asset_id: { type: "string" }, custom_prompt: { type: "string" }, platform_style: { type: "string" }, aspect_ratio: { type: "string" } }, required: ["asset_id"] } },
  { name: "create_video_job", description: "Create a video generation project", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, product_asset_id: { type: "string" }, title: { type: "string" }, instructions: { type: "string" }, preserve_audio: { type: "boolean" } }, required: ["source_asset_id", "product_asset_id"] } },
  { name: "get_job", description: "Read an image or video job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "download_output", description: "Resolve the latest output URL for a job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
];

async function callApi(path, init = {}) {
  if (!key && path !== "/health" && path !== "/capabilities") throw new Error("LAMPSTAGE_API_KEY is not configured");
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  if (key) headers.set("Authorization", `Bearer ${key}`);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status}: ${data?.error || "Lampstage API request failed"}`);
  return data;
}

async function uploadAsset(args) {
  const source = await fetch(args.source_url);
  if (!source.ok) throw new Error(`Unable to read source_url (${source.status})`);
  const mime = source.headers.get("content-type") || (args.kind === "video" ? "video/mp4" : "image/jpeg");
  const form = new FormData();
  form.set("file", new Blob([await source.arrayBuffer()], { type: mime }), `asset.${mime.includes("video") ? "mp4" : "jpg"}`);
  const path = args.kind === "video" ? "/video-assets" : "/assets";
  return callApi(path, { method: "POST", body: form });
}

async function invoke(name, args = {}) {
  if (name === "health" || name === "capabilities") return callApi(`/${name}`);
  if (name === "upload_asset") return uploadAsset(args);
  if (name === "create_image_job") return callApi("/image-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, uploaded_asset_id: args.asset_id }) });
  if (name === "create_video_job") return callApi("/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (name === "get_job") return callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
  if (name === "download_output") {
    const job = await callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
    return { job_id: args.job_id, output_urls: job.outputs?.map((item) => item.url).filter(Boolean) || (job.output_url ? [job.output_url] : []) };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function respond(id, result, error = null) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error: { code: -32000, message: error } } : { result }) })}\n`);
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request; try { request = JSON.parse(line); } catch { return; }
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") return respond(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lampstage-http", version: "1.0.0" } });
  if (request.method === "tools/list") return respond(request.id, { tools });
  if (request.method === "tools/call") {
    try { const value = await invoke(request.params?.name, request.params?.arguments || {}); return respond(request.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }); }
    catch (error) { return respond(request.id, null, error instanceof Error ? error.message : String(error)); }
  }
  respond(request.id, null, `Unsupported method: ${request.method}`);
});
