/**
 * Prompt Planner
 *
 * 作用：不要再用固定模板硬拼生图 prompt。
 * 让 DeepSeek 根据产品卡 + 业务目标 + 可用场景参考图，输出 4 个 nano-banana 图生图 shot。
 *
 * 注意：planner 只负责写 prompt，不负责生图。失败时 generation.ts 会 fallback 到旧规则。
 * provider 历史上有 yunwu / deepseek 两条路，2026-10-13 起 yunwu 完全剔除，只剩 DeepSeek。
 */
import type {
  ColorTemp,
  LampType,
  SizeClass,
  TargetAudience,
} from "@/lib/lamp-profile";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";
import { logToolCall } from "@/lib/tool-log";
import {
  THINKING_DISABLED,
  chatApiKey,
  chatEndpoint,
  chatModel,
} from "@/lib/deepseek";

const PLANNER_TIMEOUT_MS = Number(process.env.PROMPT_PLANNER_TIMEOUT_MS || 60000);

function getPlannerConfig(): {
  endpoint: string;
  model: string;
  apiKey?: string;
  apiKeyName: string;
} {
  // 只剩 DeepSeek 一家。模型默认 deepseek-flash（支持 text+image）。
  // 注意 PROMPT_PLANNER_MODEL 若被设成别的厂商模型名，DeepSeek 会**静默回落**
  // 到默认模型而不会报错，见 lib/deepseek.ts。
  return {
    endpoint: chatEndpoint(process.env.PROMPT_PLANNER_ENDPOINT),
    model: chatModel(process.env.PROMPT_PLANNER_MODEL),
    apiKey: chatApiKey(),
    apiKeyName: "DEEPSEEK_API_KEY",
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

Each prompt must be 85–105 English words.

Structure:
1. room architecture and style (2-3 sentences)
2. furniture, textures, styling details (2 sentences)
3. daylight source, quality, atmosphere (1-2 sentences)
4. camera position, lens, angle, what fills the frame (1 sentence)
5. ONE final sentence describing the lamp as a functional detail

Final lamp sentence example:
"A pendant matching the reference hangs naturally above the table as a quiet functional detail."

VALIDATION — MANDATORY SELF-CHECK BEFORE RETURNING EACH SHOT

Run ALL checks below on every shot prompt. If ANY check fails, do NOT return
that shot — rewrite it until all checks pass.

1. FORBIDDEN WORDS
   Reject if the prompt contains any of:
   cm, %, frame width, table depth, chair seat, scale lock, hero product,
   product catalogue, oversized, compact pendant, statement piece,
   scale anchor, visual center, dominating

2. LAMP POSITION — SINGLE FINAL SENTENCE
   The word "pendant", "fixture", "lamp", or "chandelier" must appear
   EXACTLY ONCE in the entire prompt, and ONLY inside the final sentence.

   To verify: count occurrences of ["pendant", "fixture", "lamp", "chandelier",
   "luminaire", "lighting fixture", "light fixture"] across the whole prompt.
   If count != 1 → REJECT.
   If the single occurrence is NOT in the final sentence → REJECT.

3. ROOM DOMINANCE — ≥80% OF CONTENT
   Estimate the proportion of the prompt that describes the room, furniture,
   daylight, camera, and atmosphere (NOT the lamp).

   Quick self-check: the lamp sentence must be 1 sentence out of at least 7
   total sentences, AND the lamp sentence must be visibly shorter than the
   average room-description sentence. If the prompt has fewer than 7 sentences
   → REJECT and add more room detail.

   Target word split: ≥90 words total, lamp line ≤15 words.

4. REJECTION LOGIC
   If any check fails — rewrite the ENTIRE prompt from scratch.
   Do not try to patch a failing prompt by moving one sentence.
   The failure means the room-first structure was not followed.

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

const LAMP_WORDS = [
  "lighting fixture",
  "light fixture",
  "pendant",
  "fixture",
  "lamp",
  "chandelier",
  "luminaire",
  "sconce",
];

type SanitizeResult = {
  cleaned: string | null;
  actions: string[];
};

const FORBIDDEN_PROMPT_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "cm", pattern: /\bcm\b/i },
  { label: "%", pattern: /%/ },
  { label: "frame width", pattern: /\bframe\s+width\b/i },
  { label: "table depth", pattern: /\btable\s+depth\b/i },
  { label: "chair seat", pattern: /\bchair\s+seat\b/i },
  { label: "scale lock", pattern: /\bscale\s+lock\b/i },
  { label: "hero product", pattern: /\bhero\s+product\b/i },
  { label: "product catalogue", pattern: /\bproduct\s+catalogue\b/i },
  { label: "compact pendant", pattern: /\bcompact\s+pendant\b/i },
  { label: "statement piece", pattern: /\bstatement\s+piece\b/i },
  { label: "scale anchor", pattern: /\bscale\s+anchor\b/i },
  { label: "visual center", pattern: /\bvisual\s+center\b/i },
  { label: "dominating", pattern: /\bdominating\b/i },
];

