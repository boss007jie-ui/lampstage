import { getObjectBytes } from "@/lib/storage";
import { logToolCall } from "@/lib/tool-log";
import { THINKING_DISABLED, chatApiKey, chatEndpoint, chatModel } from "@/lib/deepseek";

export type SceneQualityParams = {
  sceneType: string;
  targetAudience: string;
  timeOfDay: string;
};

export type SceneQualityResult = {
  passed: boolean;
  score: number;
  issues: string[];
};

const ENDPOINT = chatEndpoint(process.env.SCENE_QUALITY_ENDPOINT);
const MODEL = chatModel(process.env.SCENE_QUALITY_MODEL);

function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = (fenced?.[1] ?? trimmed).trim();
  const start = source.indexOf("{");
  if (start < 0) return source;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function imageAsBase64(url: string): Promise<{ mime: string; b64: string }> {
  const { bytes, mime } = await getObjectBytes(url);
  return { mime, b64: bytes.toString("base64") };
}

function normalizeQuality(raw: Record<string, unknown>): SceneQualityResult {
  const hasLamp = raw.has_lamp === true;
  const reasonableLayout = raw.reasonable_layout === true;
  const correctLighting = raw.correct_lighting === true;
  const issues: string[] = [];
  if (hasLamp) issues.push("has_lamp");
  if (!reasonableLayout) issues.push("bad_layout");
  if (!correctLighting) issues.push("wrong_lighting");
  const passed = !hasLamp && reasonableLayout && correctLighting;
  return { passed, score: passed ? clampScore(raw.quality_score) : 0, issues };
}

export async function qualityCheckScene(
  imageUrl: string,
  params: SceneQualityParams,
): Promise<SceneQualityResult> {
  const startedAt = Date.now();
  const apiKey = chatApiKey();
  if (!apiKey) {
    return { passed: false, score: 0, issues: ["missing_api_key"] };
  }

  let image;
  try {
    image = await imageAsBase64(imageUrl);
  } catch (error) {
    return { passed: false, score: 0, issues: [`image_read_failed:${String(error).slice(0, 80)}`] };
  }

  const prompt = `Check this interior photo carefully:
1. Is there ANY lamp/pendant/chandelier/lighting fixture visible anywhere? (YES=fail)
2. Is furniture layout reasonable and complete for a ${params.sceneType}?
3. Is lighting clearly ${params.timeOfDay}?
4. Rate overall quality 0-100 for interior design photography.
Return STRICT JSON: {"has_lamp": boolean, "reasonable_layout": boolean, "correct_lighting": boolean, "quality_score": number}`;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${image.mime};base64,${image.b64}` },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
        response_format: { type: "json_object" },
        // 关闭思考：本任务只要 4 个字段的布尔/分数判定，思维链会挤占正文预算
        max_tokens: 1000,
        thinking: THINKING_DISABLED,
      }),
    });
  } catch (error) {
    void logToolCall({
      tool: "scene_quality",
      model: MODEL,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: `network error: ${String(error)}`,
    });
    return { passed: false, score: 0, issues: ["network_error"] };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    void logToolCall({
      tool: "scene_quality",
      model: MODEL,
      status: "failed",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      error: text.slice(0, 240),
    });
    return { passed: false, score: 0, issues: [`http_${response.status}`] };
  }

  try {
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content || "";
    const result = normalizeQuality(JSON.parse(extractJsonObject(content)));
    void logToolCall({
      tool: "scene_quality",
      model: MODEL,
      status: "ok",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      resultJson: JSON.stringify(result),
    });
    return result;
  } catch (error) {
    void logToolCall({
      tool: "scene_quality",
      model: MODEL,
      status: "failed",
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      error: `parse failed: ${String(error)}`,
    });
    return { passed: false, score: 0, issues: ["parse_failed"] };
  }
}

