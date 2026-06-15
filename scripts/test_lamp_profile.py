"""阶段 1+2 验收：用真实灯具/场景图测 AI 推断质量。

流程：
1. 读 .yunwu_key.md 拿 key
2. 把 lamp-profile.ts 里的 SYSTEM_PROMPT 复制过来
3. 对 6 张图各调一次，打印 lamp_type / size_class / size_hint_cm /
   color_temp / target_audience / reasoning
4. 人眼判断准不准
"""
import base64, json, re, time, urllib.request
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ASSETS = HERMES / "lamp-saas-mvp" / "apps" / "web" / "public"

# 读 key
text = (HERMES / ".yunwu_key.md").read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
KEY = None
for ln in text.splitlines():
    ln = ln.strip()
    if not ln or ln.startswith("#"):
        continue
    m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
    if m:
        KEY = m.group(1).strip().strip('"').strip("'").strip("`")
        break
    if ln.startswith("sk-"):
        KEY = ln
        break

ENDPOINT = "https://yunwu.ai/v1/chat/completions"
MODEL = "gpt-5-mini"

SYSTEM_PROMPT = """You analyze a lamp product photo and return a structured profile in strict JSON.

Rules:
- lamp_type: one of [pendant, wall, table, floor, ceiling, unknown]
  pendant=hangs from ceiling with cord/rod;
  wall=mounted on wall (sconce);
  table=sits on table/nightstand;
  floor=stands on floor;
  ceiling=flush ceiling mount;
  unknown=cannot tell or not a lamp.
- size_class: small / medium / large (relative to that lamp_type's typical scale)
  pendant: small <=30cm diameter, medium 30-60cm, large >=60cm
  table: small <=35cm height, medium 35-55cm, large >=55cm
  floor: small <=140cm height, medium 140-170cm, large >=170cm
  wall: small <=25cm projection, medium 25-40cm, large >=40cm
  ceiling: small <=40cm diameter, medium 40-70cm, large >=70cm
- size_hint_cm: your best numeric estimate of the lamp's primary dimension (diameter for pendant/ceiling, height for table/floor, projection for wall)
- color_temp: looking at the bulb glow color and shade material, infer:
  warm_3000k=yellow/orange glow, linen/wood/amber glass shade
  neutral_4000k=natural white glow, mixed materials
  cool_5000k=cold white glow, clinical/minimal feel, metal+white shade
  tunable=if multiple LED zones or smart-lamp design hints
  Default to warm_3000k if uncertain (it is the home market majority).
- target_audience: which interior style this lamp best fits
  modern_luxury=black metal + marble + leather + velvet vibe
  nordic=light oak + white + linen, IKEA/HAY style
  wabi_sabi=gray/white + raw wood + paper + minimal japanese
  industrial=black iron + concrete + vintage brass + LOFT
  new_chinese=solid wood + ink wash + greenery + cultural minimalism
  french=ivory + arches + gold trim + florals + femme elegant
- material_keywords: 1-3 short tags in English describing what you see (e.g. "black metal", "linen shade", "amber glass")
- reasoning: <=30 words explaining the audience inference

Output ONLY a single JSON object. No prose, no markdown fence."""

def infer(img_path: Path) -> dict:
    bytes_ = img_path.read_bytes()
    b64 = base64.b64encode(bytes_).decode()
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": "Analyze this lamp and return the JSON profile."},
                ],
            },
        ],
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "authorization": f"Bearer {KEY}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    content = d.get("choices", [{}])[0].get("message", {}).get("content", "")
    return json.loads(content)


# 6 张测试图（每种灯具类型挑 1-2 张）
test_imgs = [
    ("吊灯-餐厅长桌", ASSETS / "showcase" / "02_dining_long_table.jpg"),
    ("吊灯-酒店大堂", ASSETS / "showcase" / "05_hotel_lobby.jpg"),
    ("吊灯-客厅", ASSETS / "showcase" / "01_living_pendant.jpg"),
    ("壁灯-卧室", ASSETS / "showcase" / "03_bedroom_wall_sconce.jpg"),
    ("落地灯-角落", ASSETS / "showcase" / "04_floor_lamp_corner.jpg"),
    ("台灯-床头", ASSETS / "templates" / "tpl_bedside_table_lamp.jpg"),
]

print(f"{'='*80}\nAI 灯具档案推断测试 (gpt-5-mini, 6 张图)\n{'='*80}\n")

for name, path in test_imgs:
    print(f"## {name}")
    print(f"   文件: {path.name}")
    t0 = time.time()
    try:
        r = infer(path)
        elapsed = time.time() - t0
        print(f"   推断耗时: {elapsed:.1f}s")
        print(f"   类型:     {r.get('lamp_type')}")
        print(f"   尺寸:     {r.get('size_class')} (~{r.get('size_hint_cm')}cm)")
        print(f"   色温:     {r.get('color_temp')}")
        print(f"   客群:     {r.get('target_audience')}")
        print(f"   材质:     {r.get('material_keywords')}")
        print(f"   理由:     {r.get('reasoning')}")
    except Exception as e:
        print(f"   ❌ 失败: {e}")
    print()
