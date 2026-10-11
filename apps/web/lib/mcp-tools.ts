import { downloadMcpSource } from "@/lib/mcp-download";
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as capabilitiesGet } from "@/app/api/v1/capabilities/route";
import { POST as assetsPost } from "@/app/api/v1/assets/route";
import { POST as videoAssetsPost } from "@/app/api/v1/video-assets/route";
import { POST as imageJobsPost } from "@/app/api/v1/image-jobs/route";
import { POST as videoJobsPost } from "@/app/api/v1/video-jobs/route";
import { POST as prepareVideoPost } from "@/app/api/v1/video-jobs/[id]/prepare/route";
import { POST as renderVideoPost } from "@/app/api/v1/video-jobs/[id]/render/route";
import { GET as jobsGet } from "@/app/api/v1/jobs/[id]/route";
import { NextRequest } from "next/server";

export const MCP_TOOLS = [
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload a public image or video URL", inputSchema: { type: "object", properties: { source_url: { type: "string", maxLength: 2048 }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "create_image_job", description: "Create an image generation job", inputSchema: { type: "object", properties: { asset_id: { type: "string" }, custom_prompt: { type: "string", minLength: 1, maxLength: 4000 }, image_count: { type: "integer", minimum: 1, maximum: 4 }, platform_style: { type: "string", enum: ["domestic_ecommerce", "brand_site"] }, aspect_ratio: { type: "string", enum: ["1_1", "4_5", "16_9"] } }, required: ["asset_id", "custom_prompt", "image_count"] } },
  { name: "create_video_job", description: "Create a video generation project", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, product_asset_id: { type: "string" }, title: { type: "string", maxLength: 80 }, instructions: { type: "string", maxLength: 2000 }, preserve_audio: { type: "boolean" } }, required: ["source_asset_id", "product_asset_id"] } },
  { name: "prepare_video_job", description: "Prepare reviewable video reference frames", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "render_video_job", description: "Render an approved video through Hypit", inputSchema: { type: "object", properties: { job_id: { type: "string" }, max_coins: { type: "number" } }, required: ["job_id", "max_coins"] } },
  { name: "get_job", description: "Read an image or video job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "download_output", description: "Resolve output URLs for a job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
] as const;

