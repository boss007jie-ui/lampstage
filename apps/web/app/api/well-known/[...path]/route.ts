import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth 元数据发现路径的 JSON 兜底。
 *
 * 背景：本服务只接受静态 Bearer API Key，**不提供 OAuth**。但 MCP 规范要求客户端在收到
 * 401 后到 well-known 路径寻找 OAuth 元数据（RFC 8414 / RFC 9728）。这些路径原本会落到
 * 应用的 HTML 404 页，于是客户端拿到 `<!DOCTYPE html>` 去 JSON.parse，抛出：
 *
 *     Invalid OAuth error response: SyntaxError: Unexpected token '<', "<!DOCTYPE "...
 *
 * 这个报错把真实原因（没有 API Key）彻底掩盖，用户看到的是莫名奇妙的解析错误而不是"请配置密钥"。
 *
 * 所以这里明确返回 **JSON 格式的 404**：客户端能正确解析，并据此得出
 * "该资源没有 OAuth 元数据、需要其它认证方式"的结论。
 *
 * 路由经由 next.config.mjs 的 rewrite 从 `/.well-known/:path*` 转来 ——
 * Next.js 对点开头的 app 目录支持不可靠，所以不直接放在 `app/.well-known/` 下。
 */

const headers = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
};

function notFound(request: Request) {
  return NextResponse.json(
    {
      error: "not_found",
      detail:
        "This MCP server authenticates with a static Bearer API key (Authorization: Bearer lmp_live_...) and publishes no OAuth metadata.",
      resource: new URL("/api/mcp", request.url).toString(),
      documentation: new URL("/developers", request.url).toString(),
    },
    { status: 404, headers },
  );
}

export function GET(request: Request) {
  return notFound(request);
}

export function POST(request: Request) {
  return notFound(request);
}

export function HEAD(request: Request) {
  return notFound(request);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
