"""给 Vercel 项目添加 lampstage.com + www，返回所需 DNS 配置。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

PROJECT_ID = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"
TEAM_ID = "team_dgmxAeThUgKds9L4lhLAEOFx"

text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
vtok=None
for ln in text.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: vtok=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): vtok=ln; break

def vapi(method, path, body=None, retries=4):
    url = f"https://api.vercel.com{path}"
    sep = '&' if '?' in url else '?'
    url = f"{url}{sep}teamId={TEAM_ID}"
    data = json.dumps(body).encode() if body else None
    last=None
    for a in range(retries):
        try:
            req = urllib.request.Request(url, data=data, method=method,
                headers={'Authorization': f'Bearer {vtok}','Content-Type':'application/json','User-Agent':'lampstage/1.0'})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read())
            except: return e.code, {}
        except (urllib.error.URLError, OSError) as e:
            last=e; time.sleep(2**a)
    raise RuntimeError(str(last))

for name in ["lampstage.com", "www.lampstage.com"]:
    s, d = vapi('POST', f'/v10/projects/{PROJECT_ID}/domains', body={'name': name})
    print(f"=== add {name}: HTTP {s}")
    if s >= 400:
        print(f"   {d.get('error',{}).get('message', d)}")
    else:
        print(f"   verified={d.get('verified')}  verification={json.dumps(d.get('verification'),ensure_ascii=False)}")

# 查每个域名的具体 DNS 配置要求
print("\n=== 所需 DNS 配置 ===")
for name in ["lampstage.com", "www.lampstage.com"]:
    s, d = vapi('GET', f'/v9/projects/{PROJECT_ID}/domains/{name}/config')
    print(f"\n{name}:")
    print(f"  misconfigured={d.get('misconfigured')}")
    if d.get('aValues'): print(f"  A 记录应指向: {d['aValues']}")
    if d.get('cnames'): print(f"  CNAME: {d['cnames']}")
    # 也查 domain 详情拿 verification
    s2, d2 = vapi('GET', f'/v9/projects/{PROJECT_ID}/domains/{name}')
    if d2.get('verification'):
        print(f"  verification TXT: {json.dumps(d2['verification'],ensure_ascii=False)}")
