import { NextRequest, NextResponse } from "next/server";
import { authenticateMcp } from "@/lib/mcp-auth";
import { invokeMcpTool, MCP_TOOLS } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept" };
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...headers, "Content-Type": "application/json" } });
const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const isNotification = (item: Rpc) => !Object.prototype.hasOwnProperty.call(item, "id");
const validId = (id: unknown) => id === null || typeof id === "string" || (typeof id === "number" && Number.isFinite(id));

function dispatch(item: Rpc, request: Request) {
  if (item.jsonrpc !== "2.0" || typeof item.method !== "string" || (Object.prototype.hasOwnProperty.call(item, "id") && (!validId(item.id)))) return Promise.resolve(rpcError(item.id, -32600, "Invalid Request"));
  const id = item.id;
  if (item.method === "notifications/initialized" || item.method === "notifications/cancelled") return Promise.resolve(null);
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
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return Promise.resolve(rpcError(id, -32602, "tools/call arguments must be an object"));
  return invokeMcpTool(params.name, args as Record<string, unknown>, request).then((value) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } })).catch((error: unknown) => ({ jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } }));
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    const configured = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).origin === new URL(request.url).origin; } catch { /* handled as forbidden below */ }
    if (!sameOrigin && !configured.includes(origin)) return response({ error: "origin_not_allowed" }, 403);
  }
  const auth = await authenticateMcp(request);
  if (!auth.ok) {
    const authHeaders = auth.status === 401 ? { ...headers, "WWW-Authenticate": "Bearer" } : headers;
    return NextResponse.json({ error: auth.message }, { status: auth.status, headers: authHeaders });
  }
  const text = await request.text();
  if (text.length > 2 * 1024 * 1024) return response(rpcError(null, -32600, "Request body too large"), 413);
  let input: unknown; try { input = JSON.parse(text); } catch { return response(rpcError(null, -32700, "Parse error"), 400); }
  const batch = Array.isArray(input) ? input : [input];
  if (!batch.length || batch.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return response(rpcError(null, -32600, "Invalid Request"), 400);
  if (batch.length > 1 && batch.some((item) => (item as Rpc).method === "initialize")) return response(rpcError(null, -32600, "initialize must be sent alone"), 400);
  const results = await Promise.all(batch.map(async (item) => ({ result: await dispatch(item as Rpc, request), notification: isNotification(item as Rpc) })));
  const replies = results.filter((item) => item.result !== null && !item.notification).map((item) => item.result);
  if (!replies.length) return new NextResponse(null, { status: 202, headers });
  return response(Array.isArray(input) ? replies : replies[0]);
}

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }
export function GET() { return new NextResponse(null, { status: 405, headers: { ...headers, Allow: "POST, OPTIONS" } }); }
