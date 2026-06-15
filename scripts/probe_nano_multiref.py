"""Prompt lab: 固定同一盏灯 + 同一张 v2 room reference，跑多版 nano-banana 多图 prompt。
输出 public/prompt-lab/lamp-scale-compare.html 供浏览器对比。
"""
from pathlib import Path
import base64, json, re, urllib.request, urllib.error, html

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"
WEB = ROOT / "apps" / "web"
OUT = WEB / "public" / "prompt-lab"
OUT.mkdir(parents=True, exist_ok=True)

key_text = (HERMES / ".yunwu_image_key.md").read_text(encoding="utf-8").replace("\ufeff", "")
key = re.search(r"sk-[A-Za-z0-9]+", key_text).group(0)
MODEL = "gemini-3.1-flash-image-preview"
ENDPOINT = f"https://yunwu.ai/v1beta/models/{MODEL}:generateContent"

# 最近你一直测的那张灯，来自 get_latest_asset.py 输出；如果后续换图，改这里即可。
LAMP_URL = "https://pub-752b0987bd5c4fef9e3ee3087457dcb1.r2.dev/uploads/cmq93fzs20000jr04u6ja4mf1/1739086f-3ebc-411d-9803-76b669c370a0.png"
ROOM_REF = WEB / "public" / "scene-refs-v2" / "living_offcenter_no_lamp.jpg"

def fetch_url_b64(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
        mime = r.headers.get("content-type") or "image/png"
    return mime, base64.b64encode(data).decode()

def file_b64(path):
    data = path.read_bytes()
    return "image/jpeg", base64.b64encode(data).decode()

lamp_mime, lamp_b64 = fetch_url_b64(LAMP_URL)
room_mime, room_b64 = file_b64(ROOM_REF)

PROMPTS = {
    "A-room-subject": "Image 1 is the lamp reference. Image 2 is the exact room reference. Keep image 2 composition, camera angle, furniture scale, sofa, table, window light and ceiling. Add the lamp from image 1 as a small installed ceiling fixture in the upper-right ceiling area. The room remains the subject; furniture stays unchanged. Photoreal interior photography, 4:5.",
    "B-inpaint-language": "Edit image 2 only: install the lamp from image 1 onto the empty upper-right ceiling area. Preserve image 2 room layout, sofa, coffee table, rug, window, perspective and lighting. The lamp should be a modest real fixture, smaller than the coffee table width, integrated with ceiling shadows and ambient light. Do not rebuild the room. Photoreal.",
    "C-strict-composition": "Use image 2 as a locked composition reference. Keep the same room, furniture positions and camera framing. Use image 1 only for lamp shape/material. Place one pendant in the top-right 20% of the frame, attached to the ceiling, not on the center vertical axis. Furniture and atmosphere are the visual focus. Realistic installed fixture, correct scale, 4:5.",
}

def extract_img(payload):
    for cand in payload.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inline_data") or part.get("inlineData")
            if inline and inline.get("data"):
                return inline.get("mime_type") or inline.get("mimeType") or "image/png", inline["data"]
    return None, None

cards = []
for name, prompt in PROMPTS.items():
    out = OUT / f"{name}.png"
    print("generating", name)
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": lamp_mime, "data": lamp_b64}},
                {"inline_data": {"mime_type": room_mime, "data": room_b64}},
            ],
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "4:5"},
        },
    }
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8", errors="replace")[:800])
        raise
    mime, b64 = extract_img(data)
    if not b64:
        print(" no image returned; text=", json.dumps(data)[:500])
        cards.append((name + " (NO IMAGE)", prompt + "\n\n[No image returned]", ""))
        continue
    out.write_bytes(base64.b64decode(b64))
    print(" wrote", out.name, out.stat().st_size//1024, "KB")
    cards.append((name, prompt, f"/prompt-lab/{out.name}"))

html_doc = """
<!doctype html><meta charset='utf-8'><title>Lamp prompt lab</title>
<style>
body{font-family:Inter,Arial,sans-serif;background:#f6f4ef;margin:0;padding:24px;color:#111}h1{font-size:22px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:white;border:1px solid #ddd;border-radius:14px;padding:12px;box-shadow:0 8px 24px #0001}.card img{width:100%;border-radius:10px;display:block}.name{font-weight:700;margin:8px 0}.prompt{font-size:12px;line-height:1.45;color:#555;white-space:pre-wrap}.refs{display:flex;gap:12px;margin-bottom:20px}.refs img{height:180px;border-radius:10px;background:white;border:1px solid #ddd}</style>
<h1>Prompt Lab: multi-reference lamp integration</h1>
<p>固定同一张灯具图 + 同一张无主灯客厅参考图。看哪版最能让灯不居中、不巨大、自然融入场景。</p>
<div class='refs'><div><b>Image 1 灯具</b><br><img src='""" + html.escape(LAMP_URL) + """'></div><div><b>Image 2 房间参考</b><br><img src='/scene-refs-v2/living_offcenter_no_lamp.jpg'></div></div>
<div class='grid'>
"""
for name, prompt, src in cards:
    html_doc += f"<div class='card'><img src='{src}'><div class='name'>{html.escape(name)}</div><div class='prompt'>{html.escape(prompt)}</div></div>\n"
html_doc += "</div>"
(OUT / "lamp-scale-compare.html").write_text(html_doc, encoding="utf-8")
print("HTML", OUT / "lamp-scale-compare.html")
