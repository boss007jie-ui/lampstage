/**
 * Prompt Planner
 *
 * 作用：不要再用固定模板硬拼生图 prompt。
 * 让 GPT 根据产品卡 + 业务目标 + 可用场景参考图，输出 3 个 nano-banana 图生图 shot。
 *
 * 注意：planner 只负责写 prompt，不负责生图。失败时 generation.ts 会 fallback 到旧规则。
 */
import type {
  ColorTemp,
  LampType,
  SizeClass,
  TargetAudience,
} from "@/lib/lamp-profile";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";
import { logToolCall } from "@/lib/tool-log";

const ENDPOINT = "https://yunwu.ai/v1/chat/completions";
const MODEL = process.env.PROMPT_PLANNER_MODEL || "gpt-5.5";
const PLANNER_TIMEOUT_MS = Number(process.env.PROMPT_PLANNER_TIMEOUT_MS || 12000);

export type ProductProfileForPlanner = {
  lamp_type: LampType;
  size_class: SizeClass;
  size_hint_cm: number;
  color_temp: ColorTemp;
  target_audience: TargetAudience;
  material_keywords: string[];
};

export type PlannedShot = {
  scene_type: string;
  /** 该镜头所属的"适合空间"排名（0 = 最适合）。用于按数量分配到空间。 */
  space_rank: number;
  /** 是否为"最适合空间的另一角度/时段"变体（第 4 条）。 */
  is_variant: boolean;
  room_reference: string;
  time_of_day: "daylight" | "dusk" | "night";
  light_state: "off" | "on";
  placement: string;
  scale_anchor: string;
  composition_subject: string;
  prompt: string;
};

export type PromptPlan = {
  usage_role: "main_pendant" | "accent_pendant" | "ambient_decor" | "product_showcase";
  reasoning: string;
  shots: PlannedShot[];
};

const SYSTEM_PROMPT = `You are a senior interior-photography prompt planner for a lighting e-commerce SaaS.

Your job is NOT to generate an image. Your job is to write concise image-edit prompts for nano-banana / Gemini image.

The image model receives ONE image: the lamp product photo.
It generates a complete interior scene from text, using the lamp photo only as appearance/material reference.

Hard rules (these come from offline A/B testing — follow them exactly):

1. ROOM-FIRST narrative. Describe the full interior scene (style, furniture, natural daylight) as the main subject. The lamp is the LAST element — a brief prepositional phrase. NEVER make the lamp the sentence subject. The lamp must read as one small detail in the room, not a centered hero product.

2. SCALE via in-scene reference (most important — the image model IGNORES absolute sizes like "25cm"). You MUST anchor the lamp's size to furniture already in the scene, plus an everyday-object hint:
   - small product: "much smaller than the main furniture below it — its shade is only about the size of a dinner plate"
   - medium product: "clearly smaller than the main furniture — about the size of a serving tray"
   - large product: "noticeably smaller than the main furniture"
   Always tell the model to compare the lamp to the nearby furniture and keep it clearly smaller. Pendants hang high on a long cord near the ceiling.

3. LIGHT STATE.
   - Daylight scenes: the lamp is switched OFF. State it forcefully: "the bulb is completely dark and unlit, with no glow, no warm light and no pink light at all — the room is lit only by soft natural daylight." (Residual pink/warm glow was a real recurring defect.)
   - Only dusk/night scenes may turn the lamp ON, with a soft realistic color temperature.

4. MATERIAL FIDELITY. Tell the model to keep the lamp's EXACT shape, material and colour from the reference (e.g. woven rattan stays warm tan rattan — over-emphasizing "small/dark" once turned a rattan lamp black; avoid that).

5. PLACEMENT. Pendant/ceiling over a table → centred high above the table. Otherwise → above the seating area or a side/accent spot (bedside, reading nook, console). Exactly one fixture unless the product clearly has multiple shades.

6. WIDE LENS. Shot with a wide lens showing the whole room; room and furniture fill most of the frame; the small lamp blends in.

7. WORDING. Never use "install", "the uploaded image", or "the reference image is" — say "matching the reference" for the lamp appearance. 70-110 English words per shot.

Each shot's "prompt" field MUST embed: the room scene, the explicit relative-size anchor (rule 2), the forceful light-state line (rule 3), and the material-fidelity clause (rule 4).

Return STRICT JSON only. No markdown.

SHOT PLAN — return exactly 4 shots, in this fixed order:
- shot[0]: the BEST-FITTING space for this lamp (most suitable), space_rank=0, is_variant=false.
- shot[1]: the 2nd best-fitting space, space_rank=1, is_variant=false.
- shot[2]: the 3rd best-fitting space, space_rank=2, is_variant=false.
- shot[3]: ANOTHER ANGLE / TIME-OF-DAY of the BEST space again (space_rank=0, is_variant=true) — same best space as shot[0] but visibly different: different camera angle, different time of day, or different furniture layout, so the two best-space shots don't look identical.
Rank spaces best-first judged by the lamp's STYLE / MATERIAL / SHAPE / temperament. The best space (rank 0) is the one this specific lamp suits most.

JSON schema:
{
  "usage_role": "main_pendant|accent_pendant|ambient_decor|product_showcase",
  "reasoning": "short reason incl. why the best space ranks first",
  "shots": [
    {
      "scene_type": "string, e.g. dining_room",
      "space_rank": 0,
      "is_variant": false,
      "time_of_day": "daylight|dusk|night",
      "light_state": "off|on",
      "placement": "string",
      "scale_anchor": "string",
      "composition_subject": "string",
      "prompt": "final nano-banana prompt"
    }
  ]
}

Return exactly 4 shots in the order described above.`;

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizePlan(raw: unknown): PromptPlan | null {
  if (!isRecord(raw) || !Array.isArray(raw.shots)) return null;
  const shots: PlannedShot[] = raw.shots
    .filter(isRecord)
    .map((s, i): PlannedShot => ({
      scene_type: String(s.scene_type || "interior scene").slice(0, 80),
      // 兜底：模型若没给 space_rank，按位置推断（前3条=0/1/2，第4条=0 的变体）
      space_rank:
        typeof s.space_rank === "number" && s.space_rank >= 0
          ? Math.min(2, Math.floor(s.space_rank))
          : i >= 3
            ? 0
            : Math.min(2, i),
      is_variant: s.is_variant === true || i >= 3,
      room_reference: "",
      time_of_day:
        s.time_of_day === "dusk" || s.time_of_day === "night" ? s.time_of_day : "daylight",
      light_state: s.light_state === "on" ? "on" : "off",
      placement: String(s.placement || "secondary ceiling position").slice(0, 160),
      scale_anchor: String(s.scale_anchor || "secondary to furniture scale").slice(0, 160),
      composition_subject: String(s.composition_subject || "room atmosphere and furniture").slice(0, 160),
      prompt: String(s.prompt || "").trim(),
    }))
    .filter((s) => s.prompt.length > 40)
    .slice(0, 4);
  if (shots.length !== 4) return null;
  const usage =
    raw.usage_role === "main_pendant" ||
    raw.usage_role === "accent_pendant" ||
    raw.usage_role === "ambient_decor" ||
    raw.usage_role === "product_showcase"
      ? raw.usage_role
      : "accent_pendant";
  return {
    usage_role: usage,
    reasoning: String(raw.reasoning || "planned by prompt planner").slice(0, 300),
    shots,
  };
}

