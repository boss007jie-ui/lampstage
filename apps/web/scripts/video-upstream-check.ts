/**
 * RunningHub 只读核对（不产生任何生成请求、不消耗额度）。
 *
 * 刻意区分四个层次，**不得混为一谈**：
 *   1. config_present —— runnerReadiness 只确认"配置存在"（本地判断，不代表远端可用）
 *   2. auth_ok        —— 远端只读身份校验是否通过
 *   3. workflow_read  —— 工作流读取是否成功
 *   4. generation_ok  —— 真实生成是否成功（本脚本**永远**不做，恒为 null）
 *
 * 它只调用 `POST /api/openapi/getJsonApiFormat`（官方文档的读取型接口，body 仅 apiKey + workflowId）。
 * 输出里不打印密钥、密钥前缀、连接串或签名 URL；一切敏感判断都压缩成布尔结论。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const WORKFLOW_ID = process.env.VIDEO_H3_WORKFLOW_ID?.trim() || "2102537586127491074";
const ENDPOINT = "https://www.runninghub.cn/api/openapi/getJsonApiFormat";

async function main() {
  const apiKey = process.env.RUNNINGHUB_API_KEY_01?.trim() ?? "";
  // 只输出"是否配置"，绝不输出值本身。
  const config = {
    runner_runtime_configured: Boolean(process.env.VIDEO_HYPIT_RUNTIME?.trim()),
    runner_package_root_configured: Boolean(process.env.VIDEO_HYPIT_PACKAGE_ROOT?.trim()),
    api_key_configured: apiKey.length > 0,
    workflow_id: WORKFLOW_ID,
  };
  if (!apiKey) {
    console.log(JSON.stringify({ ...config, auth_ok: false, workflow_read: false, generation_ok: null, note: "account 01 credential is not configured; nothing was sent upstream." }, null, 2));
    return;
  }

  let httpStatus: number | null = null;
  let businessCode: unknown = null;
  let businessMessage: string | null = null;
  let workflowRead = false;
  let nodeCount: number | null = null;
  let modelFields: string[] = [];

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, workflowId: WORKFLOW_ID }),
      signal: AbortSignal.timeout(30_000),
    });
    httpStatus = response.status;
    const payload = (await response.json()) as Record<string, unknown>;
    businessCode = payload.code ?? null;
    // msg 里可能带账号/端点信息，但对排障必要；它是上游返回的业务文案，不含我们的密钥。
    businessMessage = typeof payload.msg === "string" ? payload.msg : null;
    const data = payload.data;
    if (response.ok && (payload.code === 0 || payload.code === undefined) && data && typeof data === "object") {
      workflowRead = true;
      const nodes = Object.values(data as Record<string, unknown>).filter((v) => v && typeof v === "object");
      nodeCount = nodes.length;
      modelFields = Array.from(new Set(
        nodes.flatMap((node) => Object.values(node as Record<string, unknown>))
          .filter((v): v is string => typeof v === "string" && /\.(safetensors|ckpt|pth|pt)$/i.test(v)),
      )).slice(0, 20);
    }
  } catch (error) {
    console.log(JSON.stringify({
      ...config, http_status: httpStatus, auth_ok: false, workflow_read: false, generation_ok: null,
      error: error instanceof Error ? error.name : "UnknownError",
      note: "read-only check did not complete; this says nothing about whether generation would work.",
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ...config,
    http_status: httpStatus,
    business_code: businessCode,
    business_message: businessMessage,
    // auth_ok 只表示"这次只读请求没有报身份错误"，不等于工作流能跑。
    auth_ok: httpStatus === 200 && businessCode === 0,
    workflow_read: workflowRead,
    workflow_node_count: nodeCount,
    workflow_model_files: modelFields,
    // 本脚本不做生成，这里永远是 null——别把它当成"上游验证通过"。
    generation_ok: null,
    note: workflowRead
      ? "read-only workflow metadata retrieved; generation was not attempted."
      : "workflow metadata not retrieved; report this as a failure, do not claim the upstream works.",
  }, null, 2));
}

void main().catch(error => {
  console.error("upstream_check_failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
