"""从文件读新生图 key，测 nano-banana 生图。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

raw = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.yunwu_image_key.md").read_text(encoding='utf-8').replace('\ufeff','')
key=None
for ln in raw.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: key=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^sk-[A-Za-z0-9]+$', ln): key=ln; break
    key=ln; break
print(f"key len={len(key)}\n")

def post(url, body, retries=4):
    for a in range(retries):
        try:
            req=urllib.request.Request(url, data=json.dumps(body).encode(),
                headers={'Authorization':f'Bearer {key}','Content-Type':'application/json','User-Agent':'l/1.0'}, method='POST')
            with urllib.request.urlopen(req,timeout=90) as r: return r.status, r.read().decode()
        except urllib.error.HTTPError as e: return e.code, e.read().decode()
        except (urllib.error.URLError,OSError) as e:
            if a<retries-1: time.sleep(3); continue
            return None, str(e)
    return None,"fail"

print("=== nano-banana 生图 ===")
s,b = post("https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent", {
    "contents":[{"parts":[{"text":"a simple red apple on white background"}]}],
    "generationConfig":{"responseModalities":["IMAGE"]}})
if b and len(b)>500: b = b[:200] + f"... (总长 {len(b)} = 含图像数据,成功)"
print(f"HTTP {s}: {b}")
