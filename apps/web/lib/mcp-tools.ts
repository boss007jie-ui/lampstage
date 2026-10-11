import { downloadMcpSource } from "@/lib/mcp-download";

export const MCP_TOOLS = [
  { name: "health", description: "Check Lampstage API health", inputSchema: { type: "object", properties: {} } },
  { name: "capabilities", description: "List Lampstage API capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "upload_asset", description: "Upload a public image or video URL", inputSchema: { type: "object", properties: { source_url: { type: "string", maxLength: 2048 }, kind: { type: "string", enum: ["image", "video"] } }, required: ["source_url"] } },
  { name: "create_image_job", description: "Create an image generation job", inputSchema: { type: "object", properties: { asset_id: { type: "string" }, custom_prompt: { type: "string", maxLength: 4000 }, platform_style: { type: "string", enum: ["domestic_ecommerce", "brand_site"] }, aspect_ratio: { type: "string", enum: ["1_1", "4_5", "16_9"] } }, required: ["asset_id"] } },
  { name: "create_video_job", description: "Create a video generation project", inputSchema: { type: "object", properties: { source_asset_id: { type: "string" }, product_asset_id: { type: "string" }, title: { type: "string", maxLength: 80 }, instructions: { type: "string", maxLength: 2000 }, preserve_audio: { type: "boolean" } }, required: ["source_asset_id", "product_asset_id"] } },
  { name: "prepare_video_job", description: "Prepare reviewable video reference frames", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "render_video_job", description: "Render an approved video through Hypit", inputSchema: { type: "object", properties: { job_id: { type: "string" }, max_coins: { type: "number" } }, required: ["job_id", "max_coins"] } },
  { name: "get_job", description: "Read an image or video job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "download_output", description: "Resolve output URLs for a job", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
] as const;

type RestCall = { request: Request; path: string; init?: RequestInit };
async function rest({ request, path, init }: RestCall) {
  const url = new URL(`/api/v1${path}`, request.url);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", request.headers.get("authorization") || "");
  headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const text = await response.text(); let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { value = { error: text || "invalid upstream response" }; }
  if (!response.ok) { const error = new Error(typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : `Upstream request failed (${response.status})`); (error as Error & { status?: number }).status = response.status; throw error; }
  return value;
}
function stringArg(args: Record<string, unknown>, key: string, required = true) { const value = args[key]; if (typeof value !== "string" || (required && !value.trim())) throw new Error(`Invalid parameter: ${key}`); return value; }
export async function invokeMcpTool(name: string, args: Record<string, unknown>, request: Request) {
  if (name === "health" || name === "capabilities") return rest({ request, path: `/${name}` });
  if (name === "upload_asset") {
    const kind = args.kind === "video" ? "video" : "image";
    const source = await downloadMcpSource(stringArg(args, "source_url"), kind);
    const form = new FormData(); form.set("file", new Blob([source.bytes], { type: source.mime }), source.filename);
    return rest({ request, path: kind === "video" ? "/video-assets" : "/assets", init: { method: "POST", body: form } });
  }
  if (name === "create_image_job") return rest({ request, path: "/image-jobs", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, uploaded_asset_id: args.asset_id }) } });
  if (name === "create_video_job") return rest({ request, path: "/video-jobs", init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) } });
  if (name === "prepare_video_job") return rest({ request, path: `/video-jobs/${encodeURIComponent(stringArg(args, "job_id"))}/prepare`, init: { method: "POST" } });
  if (name === "render_video_job") return rest({ request, path: `/video-jobs/${encodeURIComponent(stringArg(args, "job_id"))}/render`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_references: true, accept_estimate: true, max_coins: args.max_coins }) } });
  if (name === "get_job") return rest({ request, path: `/jobs/${encodeURIComponent(stringArg(args, "job_id"))}` });
  if (name === "download_output") { const job = await rest({ request, path: `/jobs/${encodeURIComponent(stringArg(args, "job_id"))}` }) as Record<string, unknown>; const outputs = Array.isArray(job.outputs) ? job.outputs.map((output) => output && typeof output === "object" && "url" in output ? (output as { url?: unknown }).url : null).filter((url): url is string => typeof url === "string") : []; return { job_id: args.job_id, output_urls: outputs.length ? outputs : (typeof job.output_url === "string" ? [job.output_url] : []) }; }
  throw new Error(`Unknown tool: ${name}`);
}
