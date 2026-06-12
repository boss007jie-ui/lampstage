"""用 DNS 编辑 token 给 lampstage.com 加 Vercel 所需记录 + 验证。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

def read_tok(path):
    text = Path(path).read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
    for ln in text.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip('`')
        if re.match(r'^[A-Za-z0-9_-]{20,}$', ln): return ln
    return None

cftok = read_tok(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.cloudflare_dns_token.md")
if not cftok:
    raise SystemExit("no cloudflare dns token")

def cf(method, path, body=None):
    url = f"https://api.cloudflare.com/client/v4{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method,
        headers={'Authorization': f'Bearer {cftok}', 'Content-Type':'application/json'})
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return json.loads(e.read())
            except: return {"success": False, "errors":[{"message":f"HTTP {e.code}"}]}
        except (urllib.error.URLError, OSError) as e:
            time.sleep(2**a)
    return {"success": False, "errors":[{"message":"network"}]}

# zone id
z = cf('GET', '/zones?name=lampstage.com')
if not z.get('success') or not z.get('result'):
    raise SystemExit(f"zone lookup failed: {z.get('errors')}")
zid = z['result'][0]['id']
print(f"zone: {zid[:12]}…")

# 现有记录
ex = cf('GET', f'/zones/{zid}/dns_records?per_page=100')
existing = ex.get('result', []) if ex.get('success') else []
print(f"现有记录 {len(existing)} 条")

def upsert(rtype, name, content, proxied=False):
    # 找同名同类型
    fqdn = "lampstage.com" if name == "@" else f"{name}.lampstage.com"
    match = [r for r in existing if r['type']==rtype and r['name']==fqdn]
    body = {"type": rtype, "name": name, "content": content, "ttl": 1, "proxied": proxied}
    if match:
        rid = match[0]['id']
        r = cf('PUT', f'/zones/{zid}/dns_records/{rid}', body)
        action = "更新"
    else:
        r = cf('POST', f'/zones/{zid}/dns_records', body)
        action = "新建"
    ok = r.get('success')
    print(f"  {action} {rtype} {name} → {content} proxied={proxied}: {'✅' if ok else '❌ '+str(r.get('errors'))}")
    return ok

print("\n=== 写入 Vercel 所需记录 ===")
upsert("A", "@", "76.76.21.21", proxied=False)
upsert("CNAME", "www", "cname.vercel-dns.com", proxied=False)

# 验证解析
print("\n=== 验证解析(DoH，可能要等 DNS 传播) ===")
time.sleep(5)
for nm in ["lampstage.com", "www.lampstage.com"]:
    req = urllib.request.Request(f"https://cloudflare-dns.com/dns-query?name={nm}&type=A",
        headers={"accept":"application/dns-json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
        ans = [a.get('data') for a in d.get('Answer',[])]
        print(f"  {nm}: {ans or '(还没传播，正常，等几分钟)'}")
    except Exception as e:
        print(f"  {nm}: {e}")
