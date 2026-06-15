"""更新 YUNWU_API_KEY 到新 key（Vercel + 本地 .env.local）+ 重部署。
新 key 通过参数传入，不硬编码到脚本里（脚本会进 git）。
"""
import json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

NEW_KEY = sys.argv[1] if len(sys.argv) > 1 else None
if not NEW_KEY:
    sys.exit("usage: python update_yunwu_key.py <new_key>")

PROJECT_ID="prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"; TEAM_ID="team_dgmxAeThUgKds9L4lhLAEOFx"; REPO_ID=1265156618
text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
vtok=None
for ln in text.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: vtok=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): vtok=ln; break

def vapi(method, path, body=None, retries=6):
    url=f"https://api.vercel.com{path}{'&' if '?' in path else '?'}teamId={TEAM_ID}"
    data=json.dumps(body).encode() if body else None
    last=None
    for a in range(retries):
        try:
            req=urllib.request.Request(url, data=data, method=method,
                headers={'Authorization':f'Bearer {vtok}','Content-Type':'application/json','User-Agent':'l/1.0'})
            with urllib.request.urlopen(req,timeout=45) as r: return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read())
            except: return e.code, {}
        except (urllib.error.URLError,OSError) as e:
            last=e; time.sleep(2**a)
    raise RuntimeError(str(last))

# 1. Vercel：删旧 + 建新
s, ex = vapi('GET', f'/v9/projects/{PROJECT_ID}/env?decrypt=false')
for e in ex.get('envs', []):
    if e['key']=='YUNWU_API_KEY':
        vapi('DELETE', f'/v10/projects/{PROJECT_ID}/env/{e["id"]}')
        print("deleted old YUNWU_API_KEY")
s,d = vapi('POST', f'/v10/projects/{PROJECT_ID}/env', body={
    'key':'YUNWU_API_KEY','value':NEW_KEY,'type':'encrypted','target':['production','preview']})
print(f"set new YUNWU_API_KEY (prefix={NEW_KEY[:6]} len={len(NEW_KEY)}): {s}")

# 2. 本地 .env.local 同步
env_path = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp\apps\web\.env.local")
if env_path.exists():
    lines = env_path.read_text(encoding='utf-8').splitlines()
    out, found = [], False
    for ln in lines:
        if ln.startswith('YUNWU_API_KEY='):
            out.append(f'YUNWU_API_KEY={NEW_KEY}'); found=True
        else: out.append(ln)
    if not found: out.append(f'YUNWU_API_KEY={NEW_KEY}')
    env_path.write_text("\n".join(out)+"\n", encoding='utf-8')
    print("updated local .env.local")

# 3. 重部署
print("触发重部署…")
s,d = vapi('POST', '/v13/deployments', body={
    'name':'lampstage','project':PROJECT_ID,'target':'production',
    'gitSource':{'type':'github','repoId':REPO_ID,'ref':'master'}})
dpl=d.get('id'); print(f"deploy {s} {dpl}")
for _ in range(40):
    time.sleep(6)
    s,st=vapi('GET', f'/v13/deployments/{dpl}')
    state=st.get('readyState'); print(f"  {state}")
    if state in ('READY','ERROR','CANCELED'): break
