"""等 Vercel 签发证书 + 验证 lampstage.com 可访问。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

def read_tok(path):
    text = Path(path).read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
    for ln in text.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip('`')
        if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): return ln
    return None

vtok = read_tok(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md")
PROJECT_ID="prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"; TEAM_ID="team_dgmxAeThUgKds9L4lhLAEOFx"

def vget(path):
    url=f"https://api.vercel.com{path}{'&' if '?' in path else '?'}teamId={TEAM_ID}"
    req=urllib.request.Request(url, headers={'Authorization':f'Bearer {vtok}','User-Agent':'l/1.0'})
    for a in range(3):
        try:
            with urllib.request.urlopen(req,timeout=30) as r: return json.loads(r.read())
        except (urllib.error.URLError,OSError): time.sleep(2**a)
    return {}

# 轮询配置状态
for i in range(12):
    cfg = vget(f'/v9/projects/{PROJECT_ID}/domains/lampstage.com/config')
    mis = cfg.get('misconfigured')
    print(f"  t+{i*15}s  misconfigured={mis}")
    if mis is False:
        break
    time.sleep(15)

# 实际访问 https
print("\n=== 访问测试 ===")
for url in ["https://lampstage.com", "https://www.lampstage.com"]:
    try:
        req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read(200).decode(errors='replace')
            print(f"  {url}: HTTP {r.status} ✅  {'灯境' if '灯境' in body or 'lang' in body else body[:50]}")
    except urllib.error.HTTPError as e:
        print(f"  {url}: HTTP {e.code}")
    except Exception as e:
        print(f"  {url}: {type(e).__name__} {e}")
