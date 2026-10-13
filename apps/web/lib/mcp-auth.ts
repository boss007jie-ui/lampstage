import { prisma } from "@/lib/db";
import { hashApiKey } from "@/lib/api-key";

export type McpAuth =
  | {
      ok: true;
      userId: string;
      /**
       * 命中的那把 key 的 id（归因用）。
       *
       * 一个用户可以持有多把 key，只有 userId 无法区分是哪把在用 ——
       * 排查"客户是不是换了 key""旧 key 是否仍在被调用"时都需要它。
       *
       * ⚠️ 目前**尚未被消费**：`ToolCallLog` 表只有 tool/model/job_id/asset_id 等列，
       * 没有 user_id / key_id。待补两列（可空）后即可写进日志。
       */
      keyId: string;
    }
  | { ok: false; status: 401 | 503; message: string };

/** MCP accepts the same per-user Bearer key as /api/v1, without accepting a browser session. */
export async function authenticateMcp(request: Request): Promise<McpAuth> {
  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+/i.test(header)) return { ok: false, status: 401, message: "Bearer API key required" };
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("lmp_live_")) return { ok: false, status: 401, message: "Invalid API key" };
  try {
    const key = await prisma.apiKey.findUnique({ where: { key_hash: hashApiKey(token) }, select: { id: true, user_id: true, revoked_at: true } });
    if (!key || key.revoked_at) return { ok: false, status: 401, message: "Invalid API key" };
    void prisma.apiKey.update({ where: { id: key.id }, data: { last_used_at: new Date() } }).catch(() => undefined);
    return { ok: true, userId: key.user_id, keyId: key.id };
  } catch {
    return { ok: false, status: 503, message: "API authentication service unavailable" };
  }
}
