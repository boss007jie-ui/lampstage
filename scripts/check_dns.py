"""核对 lampstage.com 实际配置：Vercel 要求 vs Cloudflare 现状。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

def read_tok(path, pat=r'^[A-Za-z0-9_-]{16,}$'):
    text = Path(path).read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
    for ln in text.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip('`')
        if re.match(pat, ln): return ln
    return None

vtok = read_tok(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md")
cftok = read_tok(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.cloudflare_token.md")

PROJECT_ID = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"
TEAM_ID = "team_dgmxAeThUgKds9L4lhLAEOFx"

def vget(path):
    url=f"https://api.vercel.com{path}{'&' if '?' in path else '?'}teamId={TEAM_ID}"
    req=urllib.request.Request(url, headers={'Authorization':f'Bearer {vtok}','User-Agent':'l/1.0'})
    for a in range(3):
        try:
            with urllib.request.urlopen(req,timeout=30) as r: return json.loads(r.read())
        except (urllib.error.URLError,OSError): time.sleep(2**a)
    return {}

# Vercel 要求的配置
cfg = vget(f'/v9/projects/{PROJECT_ID}/domains/lampstage.com/config')
print("=== Vercel 要求 ===")
print(f"  misconfigured: {cfg.get('misconfigured')}")
print(f"  推荐 A 记录值: {cfg.get('aValues') or cfg.get('recommendedIPv4') or '76.76.21.21 (Vercel 默认)'}")
print(f"  CNAME 目标: {cfg.get('cnames')}")
print(f"  完整: {json.dumps(cfg, ensure_ascii=False)[:400]}")

# Cloudflare 现有 DNS
print("\n=== Cloudflare 现有 DNS (lampstage.com) ===")
# 先拿 zone id
req=urllib.request.Request("https://api.cloudflare.com/client/v4/zones?name=lampstage.com",
    headers={'Authorization':f'Bearer {cftok}','Content-Type':'application/json'})
try:
    with urllib.request.urlopen(req,timeout=30) as r:
        zones=json.loads(r.read())
    zid=zones['result'][0]['id']
    print(f"  zone id: {zid[:12]}…")
    req2=urllib.request.Request(f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records?per_page=100",
        headers={'Authorization':f'Bearer {cftok}','Content-Type':'application/json'})
    with urllib.request.urlopen(req2,timeout=30) as r:
        recs=json.loads(r.read())
    for rec in recs['result']:
        if rec['type'] in ('A','AAAA','CNAME'):
            print(f"  {rec['type']:5} {rec['name']:28} → {rec['content']:30} proxied={rec.get('proxied')}")
except Exception as e:
    print(f"  错误: {e}")
