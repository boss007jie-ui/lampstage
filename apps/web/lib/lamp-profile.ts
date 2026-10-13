/**
 * 灯具档案推断（V1）。
 *
 * 一次 vision 调用，让 gpt-5-mini 看灯具图，返回结构化档案：
 *   - lamp_type: pendant / wall / table / floor / ceiling / unknown
 *   - size_class: small / medium / large
 *   - size_hint_cm: AI 估算的具体直径/高度（数字，注入 prompt 用）
 *   - color_temp: warm_3000k / neutral_4000k / cool_5000k / tunable
 *   - target_audience: modern_luxury / nordic / wabi_sabi / industrial / new_chinese / french
 *
 * 走 DeepSeek chat completions（OpenAI 兼容）。失败时返回默认值（不让前端阻塞）。
 * 见 lib/deepseek.ts 的两个坑（推理模型吃 max_tokens、错模型 id 静默回落）。
 */
import { getObjectBytes } from "@/lib/storage";
import { logToolCall } from "@/lib/tool-log";
import { THINKING_DISABLED, chatApiKey, chatEndpoint, chatModel } from "@/lib/deepseek";

const ENDPOINT = chatEndpoint(process.env.LAMP_PROFILE_ENDPOINT);
const MODEL = chatModel(process.env.LAMP_PROFILE_MODEL);

export type LampType =
  | "pendant"
  | "wall"
  | "table"
  | "floor"
  | "ceiling"
  | "unknown";

export type SizeClass = "small" | "medium" | "large";

export type ColorTemp =
  | "warm_3000k"
  | "neutral_4000k"
  | "cool_5000k"
  | "tunable";

export type TargetAudience =
  | "modern_luxury"
  | "nordic"
  | "wabi_sabi"
  | "industrial"
  | "new_chinese"
  | "french";

export type LampProfile = {
  lamp_type: LampType;
  size_class: SizeClass;
  size_hint_cm: number;
  /** AI 估算的灯罩直径 cm，pendant/ceiling/wall 用，table/floor 可为 null */
  shade_diameter_cm: number | null;
  /** 灯具总高度 cm（含灯体+灯罩，不含吊线/吊链） */
  fixture_height_cm: number | null;
  /** 吊线/吊链下挂长度 cm（pendant 专用，其他类型为 null） */
  cord_or_chain_drop_cm: number | null;
  /** 尺寸档位：与 size_class 一致，供 planner 按档位选规则 */
  scale_band: SizeClass;
  color_temp: ColorTemp;
  target_audience: TargetAudience;
  material_keywords: string[];
  /** 按风格气质判断的适合空间（SPACE_POOL key，排序）。 */
  space_fit: string[];
  reasoning: string;
};

export const DEFAULT_PROFILE: LampProfile = {
  lamp_type: "unknown",
  size_class: "medium",
  size_hint_cm: 40,
  shade_diameter_cm: null,
  fixture_height_cm: null,
  cord_or_chain_drop_cm: null,
  scale_band: "medium",
  color_temp: "warm_3000k",
  target_audience: "modern_luxury",
  material_keywords: [],
  space_fit: [],
  reasoning: "default fallback",
};

