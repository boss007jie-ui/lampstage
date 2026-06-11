"""推 ADMIN_EMAILS 到 Vercel。"""
import json, urllib.request, urllib.error, re, time
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

ADMINS = "boss007jie@gmail.com,boss007yin@hotmail.com,531973620@qq.com"
s, ex = vapi('GET', f'/v9/projects/{PROJECT_ID}/env?decrypt=false')
for e in ex.get('envs', []):
    if e['key'] == 'ADMIN_EMAILS':
        vapi('DELETE', f'/v10/projects/{PROJECT_ID}/env/{e["id"]}')
        print("deleted old ADMIN_EMAILS")
s, d = vapi('POST', f'/v10/projects/{PROJECT_ID}/env', body={
    'key': 'ADMIN_EMAILS', 'value': ADMINS, 'type': 'plain',
    'target': ['production','preview'],
})
print(f"set ADMIN_EMAILS: {s} -> {ADMINS}")
