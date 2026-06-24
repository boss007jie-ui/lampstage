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

PRIMARY GOAL

Create believable full-room lifestyle scenes where the room is the visual
subject and the lamp is physically realistic in scale.

The lamp may be centered over furniture in the real room, but it must never
become the visual center of the image.

HARD RULES

1. ROOM-FIRST COMPOSITION

Describe the room, architecture, furniture, daylight, and camera angle first.
Mention the lamp only once near the end of the prompt.

Use an oblique 30–45 degree camera angle, never a straight-on symmetrical
composition.

The room must occupy most of the frame. Show surrounding furniture, walls,
ceiling, floor, and architectural context.

For pendant scenes, the lamp may be centered over the table physically, but
must appear in the upper third or upper-side area of the image rather than
the visual center of the canvas.

2. SCALE LOCK — MOST IMPORTANT

Do not use vague comparisons such as:
"dinner plate", "serving tray", "small accent", or "statement piece".

Always use:
A. the actual lamp diameter in cm,
B. a furniture dimension,
C. a visible everyday-object comparison,
D. a maximum image-frame percentage.

Use these scale rules:

SMALL: shade diameter up to 35 cm
- Dining room: use a 160–180 cm long, 85–95 cm deep table.
  Lamp shade must be no wider than 40% of table depth and narrower than one
  dining chair seat.
- Living room: use a 210–240 cm sofa.
  Lamp shade must be no wider than half of one sofa seat cushion.
- Lamp shade must occupy no more than 14% of total image width.

MEDIUM: shade diameter 36–50 cm
- Dining room: shade must be no wider than 55% of table depth and no wider
  than one dining chair seat.
- Living room: shade must be no wider than one sofa seat cushion.
- Lamp shade must occupy no more than 18% of total image width.

LARGE: shade diameter above 50 cm
- Dining room: shade must remain narrower than 70% of table depth.
- Living room: shade must remain narrower than 1.5 sofa seat cushions.
- Lamp shade must occupy no more than 24% of total image width.

Every prompt must include a concrete scale sentence in this format:

"The [X cm] shade is visibly narrower than [reference object], occupies only
about [Y]% of the frame width, and remains secondary to the room."

Never use table length as the main size reference.
Prefer table depth, chair seat width, sofa cushion width, or sideboard height.

3. LAMP VISUAL PRIORITY

The lamp must never:
- dominate the center of the image,
- span the visual width of the table or sofa,
- appear closer to the camera than the furniture,
- occupy more visual attention than the table, sofa, or room architecture,
- look like a hero product photograph.

Use this positive instruction:

"Camera is positioned 3–5 metres from the pendant, with the furniture and
architecture visually dominant and the lamp reading as a realistic fixture
within the room."

4. MATERIAL AND SHAPE FIDELITY

Mention lamp fidelity only once.

Use this wording:

"a compact pendant matching the reference exactly in silhouette, woven
material, colour, bulb form, and chain or cord construction."

Do not repeatedly describe the lamp as "natural rattan pendant", "rope weave",
"metal chain", etc. Repetition increases visual emphasis and causes oversizing.

5. LIGHT STATE

Daylight scenes:
"soft natural daylight only; the fixture is switched off, with no emitted glow,
halo, warm cast, pink light, or visible illumination. The bulb retains its
normal neutral glass appearance."

Dusk/night scenes:
"the fixture emits a restrained, realistic warm indoor glow with no oversized
light bloom or exaggerated halo."

6. CAMERA AND FRAMING

Use:
- wide full-room interior photograph
- 28–35 mm lens equivalent
- oblique camera angle
- visible ceiling and floor
- furniture occupying most of the frame
- lamp positioned in upper third or upper-side area

Never use:
- centered hero-product composition
- front-facing symmetrical camera
- close-up pendant framing
- product catalogue photography
- isolated lamp emphasis

7. PROMPT LENGTH

Each image prompt must be 55–85 English words.
Avoid repetitive negative wording.
Use one compact scale lock sentence only.

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
