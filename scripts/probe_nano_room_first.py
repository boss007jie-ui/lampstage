"""Prompt lab v3: 测试多图顺序影响。
目标：Image 1 = 房间参考，Image 2 = 灯具外观。看是否能降低灯具主角权重。
输出 public/prompt-lab/lamp-room-first.html。
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
ENDPOINT = "https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent"
LAMP_URL = "https://pub-752b0987bd5c4fef9e3ee3087457dcb1.r2.dev/uploads/cmq93fzs20000jr04u6ja4mf1/1739086f-3ebc-411d-9803-76b669c370a0.png"
ROOM_REF = WEB / "public" / "scene-refs-v2" / "living_offcenter_no_lamp.jpg"

def fetch_url_b64(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data=r.read(); mime=r.headers.get("content-type") or "image/png"
    return mime, base64.b64encode(data).decode()

def file_b64(path):
    data=path.read_bytes(); return "image/jpeg", base64.b64encode(data).decode()

lamp_mime,lamp_b64=fetch_url_b64(LAMP_URL)
room_mime,room_b64=file_b64(ROOM_REF)

PROMPTS={
 "A-room-first-edit": "Image 1 is the locked room reference. Preserve its room layout, sofa, coffee table, rug, plants, window daylight, camera angle, ceiling and shadows. Image 2 is only the lamp appearance reference. Add one unlit pendant inspired by image 2 as a small real fixture on the upper-right ceiling area. Keep the lamp modest, secondary to the room, and matched to perspective and ambient daylight.",
 "B-room-first-strict": "Use image 1 as the base photograph. Keep the room unchanged. Use image 2 only to copy the lamp's shape and material. Install one small unlit pendant in the upper-right ceiling zone, attached with a real canopy and chain. The sofa, table and room atmosphere stay dominant. The lamp should be smaller than the coffee table width and should not move the room composition.",
 "C-room-first-appearance-only": "The output should look like image 1 with one additional ceiling fixture. Image 2 provides lamp design only, not scale or composition. In the daylight room, the fixture is off and integrated into the ceiling with correct shadows. Keep furniture positions, lens, color grading, natural window light and empty-room feeling from image 1. The lamp is a subtle installed object, not the subject."
}

def extract(payload):
    for c in payload.get('candidates',[]):
        for p in c.get('content',{}).get('parts',[]):
            inline=p.get('inline_data') or p.get('inlineData')
            if inline and inline.get('data'):
                return inline.get('mime_type') or inline.get('mimeType') or 'image/png', inline['data']
    return None,None

cards=[]
for name,prompt in PROMPTS.items():
    out=OUT/f"roomfirst-{name}.png"
    print('generating',name)
    body={"contents":[{"role":"user","parts":[
        {"text":prompt},
        {"inline_data":{"mime_type":room_mime,"data":room_b64}},
        {"inline_data":{"mime_type":lamp_mime,"data":lamp_b64}},
    ]}],"generationConfig":{"responseModalities":["TEXT","IMAGE"],"imageConfig":{"aspectRatio":"4:5"}}}
    req=urllib.request.Request(ENDPOINT,data=json.dumps(body).encode(),method='POST',headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=180) as r:
        data=json.loads(r.read())
    mime,b64=extract(data)
    if not b64:
        print(' no image',json.dumps(data)[:500]); continue
    out.write_bytes(base64.b64decode(b64)); print(' wrote',out.name,out.stat().st_size//1024,'KB')
    cards.append((name,prompt,f"/prompt-lab/{out.name}"))

html_doc="""<!doctype html><meta charset='utf-8'><title>Room-first lab</title><style>body{font-family:Inter,Arial,sans-serif;background:#f6f4ef;margin:0;padding:24px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{background:white;border:1px solid #ddd;border-radius:14px;padding:12px}.card img{width:100%;border-radius:10px}.prompt{font-size:12px;color:#555;line-height:1.45}.refs{display:flex;gap:12px;margin-bottom:20px}.refs img{height:180px;border-radius:10px;border:1px solid #ddd}</style><h1>Prompt Lab v3: room reference first, lamp second</h1><p>测试多图顺序：先给房间，再给灯，看能否降低灯具主角权重。</p><div class='refs'><div><b>Image 1 房间</b><br><img src='/scene-refs-v2/living_offcenter_no_lamp.jpg'></div><div><b>Image 2 灯具</b><br><img src='"""+html.escape(LAMP_URL)+"""'></div></div><div class='grid'>"""
for name,prompt,src in cards:
    html_doc+=f"<div class='card'><img src='{src}'><h3>{html.escape(name)}</h3><div class='prompt'>{html.escape(prompt)}</div></div>"
html_doc+="</div>"
(OUT/'lamp-room-first.html').write_text(html_doc,encoding='utf-8')
print('HTML',OUT/'lamp-room-first.html')
