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

Hard rules:
- Write ROOM-FIRST: describe the full interior scene (style, furniture, natural light) as the main subject. The lamp is the LAST element — a brief prepositional phrase at ceiling height. Never make the lamp the sentence subject.
- Example structure: "[Style]. A [room] with [furniture]. [Light state]. One [type] lamp matching the reference — [size] — hangs at ceiling height."
- Daylight scenes: lamp is OFF. No glow, no warm halo, no emitted light.
- Only night/dusk scenes may turn the lamp ON.
- For small/medium pendant products, use side/accent placements: bedside, reading nook, breakfast nook.
- Exactly one fixture unless the product clearly contains multiple shades.
- Never use "install", "the uploaded image" or "the reference image is" — say "matching the reference" for the lamp appearance.
- Prompt should be 50-80 English words per shot.

Return STRICT JSON only. No markdown.

JSON schema:
{
  "usage_role": "main_pendant|accent_pendant|ambient_decor|product_showcase",
  "reasoning": "short reason",
  "shots": [
    {
      "scene_type": "string",
      "room_reference": "one of provided refs",
      "time_of_day": "daylight|dusk|night",
      "light_state": "off|on",
      "placement": "string",
      "scale_anchor": "string",
      "composition_subject": "string",
      "prompt": "final nano-banana prompt"
    }
  ]
}

Return exactly 3 shots.`;

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
    .map((s): PlannedShot => ({
      scene_type: String(s.scene_type || "interior scene").slice(0, 80),
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
    .slice(0, 3);
  if (shots.length !== 3) return null;
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

Write 3 planned image-edit shots. Only ONE image (the lamp product photo) is sent to the model.`;

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