export async function planImagePrompts(args: {
  profile: ProductProfileForPlanner;
  platformStyle: PlatformStyle;
  aspectRatio: AspectRatio;
  userIntent?: string;
}): Promise<PromptPlan | null> {
  const startedAt = Date.now();
  const apiKey = process.env.YUNWU_API_KEY;
  if (!apiKey) {
    console.warn("[prompt-planner] YUNWU_API_KEY missing");
    return null;
  }

  const userText = `Product card:
${JSON.stringify(args.profile, null, 2)}

Business/user intent:
${args.userIntent || "Generate real usage scene images for a lighting e-commerce product. The lamp must blend into the room, not become a huge centered hero object."}

Platform style: ${args.platformStyle}
Aspect ratio: ${args.aspectRatio}

Write 4 planned image-edit shots in the fixed order described in the system prompt. Only ONE image (the lamp product photo) is sent to the model.`;

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    console.warn("[prompt-planner] network/timeout error", e);
    void logToolCall({
      tool: "prompt_planner",
      model: MODEL,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: `network/timeout: ${String(e)}`,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[prompt-planner] HTTP ${res.status}: ${text.slice(0, 300)}`);
    void logToolCall({
      tool: "prompt_planner",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: text.slice(0, 240),
    });
    return null;
  }

  try {
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.choices)) return null;
    const first = data.choices[0];
    const message = isRecord(first) ? first.message : undefined;
    const text = isRecord(message) ? message.content : undefined;
    if (typeof text !== "string") return null;
    const plan = normalizePlan(JSON.parse(stripFence(text)));
    void logToolCall({
      tool: "prompt_planner",
      model: MODEL,
      status: plan ? "ok" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: plan ? null : "normalizePlan returned null",
    });
    return plan;
  } catch (e) {
    console.warn("[prompt-planner] parse error", e);
    void logToolCall({
      tool: "prompt_planner",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: `parse error: ${String(e)}`,
    });
    return null;
  }
}
