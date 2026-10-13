import { NextRequest, NextResponse } from "next/server";
import { authenticateMcp } from "@/lib/mcp-auth";
import { dispatchMcp } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept" };
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { ...headers, "Content-Type": "application/json" } });
const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
const isNotification = (item: Rpc) => typeof item.method === "string" && item.method.startsWith("notifications/") && !Object.prototype.hasOwnProperty.call(item, "id");
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
    // 刻意不发 `WWW-Authenticate: Bearer`。
    //
    // 本服务只接受静态 Bearer API Key、**没有 OAuth**。而一个不带 resource_metadata 的
    // `WWW-Authenticate: Bearer`，会让 MCP 客户端按授权规范去 /.well-known/* 做 OAuth 发现，
    // 把调用引向一条我们根本没实现的路径；失败信息是与真实原因无关的
    // “Invalid OAuth error response: Unexpected token '<'”，而真正的问题（没配 key）
    // 被完全掩盖。去掉这个头等于声明“本资源不用 OAuth”。
    // 配套：app/api/well-known/[...path]/route.ts 给那些路径返回 JSON 兜底。
    return NextResponse.json({ error: auth.message }, { status: auth.status, headers });
  }
  const text = await readLimitedBody(request, 2 * 1024 * 1024);
  if (text === null) return response(rpcError(null, -32600, "Request body too large"), 413);
  let input: unknown; try { input = JSON.parse(text); } catch { return response(rpcError(null, -32700, "Parse error"), 400); }
  if (Array.isArray(input)) return response(rpcError(null, -32600, "Batch requests are not supported"), 400);
  const batch = [input];
  if (!batch.length || batch.some((item) => !item || typeof item !== "object" || Array.isArray(item))) return response(rpcError(null, -32600, "Invalid Request"), 400);
  const results = await Promise.all(batch.map(async (item) => ({ result: await dispatchMcp(item as Rpc, request), notification: isNotification(item as Rpc) })));
  const replies = results.filter((item) => item.result !== null && !item.notification).map((item) => item.result);
  if (!replies.length) return new NextResponse(null, { status: 202, headers });
  return response(replies[0]);
}

async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function OPTIONS() { return new NextResponse(null, { status: 204, headers }); }
export function GET() { return new NextResponse(null, { status: 405, headers: { ...headers, Allow: "POST, OPTIONS" } }); }
