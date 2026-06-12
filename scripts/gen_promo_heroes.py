"""为朋友圈宣传图生成 3 张高质量灯具家居场景图（nano-banana）。
输出: promo-assets/hero1.jpg hero2.jpg hero3.jpg
"""
import base64, json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
OUT = HERMES / "lamp-saas-mvp" / "promo-assets"
OUT.mkdir(parents=True, exist_ok=True)

# yunwu key
def read_key(p):
    t = Path(p).read_text(encoding="utf-8").replace("\ufeff","").replace("\\_","_")
    for ln in t.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith("#"): continue
        m=re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip("`")
        if re.match(r"^sk-[A-Za-z0-9_-]{16,}$", ln) or len(ln)>20: return ln
    return None

KEY = read_key(HERMES / ".yunwu_key.md")
ENDPOINT = "https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent"

PROMPTS = [
    # hero1: 现代客厅落地大窗 + 暖色吊灯
    ("hero1.jpg", "Editorial interior photography, a modern minimalist living room at golden hour, "
     "a designer pendant lamp glowing warmly above a low sofa, floor-to-ceiling windows with soft sunset light, "
     "wooden floor, neutral tones, professional architectural magazine quality, photorealistic, 16:9, high detail"),
    # hero2: 北欧餐厅长桌吊灯
    ("hero2.jpg", "Editorial interior photography, a Scandinavian dining room, a row of elegant pendant lamps "
     "glowing over a long oak dining table, large windows with greenery outside, warm cozy atmosphere, "
     "professional real-estate magazine quality, photorealistic, 16:9, high detail"),
    # hero3: 卧室床头氛围灯
    ("hero3.jpg", "Editorial interior photography, a warm modern bedroom at dusk, a stylish bedside table lamp "
     "casting soft warm glow, neatly made bed with linen textures, muted earthy palette, intimate cozy mood, "
     "professional interior magazine quality, photorealistic, 16:9, high detail"),
]

def gen(prompt):
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "16:9"}},
    }
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read())
    for cand in d.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError("no image in response: " + json.dumps(d)[:300])

for name, prompt in PROMPTS:
    for attempt in range(3):
        try:
            print(f"生成 {name} (尝试 {attempt+1})…", flush=True)
            img = gen(prompt)
            (OUT / name).write_bytes(img)
            print(f"  ✅ {name}  {len(img)//1024}KB", flush=True)
            break
        except Exception as e:
            print(f"  失败: {str(e)[:150]}", flush=True)
            time.sleep(3)
print("DONE")
