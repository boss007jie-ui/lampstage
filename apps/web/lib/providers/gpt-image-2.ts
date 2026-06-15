/**
 * GPT Image 2 via yunwu.ai /v1/images/edits.
 *
 * 用途：Lampstage 高质量补充图。当前策略：3 张图中第 3 张使用 gpt-image-2，
 * 前 2 张继续 nano-banana 控成本。
 *
 * 接口：multipart/form-data
 *   - image: 用户上传灯具图
 *   - prompt: 场景描述
 *   - model: gpt-image-2
 *   - n: 1
 *   - size: 根据 aspect ratio 映射
 */
import type {
  GenInput,
  GenSingleResult,
  IGenerationProvider,
} from "./types";
import { getObjectBytes } from "@/lib/storage";

const ENDPOINT = process.env.GPT_IMAGE_ENDPOINT || "https://yunwu.ai/v1/images/edits";
const MODEL = process.env.GPT_IMAGE_MODEL || "gpt-image-2";

const SIZE_MAP: Record<string, string> = {
  "1_1": "1024x1024",
  "4_5": "1024x1536",
  "16_9": "1536x1024",
};

function apiKey(): string {
  // gpt-image-2 专用 key；没配时回退到通用/生图 key，方便本地调试
  const k = process.env.GPT_IMAGE_KEY || process.env.YUNWU_IMAGE_KEY || process.env.YUNWU_API_KEY;
  if (!k) throw new Error("GPT_IMAGE_KEY / YUNWU_IMAGE_KEY / YUNWU_API_KEY env not set");
  return k;
}

async function fetchRef(url: string): Promise<{ bytes: Buffer; mime: string }> {
  const { bytes, mime } = await getObjectBytes(url);
  return { bytes, mime: mime || "image/png" };
}

function extractImage(payload: unknown): { b64?: string; url?: string } | null {
  const p = payload as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = p.data?.[0];
  if (!first) return null;
  if (first.b64_json) return { b64: first.b64_json };
  if (first.url) return { url: first.url };
  return null;
}

async function fetchUrlBytes(url: string): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download url failed ${res.status}`);
  const ab = await res.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    mime: res.headers.get("content-type") || "image/png",
  };
}

export const gptImage2Provider: IGenerationProvider = {
  name: "gpt-image-2",

  async generate(input: GenInput): Promise<GenSingleResult> {
    try {
      const ref = await fetchRef(input.referenceImageUrl);
      const form = new FormData();
      form.append(
        "image",
        new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }),
        `reference.${ref.mime.includes("png") ? "png" : "jpg"}`,
      );
      form.append("prompt", input.prompt);
      form.append("model", MODEL);
      form.append("n", "1");
      form.append("quality", process.env.GPT_IMAGE_QUALITY || "medium");
      form.append("size", SIZE_MAP[input.aspectRatio] || "1024x1024");
      form.append("background", "auto");
      form.append("moderation", process.env.GPT_IMAGE_MODERATION || "auto");

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey()}`,
          // 不要手动设置 Content-Type，fetch 会自动加 boundary
        },
        body: form,
      });

      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          error: `gpt-image-2 ${res.status}: ${text.slice(0, 300)}`,
        };
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, error: `gpt-image-2 returned non-json: ${text.slice(0, 200)}` };
      }
      const img = extractImage(json);
      if (!img) return { ok: false, error: "gpt-image-2 returned no image" };

      if (img.b64) {
        return { ok: true, bytes: Buffer.from(img.b64, "base64"), mime: "image/png" };
      }
      if (img.url) {
        const got = await fetchUrlBytes(img.url);
        return { ok: true, bytes: got.bytes, mime: got.mime };
      }
      return { ok: false, error: "gpt-image-2 empty image payload" };
    } catch (e) {
      return { ok: false, error: `gpt-image-2 exception: ${String(e)}` };
    }
  },
};
