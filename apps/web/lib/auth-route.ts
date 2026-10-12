import { NextResponse } from "next/server";

/**
 * 认证路由的统一失败出口。
 *
 * 未加保护时，数据库或上游不可用会让 Route Handler 抛异常，Next 返回一个
 * **空 body 的 HTTP 500**。浏览器侧 `response.json()` 于是抛出
 * `SyntaxError: Unexpected end of JSON input`，真正的原因（数据库不可用）
 * 被完全掩盖——这正是 2026-10-12 线上 `/api/auth/lookup` 的表现。
 *
 * 这里统一改成返回结构化 JSON + 503，前端可以据此给出可读提示。
 * 数据库/上游的诊断信息可能包含凭据，只写服务端日志，不回传给客户端。
 */
export async function authRoute(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    console.error(
      "[auth-api] operation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }
}
