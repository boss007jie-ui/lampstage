"""生成无主灯/弱主灯 scene reference 图库。
用 gpt-image-2 edits：输入现有模板图，移除/弱化灯具，只保留房间布局、家具比例、相机角度。
"""
from pathlib import Path
import re, json, uuid, urllib.request, urllib.error, base64

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"
WEB = ROOT / "apps" / "web"
OUT = WEB / "public" / "scene-refs"
OUT.mkdir(parents=True, exist_ok=True)

key_text = (HERMES / ".gpt_image_key.md").read_text(encoding="utf-8").replace("\ufeff", "")
key = re.search(r"sk-[A-Za-z0-9]+", key_text).group(0)

JOBS = {
    "dining_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_dining_long_table_pendant.jpg", "Remove the pendant lamp and any visible ceiling light fixture from this dining room. Keep the same room layout, camera angle, table, chairs, window light, wall art, rug and furniture scale. Leave a clean realistic ceiling area where a new fixture could be installed later. Photoreal interior photography."),
    "living_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_living_room_main_light.jpg", "Remove the visible main light fixture from this living room. Keep the same sofa, coffee table, shelves, rug, windows, camera angle, ceiling height and furniture scale. Leave the ceiling clean and realistic, ready for a new fixture to be installed later. Photoreal interior photography."),
    "entryway_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_hotel_lobby_pendant.jpg", "Transform this into a minimalist entryway/lobby reference with the same camera perspective and room scale, but remove all pendant lamps and chandeliers. Keep console/lobby furniture, walls, ceiling geometry and natural interior lighting. Leave clean empty ceiling space. Photoreal interior photography."),
    "bedroom_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_bedroom_wall_sconce.jpg", "Remove all wall sconces and visible lamps from this bedroom. Keep bed, nightstand, bedding, wall, window light, camera angle and furniture scale. Leave clean wall/ceiling areas for later fixture installation. Photoreal interior photography."),
    "study_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_bedside_table_lamp.jpg", "Convert this into a small study/desk room reference. Remove all table lamps and visible light fixtures. Keep realistic desk/table furniture, wall, ceiling, window light, camera angle and scale. Leave empty space for later lighting installation. Photoreal interior photography."),
    "corner_no_lamp.jpg": (WEB / "public" / "templates" / "tpl_floor_lamp_beside_sofa.jpg", "Remove the floor lamp and all visible lighting fixtures from this living room corner. Keep sofa/chair, side table, rug, plants, window light, camera angle, floor and wall scale. Leave the corner empty for later floor lamp installation. Photoreal interior photography."),
}

def add_field(parts, boundary, name, value):
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

def add_file(parts, boundary, name, path):
    data = path.read_bytes()
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\nContent-Type: image/jpeg\r\n\r\n".encode()+data+b"\r\n")

for name, (src, prompt) in JOBS.items():
    out = OUT / name
    if out.exists() and out.stat().st_size > 100_000:
        print(f"skip {name}")
        continue
    print(f"editing {name} from {src.name}...")
    boundary = "----lampstage" + uuid.uuid4().hex
    parts=[]
    add_file(parts, boundary, "image", src)
    add_field(parts, boundary, "prompt", prompt)
    add_field(parts, boundary, "model", "gpt-image-2")
    add_field(parts, boundary, "n", "1")
    add_field(parts, boundary, "quality", "medium")
    add_field(parts, boundary, "size", "1024x1536")
    body=b"".join(parts)+f"--{boundary}--\r\n".encode()
    req=urllib.request.Request("https://yunwu.ai/v1/images/edits",data=body,method="POST",headers={"Accept":"application/json","Authorization":f"Bearer {key}","Content-Type":f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data=json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8", errors="replace")[:500])
        raise
    item=data.get("data",[{}])[0]
    if item.get("b64_json"):
        out.write_bytes(base64.b64decode(item["b64_json"]))
    elif item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=120) as rr:
            out.write_bytes(rr.read())
    else:
        raise RuntimeError(f"no image in {data}")
    print(f"  wrote {out.name} {out.stat().st_size//1024}KB")
