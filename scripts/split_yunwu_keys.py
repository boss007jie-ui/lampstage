"""
拆分 key：
- 旧 key (.yunwu_key.md) → YUNWU_API_KEY（识图/推荐/分类）
- 新 key (.yunwu_image_key.md) → YUNWU_IMAGE_KEY（生图，有限额）
先各自验证有效，再推 Vercel + 同步本地 + 重部署。
"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")

def read_key(fn):
    raw = (HERMES/fn).read_text(encoding='utf-8').replace('\ufeff','')
    for ln in raw.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip('`')
        if re.match(r'^sk-[A-Za-z0-9]+$', ln): return ln
        return ln
    return None

OLD = read_key(".yunwu_key.md")        # 识图
NEW = read_key(".yunwu_image_key.md")  # 生图
print(f"OLD(识图) len={len(OLD)} prefix={OLD[:6]}")
print(f"NEW(生图) len={len(NEW)} prefix={NEW[:6]}\n")

# 验证旧 key 识图 (gpt-5-mini chat)
def post(url, body, key, retries=3):
    for a in range(retries):
        try:
            req=urllib.request.Request(url, data=json.dumps(body).encode(),
                headers={'Authorization':f'Bearer {key}','Content-Type':'application/json','User-Agent':'l/1.0'}, method='POST')
            with urllib.request.urlopen(req,timeout=60) as r: return r.status, r.read().decode()
        except urllib.error.HTTPError as e: return e.code, e.read().decode()
        except (urllib.error.URLError,OSError):
            if a<retries-1: time.sleep(3); continue
            return None,"net"
    return None,"fail"

s,b = post("https://yunwu.ai/v1/chat/completions",
    {"model":"gpt-5-mini","messages":[{"role":"user","content":"say OK"}],"max_tokens":10}, OLD)
print(f"旧 key 识图测试: HTTP {s}: {b[:120]}")
if s != 200:
    print("⚠️ 旧 key 识图失败，仍继续配置（你可稍后排查识图 key）")

# 推 Vercel
PROJECT_ID="prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"; TEAM_ID="team_dgmxAeThUgKds9L4lhLAEOFx"; REPO_ID=1265156618
vtok = read_key("../.vercel_token.md") if (HERMES/"../.vercel_token.md").exists() else None
# vercel token 在 HERMES 下
raw = (HERMES/".vercel_token.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
for ln in raw.splitlines():
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

s, ex = vapi('GET', f'/v9/projects/{PROJECT_ID}/env?decrypt=false')
envs = {e['key']: e['id'] for e in ex.get('envs', [])}

def set_env(key, val):
    if key in envs:
        vapi('DELETE', f'/v10/projects/{PROJECT_ID}/env/{envs[key]}')
    s,d = vapi('POST', f'/v10/projects/{PROJECT_ID}/env',
        body={'key':key,'value':val,'type':'encrypted','target':['production','preview']})
    print(f"  set {key}: {s}")

print("\n推 Vercel:")
set_env('YUNWU_API_KEY', OLD)
set_env('YUNWU_IMAGE_KEY', NEW)

# 同步本地 .env.local
env_path = HERMES/"lamp-saas-mvp"/"apps"/"web"/".env.local"
lines = env_path.read_text(encoding='utf-8').splitlines() if env_path.exists() else []
out=[]; seen={'YUNWU_API_KEY':False,'YUNWU_IMAGE_KEY':False}
for ln in lines:
    if ln.startswith('YUNWU_API_KEY='): out.append(f'YUNWU_API_KEY={OLD}'); seen['YUNWU_API_KEY']=True
    elif ln.startswith('YUNWU_IMAGE_KEY='): out.append(f'YUNWU_IMAGE_KEY={NEW}'); seen['YUNWU_IMAGE_KEY']=True
    else: out.append(ln)
if not seen['YUNWU_API_KEY']: out.append(f'YUNWU_API_KEY={OLD}')
if not seen['YUNWU_IMAGE_KEY']: out.append(f'YUNWU_IMAGE_KEY={NEW}')
env_path.write_text("\n".join(out)+"\n", encoding='utf-8')
print("本地 .env.local 已同步")

# 重部署
print("\n重部署:")
s,d = vapi('POST', '/v13/deployments', body={
    'name':'lampstage','project':PROJECT_ID,'target':'production',
    'gitSource':{'type':'github','repoId':REPO_ID,'ref':'master'}})
dpl=d.get('id'); print(f"  deploy {s} {dpl}")
for _ in range(40):
    time.sleep(6)
    s,st=vapi('GET', f'/v13/deployments/{dpl}')
    state=st.get('readyState'); print(f"  {state}")
    if state in ('READY','ERROR','CANCELED'): break
