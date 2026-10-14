#!/usr/bin/env node
// Small dependency-free MCP bridge. The Expert calls this process; this process
// attaches the user's secret to Lampstage API requests. Provider secrets never
// enter the Expert package.
import readline from "node:readline";
import dns from "node:dns/promises";
import net from "node:net";

const base = (process.env.LAMPSTAGE_API_BASE_URL || "https://lampstage.com/api/v1").replace(/\/$/, "");
const key = process.env.LAMPSTAGE_API_KEY || "";

const tools = [
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload an image or video asset", inputSchema: { type: "object", properties: { source_url: { type: "string" }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "create_image_job", description: "Create an image generation job", inputSchema: { type: "object", properties: { asset_id: { type: "string" }, custom_prompt: { type: "string" }, platform_style: { type: "string" }, aspect_ratio: { type: "string" } }, required: ["asset_id"] } },
  { name: "create_video_job", description: "Create a video job. For direct_references, provide exactly two ordered, labeled extra image assets; product_asset_id is Picture 1. Check the video.replicate catalog entry's modes.direct_references first.", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, product_asset_id: { type: "string" }, title: { type: "string" }, instructions: { type: "string" }, preserve_audio: { type: "boolean" }, generation_mode: { type: "string", enum: ["direct_references"] }, reference_assets: { type: "array", minItems: 2, maxItems: 2, items: { type: "object", properties: { asset_id: { type: "string", minLength: 1 }, role: { type: "string", enum: ["character", "scene", "product_detail"] }, label: { type: "string", minLength: 1, maxLength: 80 } }, required: ["asset_id", "role", "label"], additionalProperties: false } } }, required: ["source_asset_id", "product_asset_id"] } },
  { name: "prepare_video_job", description: "Prepare a video job. direct_references freezes the three ordered image references and slices the source video without generating opening/ending frames; legacy jobs may generate paid frames.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "render_video_job", description: "After reviewing all references, source windows and coin quote with explicit budget consent, render through RunningHub Minimax H3", inputSchema: { type: "object", properties: { job_id: { type: "string" }, max_coins: { type: "number" } }, required: ["job_id", "max_coins"] } },
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
  const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
  const MAX_REDIRECTS = 3;
  const MAX_SOURCE_URL_LENGTH = 2048;
  const isPrivate = (address) => {
    const value = address.toLowerCase().split("%")[0];
    if (value.startsWith("::ffff:")) return isPrivate(value.slice(7));
    if (net.isIPv4(value)) {
      const octets = value.split(".").map(Number);
      return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168);
    }
    if (net.isIPv6(value)) {
      return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
        /^fe[89ab]/.test(value);
    }
    return true;
  };
  const checkedUrl = async (value) => {
    if (typeof value !== "string" || value.length > MAX_SOURCE_URL_LENGTH) throw new Error("source_url is too long");
    let url;
    try { url = new URL(value); } catch { throw new Error("source_url must be a valid http(s) URL"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("source_url must be a public http(s) URL");
    const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length || records.some(({ address }) => isPrivate(address))) throw new Error("source_url must resolve to a public address");
    return url;
  };
  let url = await checkedUrl(args.source_url);
  let source;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    source = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (![301, 302, 303, 307, 308].includes(source.status)) break;
    const location = source.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw new Error("source_url redirected too many times");
    url = await checkedUrl(new URL(location, url).toString());
  }
  if (!source.ok) throw new Error(`Unable to read source_url (${source.status})`);
  const declaredLength = Number(source.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) throw new Error("source_url file is too large");
  if (!source.body) throw new Error("source_url returned no file body");
  const reader = source.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("source_url file is too large"); }
    chunks.push(Buffer.from(next.value));
  }
  const mime = source.headers.get("content-type") || (args.kind === "video" ? "video/mp4" : "image/jpeg");
  const form = new FormData();
  form.set("file", new Blob([Buffer.concat(chunks)], { type: mime }), `asset.${mime.includes("video") ? "mp4" : "jpg"}`);
  const path = args.kind === "video" ? "/video-assets" : "/assets";
  return callApi(path, { method: "POST", body: form });
}

async function assertDirectReferencesAvailable() {
  const catalog = await callApi("/capabilities");
  const replicate = catalog?.capabilities?.find?.((entry) => entry.id === "video.replicate");
  if (replicate?.status !== "available" || !replicate?.modes?.direct_references) {
    throw new Error("This Lampstage server does not currently support direct_references. Deploy a server whose video.replicate capability advertises modes.direct_references as available before preparing this job.");
  }
}

function validateDirectReferences(args) {
  if (!Array.isArray(args.reference_assets) || args.reference_assets.length !== 2) throw new Error("direct_references requires exactly two ordered reference_assets");
  const ids = new Set([args.product_asset_id]);
  for (const ref of args.reference_assets) {
    if (!ref || typeof ref.asset_id !== "string" || !ref.asset_id.trim() || !["character", "scene", "product_detail"].includes(ref.role) ||
        typeof ref.label !== "string" || !ref.label.trim() || ref.label.length > 80 ||
        Object.keys(ref).some((field) => !["asset_id", "role", "label"].includes(field))) {
      throw new Error("Each reference needs an asset_id, a supported role and a nonempty label of at most 80 characters");
    }
    if (ids.has(ref.asset_id)) throw new Error("Reference assets and the product asset must be distinct");
    ids.add(ref.asset_id);
  }
}

async function invoke(name, args = {}) {
  if (name === "health" || name === "capabilities") return callApi(`/${name}`);
  if (name === "upload_asset") return uploadAsset(args);
  if (name === "create_image_job") return callApi("/image-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, uploaded_asset_id: args.asset_id }) });
  if (name === "create_video_job") {
    if (args.generation_mode === "direct_references") {
      validateDirectReferences(args);
      await assertDirectReferencesAvailable();
    } else if (args.generation_mode !== undefined || args.reference_assets !== undefined) {
      throw new Error("reference_assets requires generation_mode: direct_references");
    }
    return callApi("/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
  }
  if (name === "prepare_video_job") {
    const job = await callApi(`/jobs/${encodeURIComponent(args.job_id)}`);
    if (job.generation_mode === "direct_references") await assertDirectReferencesAvailable();
    return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/prepare`, { method: "POST" });
  }
  if (name === "render_video_job") return callApi(`/video-jobs/${encodeURIComponent(args.job_id)}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: args.max_coins }) });
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
  if (request.method === "initialize") return respond(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "lampstage-http", version: "0.3.0" } });
  if (request.method === "tools/list") return respond(request.id, { tools });
  if (request.method === "tools/call") {
    try { const value = await invoke(request.params?.name, request.params?.arguments || {}); return respond(request.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }); }
    catch (error) { return respond(request.id, null, error instanceof Error ? error.message : String(error)); }
  }
  respond(request.id, null, `Unsupported method: ${request.method}`);
});
