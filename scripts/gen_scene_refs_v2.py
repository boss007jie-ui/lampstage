"""生成 v2 off-center 无主灯 scene reference 图。
用 gpt-image-2 edits + 空白画布作为输入，避免沿用旧“主灯居中”模板骨架。
"""
from pathlib import Path
import re, json, uuid, urllib.request, urllib.error, base64
from PIL import Image

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"
OUT = ROOT / "apps" / "web" / "public" / "scene-refs-v2"
OUT.mkdir(parents=True, exist_ok=True)
BLANK = OUT / "_blank_canvas.png"
if not BLANK.exists():
    Image.new("RGB", (1024, 1536), (238, 235, 228)).save(BLANK)

key_text = (HERMES / ".gpt_image_key.md").read_text(encoding="utf-8").replace("\ufeff", "")
key = re.search(r"sk-[A-Za-z0-9]+", key_text).group(0)

PROMPTS = {
  "dining_offcenter_no_lamp.jpg": "Create a photoreal Scandinavian dining room interior from this blank canvas. Side-angle camera. Wooden dining table and chairs occupy lower middle of frame. Large window on one side, clean visible ceiling, neutral rug and decor. No pendant lamp, no chandelier, no ceiling light. Leave an empty ceiling area in the upper-left third for future small pendant installation. The center of the image is furniture and atmosphere. Real interior photography, 4:5 portrait.",
  "living_offcenter_no_lamp.jpg": "Create a photoreal Scandinavian living room interior from this blank canvas. Beige sofa and coffee table occupy lower center. Window light from the left, potted plant and shelf, clean visible ceiling. No pendant lamp, no chandelier, no ceiling fixture. Leave a natural empty ceiling area in the upper-right third for future small pendant installation. Room furniture is the visual focus. Real interior photography, 4:5 portrait.",
  "entryway_offcenter_no_lamp.jpg": "Create a photoreal minimalist entryway interior from this blank canvas. Wooden console table and round mirror in lower-middle frame, wall decor and plants, clean visible ceiling. No pendant lamp, no chandelier, no ceiling fixture. Leave an empty installable ceiling spot in the upper-left third, not centered. Home-decor photography, 4:5 portrait.",
  "bedroom_offcenter_no_lamp.jpg": "Create a photoreal neutral bedroom interior from this blank canvas. Bed and nightstands occupy lower middle, window light, clean wall and ceiling visible. No wall lamps, no pendant, no ceiling fixture. Leave an empty lighting position on one side wall/upper corner for later fixture installation. Real interior photography, 4:5 portrait.",
  "study_offcenter_no_lamp.jpg": "Create a photoreal minimalist study room from this blank canvas. Desk and chair occupy lower middle, bookshelf and window light, clean wall and ceiling visible. No desk lamp, no pendant, no ceiling light. Leave an empty upper side area for later lighting installation. Real interior photography, 4:5 portrait.",
  "corner_offcenter_no_lamp.jpg": "Create a photoreal cozy living room corner from this blank canvas. Lounge chair and side table in lower-middle frame, window light, plants, clean wall and floor visible. No floor lamp, no pendant, no light fixture. Leave empty corner space for a future floor lamp. Real interior photography, 4:5 portrait."
}

def add_field(parts, boundary, name, value):
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

def add_file(parts, boundary, name, path):
    data=path.read_bytes()
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\nContent-Type: image/png\r\n\r\n".encode()+data+b"\r\n")

for name,prompt in PROMPTS.items():
    out=OUT/name
    if out.exists() and out.stat().st_size>100000:
        print('skip',name); continue
    print('generating',name)
    boundary="----lampstage"+uuid.uuid4().hex
    parts=[]
    add_file(parts,boundary,"image",BLANK)
    add_field(parts,boundary,"prompt",prompt)
    add_field(parts,boundary,"model","gpt-image-2")
    add_field(parts,boundary,"n","1")
    add_field(parts,boundary,"quality","medium")
    add_field(parts,boundary,"size","1024x1536")
    body=b"".join(parts)+f"--{boundary}--\r\n".encode()
    req=urllib.request.Request("https://yunwu.ai/v1/images/edits",data=body,method="POST",headers={"Accept":"application/json","Authorization":f"Bearer {key}","Content-Type":f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req,timeout=180) as r:
            data=json.loads(r.read())
    except urllib.error.HTTPError as e:
        print('HTTP',e.code,e.read().decode('utf-8',errors='replace')[:800]); raise
    item=data.get('data',[{}])[0]
    if item.get('b64_json'):
        out.write_bytes(base64.b64decode(item['b64_json']))
    elif item.get('url'):
        with urllib.request.urlopen(item['url'],timeout=120) as rr: out.write_bytes(rr.read())
    else:
        raise RuntimeError(data)
    print(' wrote',out.name,out.stat().st_size//1024,'KB')
print('done',OUT)
