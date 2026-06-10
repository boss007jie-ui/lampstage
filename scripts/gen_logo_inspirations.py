"""Generate 6 logo concept inspiration images for Lampstage via nano banana.

Output: docs/logo-explore/inspiration/<idx>_<slug>.jpg
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
OUT = REPO / "docs" / "logo-explore" / "inspiration"
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")

MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT = f"https://yunwu.ai/v1beta/models/{MODEL}:generateContent"
ASPECT = "1:1"


def clean(text):
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
    return ""


KEY = clean((HERMES / ".yunwu_key.md").read_text(encoding="utf-8"))

QUALITY = (
    "Centered logo on flat off-white background, vector-clean, no shadow, "
    "no extra text, professional brand mark, monochrome or two-tone, "
    "1:1 framing, generous margins, no garbled letters, no neon, no watermark."
)

CONCEPTS = [
    (
        "01_pendant_line",
        "A minimal monoline logo of a hanging pendant lamp: a single thin "
        "downward line with a soft glowing half-dome at the bottom, warm "
        "amber bulb visible. Brand mark style, very minimal, single color "
        "deep navy with one small warm glow accent. " + QUALITY,
    ),
    (
        "02_letterform_l",
        "A custom letterform logo: the letter 'L' redrawn as a vintage "
        "Edison filament wire, curved warm tungsten coil glowing inside the "
        "stroke. Negative space tells the story. Solid dark background with "
        "warm filament color. " + QUALITY,
    ),
    (
        "03_stage_spotlight",
        "A logo combining a narrow downward light cone (stage spotlight) "
        "with a small subject standing in its glow — but make the subject "
        "a tiny stylized lamp instead of a person. Editorial, theatrical, "
        "deep ink color with a single warm spotlight beam. " + QUALITY,
    ),
    (
        "04_pixel_bulb",
        "A logo of a lightbulb rendered in 5x5 chunky pixel grid style. "
        "Modern AI-tool vibe like Vercel or Linear. Two-tone: charcoal "
        "pixels with one or two warm glow pixels lit up. " + QUALITY,
    ),
    (
        "05_concentric_rings",
        "An ultra-minimal logo of three concentric soft-glow rings expanding "
        "outward from a tiny bright center. Reads as 'a lamp turned on'. "
        "Pure geometry, two-tone gradient warm orange to deep ink. "
        + QUALITY,
    ),
    (
        "06_squared_filament",
        "A rounded-square brand mark with a stylized horizontal filament "
        "wave inside, like a heartbeat across a small screen. Black square "
        "with warm orange filament line. Very Linear / Vercel / Notion. "
        + QUALITY,
    ),
]


def gen_one(prompt: str) -> bytes:
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": ASPECT},
        },
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
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
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, prompt in CONCEPTS:
        out = OUT / f"{slug}.jpg"
        if out.exists() and out.stat().st_size > 50_000:
            print(f"[skip] {out.name}")
            continue
        print(f"[gen]  {slug} ...")
        t0 = time.time()
        try:
            data = gen_one(prompt)
        except urllib.error.HTTPError as e:
            print(f"[fail] {slug}: HTTP {e.code} {e.read().decode()[:240]}")
            continue
        out.write_bytes(data)
        print(f"[ok]   {out.name}  {len(data)//1024}KB  {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