const ROOM_DETAIL_PAD_SENTENCE =
  "Additional room texture remains visible in the surrounding surfaces, giving the composition a complete lived-in interior context.";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitPromptSentences(prompt: string): string[] {
  return prompt
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function countLampWordHits(text: string): number {
  const hits: Array<{ start: number; end: number }> = [];
  for (const lw of LAMP_WORDS) {
    const re = new RegExp(`\\b${escapeRegExp(lw).replace(/\\\s\+/g, "\\s+")}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      hits.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const accepted: Array<{ start: number; end: number }> = [];
  for (const hit of hits) {
    if (accepted.some((existing) => hit.start < existing.end && hit.end > existing.start)) {
      continue;
    }
    accepted.push(hit);
  }
  return accepted.length;
}

function removeLampWords(text: string): string {
  let cleaned = text;
  for (const lw of LAMP_WORDS) {
    const re = new RegExp(`\\b${escapeRegExp(lw).replace(/\\\s\+/g, "\\s+")}\\b`, "gi");
    cleaned = cleaned.replace(re, "ceiling detail");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function sanitizeShot(prompt: string): SanitizeResult {
  const actions: string[] = [];
  for (const { label, pattern } of FORBIDDEN_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) {
      return { cleaned: null, actions: [`forbidden word: "${label}"`] };
    }
  }

  let working = prompt;
  // 处理 oversized：替换为中性描述或直接删除
  if (working.toLowerCase().includes("oversized")) {
    // 策略：删除 "oversized" 及前面可能的冠词，保留句子其余部分
    working = working.replace(/\b(an?\s+)?oversized\b/gi, "");
    // 清理双空格
    working = working.replace(/\s{2,}/g, " ").trim();
    actions.push("replaced 'oversized' with neutral wording");
  }

  const sentences = splitPromptSentences(working);
  const lampSentenceIndices = sentences
    .map((sentence, index) => (countLampWordHits(sentence) > 0 ? index : -1))
    .filter((index) => index >= 0);
  const midPromptLampIndices = lampSentenceIndices.filter(
    (index) => index !== sentences.length - 1,
  );
  const cleanedSentences = sentences.map((sentence, index) =>
    midPromptLampIndices.includes(index) ? removeLampWords(sentence) : sentence,
  );
  if (midPromptLampIndices.length > 0) {
    actions.push(
      `removed lamp wording from ${midPromptLampIndices.length} mid-prompt sentence(s)`,
    );
  }
  let cleaned = cleanedSentences.join(" ").trim();
  let finalSentences = splitPromptSentences(cleaned);

  if (finalSentences.length < 5) {
    return {
      cleaned: null,
      actions: [
        ...actions,
        `only ${finalSentences.length} sentences after sanitize (need ≥5)`,
      ],
    };
  }

  let wordCount = countWords(cleaned);
  if (wordCount >= 70 && wordCount < 80) {
    const finalSentence = finalSentences[finalSentences.length - 1];
    const roomSentences = finalSentences.slice(0, -1);
    cleaned = [...roomSentences, ROOM_DETAIL_PAD_SENTENCE, finalSentence].join(" ");
    finalSentences = splitPromptSentences(cleaned);
    wordCount = countWords(cleaned);
    actions.push("added neutral room detail sentence to reach minimum length");
  }
  if (wordCount < 80) {
    return {
      cleaned: null,
      actions: [...actions, `only ${wordCount} words after sanitize (need ≥80)`],
    };
  }

  return { cleaned, actions };
}

type PlannerMessage = {
  role: "system" | "user";
  content: string;
};

type PlannerRequestBody = {
  model: string;
  messages: PlannerMessage[];
  response_format: { type: "json_object" };
  temperature: number;
  thinking?: { type: "disabled" };
};

type PlannerAttemptResult =
  | { ok: true; httpStatus: number; plan: PromptPlan }
  | { ok: false; httpStatus?: number; error: string };

async function requestPromptPlan(args: {
  endpoint: string;
  apiKey: string;
  body: PlannerRequestBody;
}): Promise<PlannerAttemptResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `network/timeout: ${String(e)}` };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      httpStatus: res.status,
      error: text.slice(0, 240) || `HTTP ${res.status}`,
    };
  }

  try {
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.choices)) {
      return { ok: false, httpStatus: res.status, error: "choices missing" };
    }
    const first = data.choices[0];
    const message = isRecord(first) ? first.message : undefined;
    const text = isRecord(message) ? message.content : undefined;
    if (typeof text !== "string") {
      return { ok: false, httpStatus: res.status, error: "message content missing" };
    }
    const plan = normalizePlan(JSON.parse(stripFence(text)));
    if (!plan) {
      return { ok: false, httpStatus: res.status, error: "normalizePlan returned null" };
    }
    return { ok: true, httpStatus: res.status, plan };
  } catch (e) {
    return { ok: false, httpStatus: res.status, error: `parse error: ${String(e)}` };
  }
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

  const body: PlannerRequestBody = {
    model: planner.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    // 关闭思考：deepseek-flash 是推理模型，思维链与正文共享 max_tokens 预算
    // （见 lib/deepseek.ts）。此处保持原有行为，只是精简掉已废弃的 provider 分支。
    thinking: THINKING_DISABLED,
  };

  const attempt = await requestPromptPlan({
    endpoint: planner.endpoint,
    apiKey: planner.apiKey,
    body,
  });
  if (!attempt.ok) {
    console.warn(`[prompt-planner] ${attempt.error}`);
    void logToolCall({
      tool: "prompt_planner",
      model: planner.model,
      status: "failed",
      httpStatus: attempt.httpStatus,
      durationMs: Date.now() - startedAt,
      error: attempt.error,
    });
    return null;
  }

  const plan = attempt.plan;
  const allActions: string[] = [];
  const sanitizedShots: PlannedShot[] = [];
  for (let i = 0; i < plan.shots.length; i++) {
    const result = sanitizeShot(plan.shots[i].prompt);
    if (!result.cleaned) {
      const error = `shot ${i} unsanitizable: ${result.actions.join("; ")}`;
      console.warn(`[prompt-planner] ${error}`);
      void logToolCall({
        tool: "prompt_planner",
        model: planner.model,
        status: "failed",
        httpStatus: attempt.httpStatus,
        durationMs: Date.now() - startedAt,
        error,
      });
      return null;
    }
    if (result.actions.length > 0) {
      allActions.push(`shot ${i}: ${result.actions.join("; ")}`);
    }
    sanitizedShots.push({ ...plan.shots[i], prompt: result.cleaned });
  }
  plan.shots = sanitizedShots;

  void logToolCall({
    tool: "prompt_planner",
    model: planner.model,
    status: "ok",
    httpStatus: attempt.httpStatus,
    durationMs: Date.now() - startedAt,
    error: allActions.length > 0 ? `sanitized: ${allActions.join(" | ")}` : null,
    resultJson: JSON.stringify(plan),
  });
  return plan;
}
