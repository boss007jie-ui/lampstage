/**
 * 场景推荐：让视觉模型看灯具图，返回 4 个针对性场景方案。
 *
 * 走 DeepSeek chat completions（OpenAI 兼容），模型 deepseek-flash
 * （支持 text + image 输入）。输出严格 JSON 数组（4 项），每项含
 * title/pitch/prompt_en/best_for。
 * 见 lib/deepseek.ts 的两个坑（推理模型吃 max_tokens、错模型 id 静默回落）。
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { THINKING_DISABLED, chatApiKey, chatEndpoint, chatModel } from "@/lib/deepseek";

const ENDPOINT = chatEndpoint(process.env.SCENE_SUGGEST_ENDPOINT);
const MODEL = chatModel(process.env.SCENE_SUGGEST_MODEL);

export type Scene = {
  /** 场景标签（中/英文短名），≤6 字 */
  title: string;
  /** 一句话卖点理由，≤30 字 */
  pitch: string;
  /** 英文 prompt，传给图像模型 */
  prompt_en: string;
  /** 适合卖给哪类买家 */
  best_for: string[];
};

const SYSTEM_PROMPT = `You are a senior visual director for a lamp e-commerce SaaS. Given a single lamp product photo, you propose 4 distinct, sales-ready interior scene concepts that best showcase the lamp.

Rules:
- Each scene must be unique (different room type / lifestyle vibe).
- prompt_en must be a self-contained English image-generation prompt: room type, key furniture, color palette, lighting, materials, camera angle, mood. ~80 words.
- prompt_en must NOT change the lamp itself (preserve shape, color, materials, scale).
- prompt_en must include "lifestyle e-commerce style, photoreal, no text, no watermark".
- title 6 chars max (Chinese OK).
- pitch 30 chars max (Chinese OK).
- best_for: 1-2 short audience tags.
- Output ONLY a JSON array of 4 objects. No prose, no markdown fence.`;

async function readImageAsBase64(
  refUrlOrPath: string,
): Promise<{ b64: string; mime: string }> {
  if (refUrlOrPath.startsWith("/")) {
    const full = path.join(process.cwd(), "public", refUrlOrPath);
    const buf = await fs.readFile(full);
    const ext = path.extname(refUrlOrPath).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return { b64: buf.toString("base64"), mime };
  }
  const r = await fetch(refUrlOrPath);
  const ab = await r.arrayBuffer();
  return {
    b64: Buffer.from(ab).toString("base64"),
    mime: r.headers.get("content-type") || "image/jpeg",
  };
}

function stripFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function isScene(x: unknown): x is Scene {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.title === "string" &&
    typeof o.pitch === "string" &&
    typeof o.prompt_en === "string" &&
    Array.isArray(o.best_for)
  );
}

export async function suggestScenes(refUrlOrPath: string): Promise<Scene[]> {
  const apiKey = chatApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const img = await readImageAsBase64(refUrlOrPath);

  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Look at this lamp and propose 4 sales-ready scenes. JSON array only.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.b64}` },
          },
        ],
      },
    ],
    // 用 max_tokens（实测 max_completion_tokens 会被收下但不一定生效）。
    // 真实规模实测：开思考时 completion_tokens≈990；关思考后≈650。4000 有充足余量。
    max_tokens: 4000,
    // 关闭思考，避免思维链挤占正文预算（见 lib/deepseek.ts）
    thinking: THINKING_DISABLED,
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `suggest-scenes ${res.status}: ${(await res.text()).slice(0, 240)}`,
    );
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("suggest-scenes: empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch (e) {
    throw new Error(
      `suggest-scenes: invalid JSON: ${String(e)} :: ${raw.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("suggest-scenes: response is not an array");
  }
  const scenes = parsed.filter(isScene).slice(0, 4);
  if (scenes.length === 0) {
    throw new Error("suggest-scenes: no valid scenes in response");
  }
  return scenes;
}
