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
import { getObjectBytes } from "@/lib/storage";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT_TPL =
  process.env.NANO_BANANA_ENDPOINT ||
  "https://yunwu.ai/v1beta/models/{model}:generateContent";
const GEN_MODEL =
  process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image";

const ASPECT_MAP: Record<string, string> = {
  "1_1": "1:1",
  "4_5": "4:5",
  "16_9": "16:9",
};

function apiKey(): string {
  // 生图专用 key（设了限额，防恶意刷量）；没配则回退到通用 key
  const k = process.env.YUNWU_IMAGE_KEY || process.env.YUNWU_API_KEY;
  if (!k) throw new Error("YUNWU_IMAGE_KEY / YUNWU_API_KEY env not set");
  return k;
}

async function fetchAsBase64(
  url: string,
): Promise<{ mime: string; b64: string }> {
  // 支持 public 下的相对路径（例如 /templates/foo.jpg），用于场景参考图
  if (url.startsWith("/")) {
    const filePath = path.join(process.cwd(), "public", url.replace(/^\/+/, ""));
    const bytes = await readFile(filePath);
    const lower = filePath.toLowerCase();
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { mime, b64: Buffer.from(bytes).toString("base64") };
  }
  const { bytes, mime } = await getObjectBytes(url);
  return { mime, b64: bytes.toString("base64") };
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
      const parts = [
        { text: input.prompt },
        { inline_data: { mime_type: ref.mime, data: ref.b64 } },
      ];
      const body = {
        contents: [
          {
            role: "user",
            parts,
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
