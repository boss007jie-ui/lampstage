/**
 * DeepSeek chat completions 统一配置。
 *
 * 历史：这些调用点原先都走 yunwu.ai 的 OpenAI 兼容代理，模型分别是
 * gpt-5.4-nano / gpt-5.5 / claude-opus-4-8 / gemini-2.5-flash-all。
 * 2026-10-13 起 yunwu 完全剔除，统一改成 DeepSeek。
 *
 * ⚠️ 两个必须知道的事实（2026-10-13 对着真实 API 实测得出）：
 *
 * 1. **`deepseek-flash` 是推理模型**。回复分两段：
 *      · `reasoning_content` —— 思维链
 *      · `content`           —— 真正的正文（代码只读这个）
 *    关键坑：**思维链与正文共享 `max_tokens` 预算**，预算给小了正文就是空串。
 *    实测 `max_tokens: 16` 时 `content=""`、`finish_reason="length"`，
 *    16 个 token 全被思维链吃掉 —— 调用方会以为"模型什么也没说"，
 *    而且 HTTP 仍然是 200，只看状态码根本发现不了。
 *    本模块默认关闭思考（见下），各调用点仍应给足 `max_tokens`。
 *
 * 2. **模型 id 写错不会报错**。DeepSeek 对未知 `model` 名会**静默回落到默认模型**
 *    —— 实测传 `"deepseek-v4-flash"` 返回的响应里是 `"model":"deepseek-flash"`。
 *    所以错 id 只会悄悄跑成别的模型，不会 400。真实可用的 id 只有：
 *      · `deepseek-flash`    —— DeepSeek-V4.1-Flash，`input_modalities: [text, image]`
 *      · `deepseek-v4-pro`   —— 仅文本，**不接受图片输入**
 *    可用列表：`GET https://api.deepseek.com/models`
 *
 * 关于 `thinking: { type: "disabled" }`：
 * 关闭思维链后，同一个 1 词分类任务的 `completion_tokens` 从 16 降到 2，
 * 且正文不可能再被思维链挤空 —— 这既是省钱也是**消除一个静默失败模式**。
 * 用到的 5 个调用点都是「结构化抽取 / 分类 / 生成可机器解析的 JSON」，
 * 思维链对输出形状没有帮助。`prompt-planner.ts` 本来就已经显式关闭，
 * 这里只是把口径统一。
 *
 * 注意：不要用 `effort` 或 `reasoning_effort` 来控制推理量 —— 实测这两个参数
 * 都会被服务端收下但不生效（推理 token 反而从 44 变成 55/59）。
 */

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

/** 关闭思维链的请求片段，配合 body 展开使用。 */
export const THINKING_DISABLED = { type: "disabled" } as const;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * 端点解析优先级：
 *   调用点自己的覆盖 → DEEPSEEK_ENDPOINT → DEEPSEEK_BASE_URL + /chat/completions
 */
export function chatEndpoint(perCallOverride?: string): string {
  if (perCallOverride) return perCallOverride;
  if (process.env.DEEPSEEK_ENDPOINT) return process.env.DEEPSEEK_ENDPOINT;
  const base = process.env.DEEPSEEK_BASE_URL || DEEPSEEK_DEFAULT_BASE_URL;
  return `${normalizeBaseUrl(base)}/chat/completions`;
}

/** 模型解析优先级：调用点自己的覆盖 → `deepseek-flash`。 */
export function chatModel(perCallOverride?: string): string {
  return perCallOverride || DEEPSEEK_DEFAULT_MODEL;
}

/** 统一取 DeepSeek 密钥（原先各调用点读的是 YUNWU_API_KEY）。 */
export function chatApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}
