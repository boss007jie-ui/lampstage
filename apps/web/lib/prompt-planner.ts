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

const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_PLANNER_MODEL = DEEPSEEK_MODEL;
const YUNWU_MODEL = "gpt-5.5";
const YUNWU_ENDPOINT = "https://yunwu.ai/v1/chat/completions";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const PLANNER_TIMEOUT_MS = Number(process.env.PROMPT_PLANNER_TIMEOUT_MS || 60000);

type PlannerProvider = "yunwu" | "deepseek";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getPlannerConfig(): {
  provider: PlannerProvider;
  endpoint: string;
  model: string;
  apiKey?: string;
  apiKeyName: string;
} {
  const requestedModel = process.env.PROMPT_PLANNER_MODEL;
  const providerEnv = process.env.PROMPT_PLANNER_PROVIDER?.toLowerCase();
  const provider: PlannerProvider =
    providerEnv === "yunwu" ||
    requestedModel === "gpt-5.5" ||
    (!!requestedModel &&
      !requestedModel.startsWith("deepseek-") &&
      providerEnv !== "deepseek")
      ? "yunwu"
      : "deepseek";
  if (provider === "deepseek") {
    return {
      provider,
      endpoint:
        process.env.DEEPSEEK_ENDPOINT ||
        `${normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL)}/chat/completions`,
      model: requestedModel || DEFAULT_PLANNER_MODEL,
      apiKey: process.env.DEEPSEEK_API_KEY,
      apiKeyName: "DEEPSEEK_API_KEY",
    };
  }
  return {
    provider,
    endpoint: process.env.PROMPT_PLANNER_ENDPOINT || YUNWU_ENDPOINT,
    model: requestedModel || YUNWU_MODEL,
    apiKey: process.env.YUNWU_API_KEY,
    apiKeyName: "YUNWU_API_KEY",
  };
}

