"""Generate 6 reference images for the fixed templates using nano banana.

Output: apps/web/public/templates/<id>.jpg
Maps 1:1 to prisma/seed.ts template ids.
"""
from __future__ import annotations

import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
OUT_DIR = REPO / "apps" / "web" / "public" / "templates"

MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT_TPL = "https://yunwu.ai/v1beta/models/{model}:generateContent"
ASPECT = "1:1"  # square thumbs


def load_key() -> str:
    text = (HERMES / ".yunwu_key.md").read_text(encoding="utf-8")
    text = text.replace("\ufeff", "").replace("\\_", "_")
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^[A-Z_]+\s*=\s*(.+)$", ln)
        if m:
            ln = m.group(1).strip()
        return ln.strip('"').strip("'").strip("`")
    raise SystemExit("yunwu key empty")


QUALITY = (
    "Hyper-realistic interior photography. Magazine editorial quality, photoreal, "
    "natural light + warm bulb glow, soft shadows, depth of field. Square framing. "
    "No text, no watermark, no garbled letters, no extra lamp heads, no neon, "
    "no stage lighting, no surreal beams, no floating fixtures, no cartoon. Photo only."
)

TEMPLATES = [
    (
        "tpl_dining_long_table_pendant",
        "Upscale dining room. A long linear pendant lamp with multiple warm globe bulbs "
        "hangs above a solid walnut dining table set with ceramic plates, candles, "
        "eucalyptus centerpiece. Soft evening light through gauzy curtains. "
        "Pendant centered above the table. Cinematic. " + QUALITY,
    ),
    (
        "tpl_living_room_main_light",
        "Modern Scandinavian living room with a single sculptural pendant lamp as the "
        "ceiling centerpiece, beige sofa, low oak coffee table, large windows with soft "
        "afternoon light, neutral tones, lifestyle e-commerce mood. " + QUALITY,
    ),
    (
        "tpl_bedroom_wall_sconce",
        "Calm bedroom at dusk. Two matte black wall sconces flanking the bed mounted "
        "flush on a soft plaster wall above a wooden nightstand. Linen bedding, open "
        "paperback, warm 2700K bedside glow, intimate mood. Wall lamps are visual focus. "
        + QUALITY,
    ),
    (
        "tpl_floor_lamp_beside_sofa",
        "Cozy reading corner. A tall arc floor lamp with brushed brass body and fabric "
        "drum shade stands on the wooden floor next to a tan leather lounge chair, side "
        "table with books and ceramic cup. Warm puddle of light on the chair, dark wood "
        "bookshelf in the background. " + QUALITY,
    ),
    (
        "tpl_bedside_table_lamp",
        "Warm bedroom scene. A table lamp resting on a wooden nightstand beside a bed "
        "with linen bedding. Open book, glass of water, gentle warm reading light. "
        + QUALITY,
    ),
    (
        "tpl_hotel_lobby_pendant",
        "Premium hotel lobby. A sculptural modern chandelier with cascading warm bulbs "
        "hangs from a high double-height ceiling, suspended by a clean rod, casting "
        "golden reflections on a polished marble floor and a curved velvet lounge sofa. "
        "Reception desk softly out of focus in the background. Cinematic, editorial. "
        + QUALITY,
    ),
]


def gen_one(prompt: str, key: str) -> bytes:
    url = ENDPOINT_TPL.replace("{model}", MODEL)
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": ASPECT},
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError(f"no image: {json.dumps(data)[:300]}")


def main() -> int:
    key = load_key()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for tid, prompt in TEMPLATES:
        out = OUT_DIR / f"{tid}.jpg"
        if out.exists() and out.stat().st_size > 50_000:
            print(f"[skip] {out.name}")
            continue
        print(f"[gen]  {tid} ...")
        t0 = time.time()
        try:
            data = gen_one(prompt, key)
        except urllib.error.HTTPError as e:
            print(f"[fail] {tid}: HTTP {e.code} {e.read().decode()[:240]}")
            continue
        except Exception as e:
            print(f"[fail] {tid}: {e}")
            continue
        out.write_bytes(data)
        print(f"[ok]   {out.name}  {len(data)//1024}KB  {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
