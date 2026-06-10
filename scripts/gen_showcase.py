#!/usr/bin/env python3
"""一次性脚本：用豆包 Seedream 4-5（via yunwu.ai）给首页生成 5 张惊艳灯具家居场景图。

输入: ../04-视频/veo3.1/.env.local 里的 YUNWU_API_KEY
输出: apps/web/public/showcase/*.jpg
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
SHOWCASE_DIR = REPO / "apps" / "web" / "public" / "showcase"
# 优先读项目自己的 .env.local；找不到再回落到 veo3.1
ENV_FILE_PRIMARY = REPO / "apps" / "web" / ".env.local"
ENV_FILE_FALLBACK = Path(r"C:\Users\boss0\Desktop\04-视频\veo3.1\.env.local")

MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT_TPL = "https://yunwu.ai/v1beta/models/{model}:generateContent"
ASPECT_16_9 = "16:9"

QUALITY_RULES = (
    "Hyper-realistic interior photography. Magazine editorial quality, photoreal, "
    "natural light + warm bulb glow, soft shadows, depth of field. "
    "Strict negatives: no text, no watermark, no garbled letters, no extra lamp heads, "
    "no extra wires, no neon, no RGB, no stage lighting, no surreal beams, "
    "no floating fixtures, no cartoon, no oil painting, no illustration. Photo only."
)

SHOTS = [
    {
        "id": "01_living_pendant",
        "aspect": ASPECT_16_9,
        "prompt": (
            "Modern Scandinavian living room at golden hour. A single elegant black-and-brass "
            "pendant lamp hangs from the ceiling above a low coffee table, illuminating a beige "
            "linen sofa, oak floor, minimal art on the wall, large windows with soft warm "
            "sunlight spilling in. Pendant is the visual hero, with a believable hanging cord "
            "and warm 3000K downlight glow. " + QUALITY_RULES
        ),
    },
    {
        "id": "02_dining_long_table",
        "aspect": ASPECT_16_9,
        "prompt": (
            "Upscale dining room. A long linear pendant lamp with multiple warm globe bulbs "
            "hangs above a solid walnut dining table set with ceramic plates, candles, "
            "eucalyptus centerpiece. Soft evening light through gauzy curtains, plaster walls, "
            "oak chairs. Pendant centered above the table at a believable height with a clean "
            "rod. Cinematic. " + QUALITY_RULES
        ),
    },
    {
        "id": "03_bedroom_wall_sconce",
        "aspect": ASPECT_16_9,
        "prompt": (
            "Calm bedroom at dusk. Two matte black wall sconces flanking the bed, mounted "
            "flush on a soft plaster wall above a wooden nightstand. Linen bedding, an open "
            "paperback, a glass of water. Warm 2700K bedside glow, gentle shadows, intimate "
            "mood. Wall lamps are the visual focus. " + QUALITY_RULES
        ),
    },
    {
        "id": "04_floor_lamp_corner",
        "aspect": ASPECT_16_9,
        "prompt": (
            "Cozy reading corner. A tall arc floor lamp with a brushed brass body and a "
            "fabric drum shade stands on the wooden floor next to a tan leather lounge chair, "
            "side table with a stack of books and a ceramic cup. Warm puddle of light on the "
            "chair and book, dark wood bookshelf in the background. The floor lamp is rooted "
            "on the floor with a believable weighted base. " + QUALITY_RULES
        ),
    },
    {
        "id": "05_hotel_lobby",
        "aspect": ASPECT_16_9,
        "prompt": (
            "Premium hotel lobby. A sculptural modern chandelier with multiple cascading warm "
            "bulbs hangs from the high double-height ceiling, suspended by a clean rod, "
            "casting golden reflections on a polished marble floor and a curved velvet lounge "
            "sofa. Reception desk softly out of focus in the background. Cinematic, "
            "editorial. " + QUALITY_RULES
        ),
    },
]


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for path in (ENV_FILE_PRIMARY, ENV_FILE_FALLBACK):
        if not path.exists():
            continue
        for ln in path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("#") or "=" not in ln:
                continue
            k, v = ln.split("=", 1)
            k = k.strip()
            if k not in out:
                out[k] = v.strip().strip('"').strip("'")
    return out


def gen_one(prompt: str, aspect: str, api_key: str) -> bytes:
    """Nano Banana via yunwu.ai (Gemini-native /v1beta API)."""
    import base64

    url = ENDPOINT_TPL.replace("{model}", MODEL)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect},
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())

    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError(f"no image in response: {json.dumps(data)[:300]}")


def main() -> int:
    env = load_env()
    api_key = env.get("YUNWU_API_KEY")
    if not api_key:
        print("YUNWU_API_KEY missing")
        return 1
    SHOWCASE_DIR.mkdir(parents=True, exist_ok=True)

    for shot in SHOTS:
        out = SHOWCASE_DIR / f"{shot['id']}.jpg"
        if out.exists() and out.stat().st_size > 50_000:
            print(f"[skip] {out.name} ({out.stat().st_size // 1024}KB)")
            continue
        print(f"[gen]  {shot['id']} ...")
        t0 = time.time()
        try:
            data = gen_one(shot["prompt"], shot["aspect"], api_key)
        except Exception as e:
            print(f"[fail] {shot['id']}: {e}")
            continue
        out.write_bytes(data)
        print(f"[ok]   {out.name}  {len(data) // 1024}KB  {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