const SYSTEM_PROMPT = `You analyze a lamp product photo and return a structured profile in strict JSON.

Rules:
- lamp_type: one of [pendant, wall, table, floor, ceiling, unknown]
  pendant=hangs from ceiling with cord/rod;
  wall=mounted on wall (sconce);
  table=sits on table/nightstand;
  floor=stands on floor;
  ceiling=flush ceiling mount;
  unknown=cannot tell or not a lamp.
- size_class: small / medium / large (relative to that lamp_type's typical scale)
  pendant: small ≤30cm diameter, medium 30-60cm, large ≥60cm
  table: small ≤35cm height, medium 35-55cm, large ≥55cm
  floor: small ≤140cm height, medium 140-170cm, large ≥170cm
  wall: small ≤25cm projection, medium 25-40cm, large ≥40cm
  ceiling: small ≤40cm diameter, medium 40-70cm, large ≥70cm
- size_hint_cm: your best numeric estimate of the lamp's primary dimension (diameter for pendant/ceiling, height for table/floor, projection for wall)
- shade_diameter_cm: if the lamp has a visible shade/dome, estimate its diameter in cm. For pendant/ceiling/wall types, estimate from the lamp body width relative to common visual cues (e.g. a hand holding the lamp ≈ 8–9 cm palm width, a table lamp beside it ≈ standard A4 paper 21 cm). Return null only for types without a shade (e.g. bare bulb floor lamp).
- fixture_height_cm: estimate the total height of the lamp body (shade + housing, excluding cord/chain/rod). Return null if impossible to judge.
- cord_or_chain_drop_cm: for pendant type only, estimate the visible cord/chain/rod length from ceiling attachment to lamp body. For other types return null.
- scale_band: same value as size_class. This is the size band used for scale-lock rules.
- color_temp: looking at the bulb glow color and shade material, infer:
  warm_3000k=yellow/orange glow, linen/wood/amber glass shade
  neutral_4000k=natural white glow, mixed materials
  cool_5000k=cold white glow, clinical/minimal feel, metal+white shade
  tunable=if multiple LED zones or smart-lamp design hints
  Default to warm_3000k if uncertain (it is the home market majority).
- target_audience: which interior style this lamp best fits
  modern_luxury=black metal + marble + leather + velvet vibe
  nordic=light oak + white + linen, IKEA/HAY style
  wabi_sabi=gray/white + raw wood + paper + minimal japanese
  industrial=black iron + concrete + vintage brass + LOFT
  new_chinese=solid wood + ink wash + greenery + cultural minimalism
  french=ivory + arches + gold trim + florals + femme elegant
- material_keywords: 1-3 short tags in English describing what you see (e.g. "black metal", "linen shade", "amber glass")
- space_fit: pick the 3 BEST-FITTING interior spaces for THIS specific lamp, ranked best-first, judged mainly by the lamp's STYLE / MATERIAL / SHAPE / temperament (not only by mounting type). Choose from this fixed pool of keys:
  dining_room, living_room, entryway, staircase, kitchen_island, bedroom, bedside, study, reading_nook, hallway, breakfast_nook, living_side_table
  Guidance: a decorative/statement piece (woven rattan, boho, sculptural, crystal, oversized) belongs in show-off spaces like dining_room / living_room / entryway / staircase, NOT a bedroom. A calm/minimal piece fits study / bedroom / reading_nook. Respect the mounting type (a table lamp can't go on a staircase void). If none of the pool keys fits well, you may output ONE short custom snake_case space name, but prefer pool keys.
  Return space_fit as a JSON array of 3 strings.
- reasoning: ≤30 words explaining the audience AND space_fit inference

Output ONLY a single JSON object. No prose, no markdown fence.`;

async function imageAsBase64(
  refUrlOrPath: string,
): Promise<{ b64: string; mime: string }> {
  const { bytes, mime } = await getObjectBytes(refUrlOrPath);
  return { b64: bytes.toString("base64"), mime };
}