export type ProductProfileForPlanner = {
  lamp_type: LampType;
  size_class: SizeClass;
  size_hint_cm: number;
  shade_diameter_cm: number | null;
  fixture_height_cm: number | null;
  cord_or_chain_drop_cm: number | null;
  scale_band: SizeClass;
  color_temp: ColorTemp;
  target_audience: TargetAudience;
  material_keywords: string[];
  /** 已选/已排序的适合空间（SPACE_POOL key，最适合在前）。planner 必须严格使用，不得自选。 */
  space_fit: string[];
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

const SYSTEM_PROMPT = `You are a senior interior-scene prompt planner for a lighting e-commerce SaaS.

Your task is NOT to generate an image. Your task is to write concise,
photorealistic image-to-image prompts for Nano Banana / Gemini Image.

The image model receives one lamp product image. The lamp image is used only
for silhouette, material, colour, construction, and bulb appearance.

INPUT REQUIREMENTS

Each task includes:
- suitable_spaces
- product_type
- shade_diameter_cm
- fixture_height_cm
- cord_or_chain_drop_cm
- scale_band: small | medium | large

Never invent product dimensions from the lamp image.
If dimensions are missing, use a conservative SMALL fallback:
shade diameter = 30 cm, and state low scale confidence in reasoning.

DIMENSIONS ARE PRIVATE PLANNING CONTEXT

Use product dimensions ONLY to select a believable room scale,
furniture scale, ceiling height, and camera distance.

Never include:
- centimetres
- percentages
- frame-width calculations
- table-depth calculations
- chair-seat comparisons
- scale-band labels
- warnings about oversizing

in the final image-edit prompt.

SCENE-FIRST FUSION

The room is always the subject:
architecture, furniture, daylight, texture, styling and lived-in atmosphere
must take at least 80% of the final prompt.

The lamp is a functional interior detail, not a product hero.
Mention the lamp only once, in the final sentence of the prompt.

Do not use:
- centered hero composition
- product catalogue photography
- compact pendant
- statement piece
- visually dominant lamp
- exact scale enforcement wording

CAMERA

Use an observational interior editorial photograph:
35mm lens equivalent, eye-level or slightly elevated oblique angle,
camera placed far enough away for furniture, ceiling, floor and surrounding
architecture to establish the room first.

For pendant lamps:
they may be physically above the table or seating area,
but should read as naturally integrated into the ceiling plane,
not as the center of the canvas.

LIGHT STATE

Daylight scenes:
"soft natural daylight only; the fixture is switched off, with no emitted glow,
halo, warm cast, pink light, or visible illumination. The bulb retains its
normal neutral glass appearance."

Dusk/night scenes:
"the fixture emits a restrained, realistic warm indoor glow with no oversized
light bloom or exaggerated halo."

FINAL PROMPT FORMAT

Each prompt must be 60–90 English words.

Structure:
1. room style and architecture
2. furniture and styling
3. daylight / atmosphere
4. camera and composition
5. one final short sentence describing the lamp

Final lamp sentence example:
"An unlit pendant matching the reference in silhouette, material, colour and construction hangs naturally above the table as a functional detail."

VALIDATION

Before returning a shot prompt, reject and rewrite it if it contains:
- cm
- %
- frame width
- table depth
- chair seat
- scale lock
- hero product
- product catalogue
- oversized
- compact pendant

Also reject and rewrite if the lamp is mentioned more than once.

SHOT PLAN

Use exactly the given suitable spaces in order.

4 shots:
- shot[0] = best suitable space
- shot[1] = second suitable space
- shot[2] = third suitable space
- shot[3] = best suitable space again, with a different camera angle or time

Never invent spaces outside the supplied suitable_spaces.
If fewer than three spaces are available, reuse space[0].

RETURN FORMAT

Return STRICT JSON only. No markdown.

JSON schema:

{
  "usage_role": "main_pendant|accent_pendant|ambient_decor|product_showcase",
  "reasoning": "brief explanation of selected spaces and scale logic",
  "shots": [
    {
      "scene_type": "",
      "space_rank": 1,
      "is_variant": false,
      "time_of_day": "",
      "light_state": "",
      "placement": "",
      "scale_anchor": "",
      "composition_subject": "room interior",
      "prompt": ""
    }
  ]
}`;

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
  const planner = getPlannerConfig();
  if (!planner.apiKey) {
    console.warn(`[prompt-planner] ${planner.apiKeyName} missing`);
    return null;
  }

  const spaceList =
    args.profile.space_fit.length > 0
      ? args.profile.space_fit.join(", ")
      : "(none provided — fall back to the single best space judged by style)";
  const userText = `Product card:
- lamp_type: ${args.profile.lamp_type}
- size_class: ${args.profile.size_class}
- size_hint_cm: ${args.profile.size_hint_cm}
- shade_diameter_cm: ${args.profile.shade_diameter_cm ?? "unknown"}
- fixture_height_cm: ${args.profile.fixture_height_cm ?? "unknown"}
- cord_or_chain_drop_cm: ${args.profile.cord_or_chain_drop_cm ?? "unknown"}
- scale_band: ${args.profile.scale_band}
- color_temp: ${args.profile.color_temp}
- target_audience: ${args.profile.target_audience}
- material_keywords: ${args.profile.material_keywords.join(", ")}
- space_fit: ${args.profile.space_fit.join(", ")}

Suitable spaces (ranked, best-first) — USE EXACTLY THESE, IN THIS ORDER, AND NOTHING ELSE:
${spaceList}

Business/user intent:
${args.userIntent || "Generate real usage scene images for a lighting e-commerce product. The lamp must blend into the room, not become a huge centered hero object."}

Platform style: ${args.platformStyle}
Aspect ratio: ${args.aspectRatio}

Write 4 planned image-edit shots in the fixed order described in the system prompt. Only ONE image (the lamp product photo) is sent to the model.`;

  const body = {
    model: planner.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    ...(planner.provider === "deepseek"
      ? { thinking: { type: "disabled" as const } }
      : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(planner.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${planner.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    console.warn("[prompt-planner] network/timeout error", e);
    void logToolCall({
      tool: "prompt_planner",
      model: planner.model,
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
      model: planner.model,
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
      model: planner.model,
      status: plan ? "ok" : "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: plan ? null : "normalizePlan returned null",
      resultJson: plan ? JSON.stringify(plan) : null,
    });
    return plan;
  } catch (e) {
    console.warn("[prompt-planner] parse error", e);
    void logToolCall({
      tool: "prompt_planner",
      model: planner.model,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: `parse error: ${String(e)}`,
    });
    return null;
  }
}
