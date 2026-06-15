"""用新 yunwu key 测 gpt-5-mini 识图 + nano-banana 生图，看真实错误。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

env = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp\apps\web\.env.local").read_text(encoding='utf-8')
key=None
for ln in env.splitlines():
    if ln.startswith('YUNWU_API_KEY='):
        key=ln.split('=',1)[1].strip().strip('"').strip("'"); break
print(f"key prefix={key[:6]} len={len(key)}\n")

def post(url, body, retries=4):
    for a in range(retries):
        try:
            req=urllib.request.Request(url, data=json.dumps(body).encode(),
                headers={'Authorization':f'Bearer {key}','Content-Type':'application/json','User-Agent':'l/1.0'}, method='POST')
            with urllib.request.urlopen(req,timeout=60) as r: return r.status, r.read().decode()
        except urllib.error.HTTPError as e: return e.code, e.read().decode()
        except (urllib.error.URLError,OSError) as e:
            if a<retries-1: time.sleep(3); continue
            return None, str(e)
    return None,"fail"

# 1. gpt-5-mini 文本（最轻量，先测 key 通不通 + 模型权限）
print("=== gpt-5-mini chat ===")
s,b = post("https://yunwu.ai/v1/chat/completions", {
    "model":"gpt-5-mini","messages":[{"role":"user","content":"say OK"}],"max_tokens":10})
print(f"HTTP {s}: {b[:400]}\n")

# 2. nano-banana 生图
print("=== nano-banana 生图 ===")
s,b = post("https://yunwu.ai/v1beta/models/gemini-3.1-flash-image-preview:generateContent", {
    "contents":[{"parts":[{"text":"a simple red apple on white background"}]}],
    "generationConfig":{"responseModalities":["IMAGE"]}})
print(f"HTTP {s}: {b[:400]}")
