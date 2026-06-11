"""拉取最近失败 deployment 的 build logs，全量打印。"""
import json, re, sys, urllib.request
from pathlib import Path

text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
tok = None
for ln in text.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: tok=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): tok=ln; break

if not tok:
    sys.exit("no token")

# 1. find latest failed deployment
req = urllib.request.Request(
    'https://api.vercel.com/v6/deployments?projectId=prj_09nTS5u0tSgwWGOoZurc2g2JIgXL&limit=5&target=production',
    headers={'Authorization': f'Bearer {tok}'},
)
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.loads(r.read())

# Pick the latest ERROR
deps = data.get('deployments', [])
err_dep = None
for d in deps:
    if d.get('state') == 'ERROR':
        err_dep = d
        break

if not err_dep:
    print("No failed deployments in latest 5")
    for d in deps[:3]:
        print(f"  {d.get('state')}  {d.get('uid')}")
    sys.exit(0)

DEP_ID = err_dep['uid']
print(f"=== logs for {DEP_ID} ===")
print(f"=== state: {err_dep.get('state')}")
print(f"=== created: {err_dep.get('created')}")

# 2. fetch events
req = urllib.request.Request(
    f'https://api.vercel.com/v3/deployments/{DEP_ID}/events?limit=500',
    headers={'Authorization': f'Bearer {tok}'},
)
with urllib.request.urlopen(req, timeout=30) as r:
    events = json.loads(r.read())

# events 可能是数组或字典
if isinstance(events, dict):
    events = events.get('events', [])

print(f"=== {len(events)} events ===\n")

# Print all stdout/stderr/fatal text
for e in events:
    typ = e.get('type', '?')
    if typ in ('stdout', 'stderr', 'fatal', 'error', 'warning'):
        p = e.get('payload', {})
        txt = p.get('text', '') or p.get('info', {}).get('text', '')
        if txt:
            print(f"[{typ}] {txt.rstrip()}")
