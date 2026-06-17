/**
 * 外部 AI 工具调用日志。
 *
 * 设计原则：fire-and-forget，绝不影响主流程。
 *   - 写库失败只 console.warn，不抛错（日志不能拖垮生图）。
 *   - 提供 timed() 包装器，自动记录耗时 + 成功/失败。
 */
import { prisma } from "@/lib/db";

export type ToolName =
  | "lamp_profile"
  | "prompt_planner"
  | "nano-banana"
  | "gpt-image-2";

export type ToolLogInput = {
  tool: ToolName;
  model?: string | null;
  jobId?: string | null;
  assetId?: string | null;
  status: "ok" | "failed";
  httpStatus?: number | null;
  durationMs?: number | null;
  error?: string | null;
};

/** 写一条调用日志。永不抛错。 */
export async function logToolCall(input: ToolLogInput): Promise<void> {
  try {
    await prisma.toolCallLog.create({
      data: {
        tool: input.tool,
        model: input.model ?? null,
        job_id: input.jobId ?? null,
        asset_id: input.assetId ?? null,
        status: input.status,
        http_status: input.httpStatus ?? null,
        duration_ms: input.durationMs ?? null,
        error: input.error ? input.error.slice(0, 500) : null,
      },
    });
  } catch (e) {
    console.warn("[tool-log] write failed (ignored):", e);
  }
}