const MCP_ORIGIN = "https://lampstage.com";
type InternalInit = { method?: string; headers?: HeadersInit; body?: BodyInit | null };
function internalRequest(request: Request, path: string, init: InternalInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", request.headers.get("authorization") || "");
  headers.set("Accept", "application/json");
  return new NextRequest(new URL(`/api/v1${path}`, MCP_ORIGIN), { method: init.method, headers, body: init.body ?? undefined });
}
async function routeResult(response: Response | undefined) {
  if (!response) throw new Error("Upstream route returned no response");
  const text = await response.text(); let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { value = { error: text || "invalid upstream response" }; }
  if (!response.ok) { const error = new Error(typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : `Upstream request failed (${response.status})`); (error as Error & { status?: number }).status = response.status; throw error; }
  return value;
}
function stringArg(args: Record<string, unknown>, key: string, required = true) { const value = args[key]; if (typeof value !== "string" || (required && !value.trim())) { const error = new Error(`Invalid parameter: ${key}`) as Error & { code?: number }; error.code = -32602; throw error; } return value; }
function imageArgs(args: Record<string, unknown>) {
  const asset = stringArg(args, "asset_id");
  const prompt = stringArg(args, "custom_prompt");
  if (!Number.isInteger(args.image_count) || (args.image_count as number) < 1 || (args.image_count as number) > 4) { const error = new Error("Invalid parameter: image_count must be an integer from 1 to 4") as Error & { code?: number }; error.code = -32602; throw error; }
  return { ...args, asset_id: asset, custom_prompt: prompt };
}
export async function invokeMcpTool(name: string, args: Record<string, unknown>, request: Request) {
  if (name === "health") return routeResult(await healthGet());
  if (name === "capabilities") return routeResult(await capabilitiesGet());
  if (name === "upload_asset") {
    const kind = args.kind === "video" ? "video" : "image";
    const source = await downloadMcpSource(stringArg(args, "source_url"), kind);
    const form = new FormData(); form.set("file", new Blob([source.bytes], { type: source.mime }), source.filename);
    const route = internalRequest(request, kind === "video" ? "/video-assets" : "/assets", { method: "POST", body: form });
    return routeResult(await (kind === "video" ? videoAssetsPost(route) : assetsPost(route)));
  }
  if (name === "create_image_job") { const payload = imageArgs(args); return routeResult(await imageJobsPost(internalRequest(request, "/image-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, uploaded_asset_id: payload.asset_id }) }))); }
  if (name === "create_video_job") return routeResult(await videoJobsPost(internalRequest(request, "/video-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) })));
  if (name === "prepare_video_job") { const id = stringArg(args, "job_id"); return routeResult(await prepareVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/prepare`, { method: "POST" }), { params: { id } })); }
  if (name === "render_video_job") { const id = stringArg(args, "job_id"); return routeResult(await renderVideoPost(internalRequest(request, `/video-jobs/${encodeURIComponent(id)}/render`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: args.max_coins }) }), { params: { id } })); }
  if (name === "get_job") { const id = stringArg(args, "job_id"); return routeResult(await jobsGet(internalRequest(request, `/jobs/${encodeURIComponent(id)}`), { params: { id } })); }
  if (name === "download_output") { const id = stringArg(args, "job_id"); const job = await routeResult(await jobsGet(internalRequest(request, `/jobs/${encodeURIComponent(id)}`), { params: { id } })) as Record<string, unknown>; const outputs = Array.isArray(job.outputs) ? job.outputs.map((output) => output && typeof output === "object" && "url" in output ? (output as { url?: unknown }).url : null).filter((url): url is string => typeof url === "string") : []; return { job_id: id, output_urls: outputs.length ? outputs : (typeof job.output_url === "string" ? [job.output_url] : []) }; }
  const error = new Error(`Unknown tool: ${name}`) as Error & { code?: number }; error.code = -32602; throw error;
}

type McpRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const validId = (id: unknown) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id) && Number.isInteger(id));
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: validId(id) ? id : null, error: { code, message } });

export function dispatchMcp(item: McpRpc, request: Request) {
  if (item.jsonrpc !== "2.0" || typeof item.method !== "string" || (Object.prototype.hasOwnProperty.call(item, "id") && !validId(item.id))) return Promise.resolve(rpcError(item.id, -32600, "Invalid Request"));
  const id = item.id;
  if (item.method === "notifications/initialized" || item.method === "notifications/cancelled") return Promise.resolve(null);
  if (!Object.prototype.hasOwnProperty.call(item, "id")) return Promise.resolve(rpcError(null, -32600, "Requests must include id"));
  if (item.method === "ping") return Promise.resolve({ jsonrpc: "2.0", id, result: {} });
  if (item.method === "initialize") {
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26";
    const protocolVersion = ["2025-03-26", "2024-11-05"].includes(requested) ? requested : "2025-03-26";
    return Promise.resolve({ jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "lampstage-mcp", version: "1.0.0" } } });
  }
  if (item.method === "tools/list") return Promise.resolve({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
  if (item.method !== "tools/call") return Promise.resolve(rpcError(id, -32601, `Method not found: ${item.method}`));
  const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
  if (typeof params.name !== "string") return Promise.resolve(rpcError(id, -32602, "tools/call requires a tool name"));
  if (!MCP_TOOLS.some((tool) => tool.name === params.name)) return Promise.resolve(rpcError(id, -32602, `Unknown tool: ${params.name}`));
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return Promise.resolve(rpcError(id, -32602, "tools/call arguments must be an object"));
  return invokeMcpTool(params.name, args as Record<string, unknown>, request).then((value) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } })).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === -32602) return rpcError(id, -32602, error instanceof Error ? error.message : String(error));
    const message = error instanceof Error ? error.message : String(error);
    return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: message }] } };
  });
}
