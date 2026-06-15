"""只测新 key 调 nano-banana 生图。新 key 从参数传入。"""
import json, sys, time, urllib.request, urllib.error

key = sys.argv[1] if len(sys.argv)>1 else None
if not key: sys.exit("need key arg")
print(f"key prefix={key[:6]} len={len(key)}\n")

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
# 截断 base64 避免刷屏
if b and len(b)>500:
    b = b[:300] + f"... (总长 {len(b)}, 含图像数据=成功)"
print(f"HTTP {s}: {b}")
