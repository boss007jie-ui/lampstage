"""一次性脚本：从 hermes/.yunwu_key 读取 API key，
更新 apps/web/.env.local，然后调用 nano banana 生成首页 5 张大图。

主代理永远不需要看到 key 字面量。
"""
from __future__ import annotations

import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HERMES_DIR = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
KEY_CANDIDATES = [
    HERMES_DIR / ".yunwu_key",
    HERMES_DIR / ".yunwu_key.md",
    HERMES_DIR / "yunwu_key.txt",
    HERMES_DIR / ".yunwu_key.txt",
    Path.home() / ".yunwu_key",
]

ENV_LOCAL = REPO / "apps" / "web" / ".env.local"
SHOWCASE_DIR = REPO / "apps" / "web" / "public" / "showcase"

MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT_TPL = "https://yunwu.ai/v1beta/models/{model}:generateContent"

KEY_VAR = "YUNWU_API_KEY"


def find_key() -> str:
    for c in KEY_CANDIDATES:
        if c.exists():
            v = c.read_text(encoding="utf-8").strip().splitlines()[0].strip().strip('"').strip("'")
            print(f"[ok]   read key from {c}  length={len(v)}")
            return v
    print("[fail] no key file found. tried:")
    for c in KEY_CANDIDATES:
        print(f"       {c}")
    sys.exit(1)


def make_env_line(name: str, value: str) -> str:
    return name + "=" + value


def update_env_local(key: str) -> None:
    """把真实 key 写进 .env.local 的 KEY_VAR 行。"""
    target_prefix = KEY_VAR + "="

    if not ENV_LOCAL.exists():
        defaults = [
            "DATABASE_URL=postgresql://lamp:lamp@localhost:5432/lamp",
            "NEXTAUTH_SECRET=replace-me-in-production",
            make_env_line(KEY_VAR, key),
            "NANO_BANANA_MODEL=gemini-3.1-flash-image-preview",
            "NANO_BANANA_ENDPOINT=https://yunwu.ai/v1beta/models/{model}:generateContent",
            "FALLBACK_IMAGE_MODEL=doubao-seedream-4-5-251128",
            "FALLBACK_IMAGE_ENDPOINT=https://yunwu.ai/v1/images/generations",
            "OSS_REGION=",
            "OSS_BUCKET=",
            "OSS_ACCESS_KEY_ID=",
            "OSS_ACCESS_KEY_SECRET=",
            "ADMIN_EMAILS=you@example.com",
        ]
        ENV_LOCAL.write_text("\n".join(defaults) + "\n", encoding="utf-8")
        print(f"[ok]   created {ENV_LOCAL}")
        return

    lines = ENV_LOCAL.read_text(encoding="utf-8").splitlines()
    found = False
    for i, ln in enumerate(lines):
        if ln.startswith(target_prefix):
            lines[i] = make_env_line(KEY_VAR, key)
            found = True
            break
    if not found:
        lines.append(make_env_line(KEY_VAR, key))
    ENV_LOCAL.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[ok]   updated {ENV_LOCAL}")


QUALITY = (
    "Hyper-realistic interior photography. Magazine editorial quality, photoreal, "
    "natural light + warm bulb glow, soft shadows, depth of field. "
    "Strict negatives: no text, no watermark, no garbled letters, no extra lamp heads, "
    "no extra wires, no neon, no RGB, no stage lighting, no surreal beams, "
    "no floating fixtures, no cartoon, no oil painting, no illustration. Photo only."
)

SHOTS = [
    ("01_living_pendant",
     "Modern Scandinavian living room at golden hour. A single elegant black-and-brass "
     "pendant lamp hangs from the ceiling above a low coffee table, illuminating a beige "
     "linen sofa, oak floor, minimal art on the wall, large windows with soft warm "
     "sunlight spilling in. Pendant is the visual hero, with a believable hanging cord "
     "and warm 3000K downlight glow. " + QUALITY),
    ("02_dining_long_table",
     "Upscale dining room. A long linear pendant lamp with multiple warm globe bulbs "
     "hangs above a solid walnut dining table set with ceramic plates, candles, "
     "eucalyptus centerpiece. Soft evening light through gauzy curtains, plaster walls, "
     "oak chairs. Pendant centered above the table at a believable height with a clean "
     "rod. Cinematic. " + QUALITY),
    ("03_bedroom_wall_sconce",
     "Calm bedroom at dusk. Two matte black wall sconces flanking the bed, mounted "
     "flush on a soft plaster wall above a wooden nightstand. Linen bedding, an open "
     "paperback, a glass of water. Warm 2700K bedside glow, gentle shadows, intimate "
     "mood. Wall lamps are the visual focus. " + QUALITY),
    ("04_floor_lamp_corner",
     "Cozy reading corner. A tall arc floor lamp with a brushed brass body and a "
     "fabric drum shade stands on the wooden floor next to a tan leather lounge chair, "
     "side table with a stack of books and a ceramic cup. Warm puddle of light on the "
     "chair and book, dark wood bookshelf in the background. The floor lamp is rooted "
     "on the floor with a believable weighted base. " + QUALITY),
    ("05_hotel_lobby",
     "Premium hotel lobby. A sculptural modern chandelier with multiple cascading warm "
     "bulbs hangs from the high double-height ceiling, suspended by a clean rod, "
     "casting golden reflections on a polished marble floor and a curved velvet lounge "
     "sofa. Reception desk softly out of focus in the background. Cinematic, "
     "editorial. " + QUALITY),
]


def gen_one(prompt: str, key: str) -> bytes:
    url = ENDPOINT_TPL.replace("{model}", MODEL)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "16:9"},
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + key,
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
    raise RuntimeError("no image in response: " + json.dumps(data)[:300])


def main() -> int:
    key = find_key()
    update_env_local(key)
    SHOWCASE_DIR.mkdir(parents=True, exist_ok=True)

    # 清掉旧的（豆包版本），强制重出 nano banana 版本
    for old in SHOWCASE_DIR.glob("*.jpg"):
        old.unlink()

    for sid, prompt in SHOTS:
        out = SHOWCASE_DIR / (sid + ".jpg")
        print("[gen]  " + sid + " ...")
        t0 = time.time()
        try:
            data = gen_one(prompt, key)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:240]
            print(f"[fail] {sid}: HTTP {e.code} {err_body}")
            continue
        except Exception as e:
            print(f"[fail] {sid}: {e}")
            continue
        out.write_bytes(data)
        print(f"[ok]   {out.name}  {len(data) // 1024}KB  {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
