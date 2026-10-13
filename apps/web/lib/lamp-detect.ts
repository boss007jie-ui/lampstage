/**
 * 灯具类型轻量识别。
 *
 * 用来做 PRD §6 的"模板不匹配提醒"——上传图后 vs 选定的模板 lamp_type。
 *
 * 实现：调 DeepSeek chat completions（OpenAI 兼容），让视觉模型做 1 词分类。
 * 模型 deepseek-flash（支持图片输入）。见 lib/deepseek.ts 的两个坑。
 */
import { getObjectBytes } from "@/lib/storage";
import { THINKING_DISABLED, chatApiKey, chatEndpoint, chatModel } from "@/lib/deepseek";

const ENDPOINT = chatEndpoint();
const MODEL = chatModel();

export type LampType =
  | "pendant"
  | "wall"
  | "table"
  | "floor"
  | "ceiling"
  | "unknown";

const PROMPT = `Look at this product photo. Classify the lamp type into exactly one of:
- pendant     (吊灯, hangs from ceiling with cord/rod)
- wall        (壁灯/sconce, mounted on a wall)
- table       (台灯, sits on a table or nightstand)
- floor       (落地灯, stands on the floor)
- ceiling     (吸顶灯, flush-mounted on ceiling)
- unknown     (cannot tell or not a lamp)

Reply with EXACTLY one of those single words, nothing else. Lower case.`;

async function imageAsBase64(refUrlOrPath: string): Promise<{ b64: string; mime: string }> {
  const { bytes, mime } = await getObjectBytes(refUrlOrPath);
  return { b64: bytes.toString("base64"), mime };
}

export async function detectLampType(
  refUrlOrPath: string,
): Promise<LampType> {
  const apiKey = chatApiKey();
  if (!apiKey) return "unknown";

  let img;
  try {
    img = await imageAsBase64(refUrlOrPath);
  } catch {
    return "unknown";
  }

  const body = {
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.b64}` },
          },
        ],
      },
    ],
    // 关闭思考，否则思维链会吃掉 max_tokens 预算、content 返回空串
    // （实测开思考 + max_tokens=16 → content=""）。关闭后本任务只用 2 个 token。
    max_tokens: 64,
    temperature: 0,
    thinking: THINKING_DISABLED,
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    const cleaned = raw.replace(/[^a-z]/g, "");
    if (
      cleaned === "pendant" ||
      cleaned === "wall" ||
      cleaned === "table" ||
      cleaned === "floor" ||
      cleaned === "ceiling"
    ) {
      return cleaned;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

const ZH_LABEL: Record<LampType, string> = {
  pendant: "吊灯",
  wall: "壁灯",
  table: "台灯",
  floor: "落地灯",
  ceiling: "吸顶灯",
  unknown: "未知",
};

const EN_LABEL: Record<LampType, string> = {
  pendant: "pendant lamp",
  wall: "wall sconce",
  table: "table lamp",
  floor: "floor lamp",
  ceiling: "ceiling lamp",
  unknown: "unknown lamp type",
};

/** 把 schema 里的 Template.lamp_type 映射成 LampType 枚举。 */
export function templateLampTypeToEnum(s: string): LampType {
  const normalized = s.trim().toLowerCase();
  // schema 里是中文：吊灯/壁灯/台灯/落地灯/吸顶灯
  if (s.includes("吊")) return "pendant";
  if (s.includes("壁")) return "wall";
  if (s.includes("台")) return "table";
  if (s.includes("落地")) return "floor";
  if (s.includes("吸顶")) return "ceiling";
  if (
    normalized === "pendant" ||
    normalized === "wall" ||
    normalized === "table" ||
    normalized === "floor" ||
    normalized === "ceiling"
  )
    return normalized as LampType;
  return "unknown";
}

export function labelLampType(t: LampType, lang: "zh" | "en"): string {
  return lang === "zh" ? ZH_LABEL[t] : EN_LABEL[t];
}
