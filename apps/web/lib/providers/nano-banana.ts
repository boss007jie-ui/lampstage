/**
 * Nano Banana via yunwu.ai —— Lampstage 默认图像生成 Provider。
 *
 * 接口形态：Gemini-native contents/parts。
 * MVP 单次返回 1 张图，编排层在 generation.ts 里并发跑 4 次组装。
 */
import type {
  GenInput,
  GenSingleResult,
  IGenerationProvider,
} from "./types";

const ENDPOINT_TPL =
  process.env.NANO_BANANA_ENDPOINT ||
  "https://yunwu.ai/v1beta/models/{model}:generateContent";
const GEN_MODEL =
  process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image-preview";

const ASPECT_MAP: Record<string, string> = {
  "1_1": "1:1",
  "4_5": "4:5",
  "16_9": "16:9",
};

function apiKey(): string {
  const k = process.env.YUNWU_API_KEY;
  if (!k) throw new Error("YUNWU_API_KEY env not set");
  return k;
}

async function fetchAsBase64(
  url: string,
): Promise<{ mime: string; b64: string }> {
  // 本地相对 URL（如 /uploads/abc.jpg / /generated/...）：直接读盘，避免 dev fetch 自身循环
  if (url.startsWith("/")) {
    const { promises: fs } = await import("node:fs");
    const path = (await import("node:path")).default;
    const full = path.join(process.cwd(), "public", url);
    const buf = await fs.readFile(full);
    const ext = path.extname(url).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
    return { mime, b64: buf.toString("base64") };
  }
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(
      `failed to fetch reference image (${r.status}): ${url.slice(0, 120)}`,
    );
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get("content-type") || "image/jpeg";
  return { mime, b64: buf.toString("base64") };
}

interface InlineDataLike {
  data?: string;
  mimeType?: string;
  mime_type?: string;
}

interface GeminiPart {
  inlineData?: InlineDataLike;
  inline_data?: InlineDataLike;
  text?: string;
}

function extractFirstImage(
  payload: unknown,
): { mime: string; b64: string } | null {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };
  for (const cand of data.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const inline = part.inline_data ?? part.inlineData;
      if (inline && inline.data) {
        return {
          mime: inline.mime_type ?? inline.mimeType ?? "image/png",
          b64: inline.data,
        };
      }
    }
  }
  return null;
}

export const nanoBananaProvider: IGenerationProvider = {
  name: "nano-banana",

  async generate(input: GenInput): Promise<GenSingleResult> {
    try {
      const ref = await fetchAsBase64(input.referenceImageUrl);
      const body = {
        contents: [
          {
            role: "user",
            parts: [
              { text: input.prompt },
              { inline_data: { mime_type: ref.mime, data: ref.b64 } },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: ASPECT_MAP[input.aspectRatio] || "1:1",
          },
        },
      };

      const url = ENDPOINT_TPL.replace("{model}", GEN_MODEL);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          ok: false,
          error: `nano-banana ${res.status}: ${errText.slice(0, 240)}`,
        };
      }

      const json = await res.json();
      const img = extractFirstImage(json);
      if (!img) {
        return { ok: false, error: "nano-banana returned no image in response" };
      }
      return {
        ok: true,
        bytes: Buffer.from(img.b64, "base64"),
        mime: img.mime,
      };
    } catch (e) {
      return { ok: false, error: `nano-banana exception: ${String(e)}` };
    }
  },
};