function stripFence(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function isLampType(v: unknown): v is LampType {
  return (
    v === "pendant" ||
    v === "wall" ||
    v === "table" ||
    v === "floor" ||
    v === "ceiling" ||
    v === "unknown"
  );
}

function isSizeClass(v: unknown): v is SizeClass {
  return v === "small" || v === "medium" || v === "large";
}

function isColorTemp(v: unknown): v is ColorTemp {
  return (
    v === "warm_3000k" ||
    v === "neutral_4000k" ||
    v === "cool_5000k" ||
    v === "tunable"
  );
}

function isAudience(v: unknown): v is TargetAudience {
  return (
    v === "modern_luxury" ||
    v === "nordic" ||
    v === "wabi_sabi" ||
    v === "industrial" ||
    v === "new_chinese" ||
    v === "french"
  );
}

function normalize(raw: Record<string, unknown>): LampProfile {
  const out: LampProfile = { ...DEFAULT_PROFILE };
  if (isLampType(raw.lamp_type)) out.lamp_type = raw.lamp_type;
  if (isSizeClass(raw.size_class)) out.size_class = raw.size_class;
  const cm = Number(raw.size_hint_cm);
  if (Number.isFinite(cm) && cm > 0 && cm < 500) out.size_hint_cm = Math.round(cm);
  const sd = Number(raw.shade_diameter_cm);
  if (Number.isFinite(sd) && sd > 0 && sd < 300) {
    out.shade_diameter_cm = Math.round(sd);
  }
  const fh = Number(raw.fixture_height_cm);
  if (Number.isFinite(fh) && fh > 0 && fh < 500) {
    out.fixture_height_cm = Math.round(fh);
  }
  const cd = Number(raw.cord_or_chain_drop_cm);
  if (Number.isFinite(cd) && cd > 0 && cd < 500) {
    out.cord_or_chain_drop_cm = Math.round(cd);
  }
  out.scale_band = isSizeClass(raw.scale_band) ? raw.scale_band : out.size_class;
  if (isColorTemp(raw.color_temp)) out.color_temp = raw.color_temp;
  if (isAudience(raw.target_audience)) out.target_audience = raw.target_audience;
  if (Array.isArray(raw.material_keywords)) {
    out.material_keywords = raw.material_keywords
      .filter((x): x is string => typeof x === "string")
      .slice(0, 5);
  }
  if (Array.isArray(raw.space_fit)) {
    out.space_fit = raw.space_fit
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"))
      .slice(0, 3);
  }
  if (typeof raw.reasoning === "string") {
    out.reasoning = raw.reasoning.slice(0, 200);
  }
  return out;
}

export async function inferLampProfile(
  refUrlOrPath: string,
): Promise<LampProfile> {
  const startedAt = Date.now();
  const apiKey = chatApiKey();
  if (!apiKey) {
    console.warn("[lamp-profile] DEEPSEEK_API_KEY missing, using default");
    return { ...DEFAULT_PROFILE };
  }

  let img;
  try {
    img = await imageAsBase64(refUrlOrPath);
  } catch (e) {
    console.warn("[lamp-profile] image read failed:", e);
    return { ...DEFAULT_PROFILE };
  }

  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.b64}` },
          },
          { type: "text", text: "Analyze this lamp and return the JSON profile." },
        ],
      },
    ],
    response_format: { type: "json_object" },
    // 关闭思考，避免思维链挤占正文预算（见 lib/deepseek.ts）
    max_tokens: 2000,
    thinking: THINKING_DISABLED,
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("[lamp-profile] network error:", e);
    void logToolCall({
      tool: "lamp_profile",
      model: MODEL,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: `network error: ${String(e)}`,
    });
    return { ...DEFAULT_PROFILE };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn(`[lamp-profile] HTTP ${res.status}: ${text.slice(0, 200)}`);
    void logToolCall({
      tool: "lamp_profile",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: text.slice(0, 240),
    });
    return { ...DEFAULT_PROFILE };
  }

  let data;
  try {
    data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
  } catch (e) {
    console.warn("[lamp-profile] non-json response:", e);
    void logToolCall({
      tool: "lamp_profile",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: `non-json response: ${String(e)}`,
    });
    return { ...DEFAULT_PROFILE };
  }

  const content = data.choices?.[0]?.message?.content || "";
  if (!content) {
    console.warn("[lamp-profile] empty content");
    void logToolCall({
      tool: "lamp_profile",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: "empty content",
    });
    return { ...DEFAULT_PROFILE };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch (e) {
    console.warn(
      "[lamp-profile] parse failed:",
      e,
      "content:",
      content.slice(0, 200),
    );
    void logToolCall({
      tool: "lamp_profile",
      model: MODEL,
      status: "failed",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      error: `parse failed: ${String(e)}`,
    });
    return { ...DEFAULT_PROFILE };
  }

  void logToolCall({
    tool: "lamp_profile",
    model: MODEL,
    status: "ok",
    httpStatus: res.status,
    durationMs: Date.now() - startedAt,
  });
  return normalize(parsed);
}
