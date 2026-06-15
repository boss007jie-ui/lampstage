"""推 GPT_IMAGE_KEY / GPT_IMAGE_MODEL 到 Vercel lampstage 项目。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
PROJECT_ID = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"
TEAM_ID = "team_dgmxAeThUgKds9L4lhLAEOFx"

def read_vercel_token():
    text=(HERMES/'.vercel_token.md').read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
    for ln in text.splitlines():
        ln=ln.strip()
        if not ln or ln.startswith('#'): continue
        m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m: return m.group(1).strip().strip('"').strip("'").strip('`')
        if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): return ln
    raise SystemExit('no vercel token')

def read_key():
    text=(HERMES/'.gpt_image_key.md').read_text(encoding='utf-8').replace('\ufeff','')
    m=re.search(r'sk-[A-Za-z0-9]+', text)
    if not m: raise SystemExit('no sk key in .gpt_image_key.md')
    return m.group(0)

def api(method, path, token, body=None):
    url=f'https://api.vercel.com{path}'
    sep='&' if '?' in url else '?'
    url=f'{url}{sep}teamId={TEAM_ID}'
    data=json.dumps(body).encode() if body else None
    for i in range(4):
        try:
            req=urllib.request.Request(url,data=data,method=method,headers={'Authorization':f'Bearer {token}','Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=45) as r:
                return r.status,json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return e.code,json.loads(e.read())
            except Exception: return e.code,{}
        except Exception:
            time.sleep(2**i)
    raise RuntimeError('api failed')

def upsert(k,v,token):
    s,ex=api('GET',f'/v9/projects/{PROJECT_ID}/env?decrypt=false',token)
    existing={e['key']:e['id'] for e in (ex.get('envs',[]) if s==200 else [])}
    targets=['production','preview']
    if k in existing:
        s,d=api('PATCH',f'/v10/projects/{PROJECT_ID}/env/{existing[k]}',token,{'value':v,'target':targets})
        print(f'PATCH {k}: {s}')
    else:
        s,d=api('POST',f'/v10/projects/{PROJECT_ID}/env',token,{'key':k,'value':v,'type':'encrypted','target':targets})
        print(f'POST {k}: {s}')
    if s not in (200,201): print(d); raise SystemExit(1)

token=read_vercel_token(); key=read_key()
print(f'GPT key len={len(key)} prefix={key[:6]} suffix={key[-4:]}')
upsert('GPT_IMAGE_KEY', key, token)
upsert('GPT_IMAGE_MODEL', 'gpt-image-2', token)
upsert('GPT_IMAGE_QUALITY', 'medium', token)
print('done')
