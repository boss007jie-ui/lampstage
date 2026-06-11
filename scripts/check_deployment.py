"""快速查询 Vercel 最新部署状态。"""
import json, re, urllib.request
from pathlib import Path

text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
for ln in text.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: tok=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^[A-Za-z0-9_-]{16,}$', ln): tok=ln; break

req = urllib.request.Request(
    'https://api.vercel.com/v6/deployments?projectId=prj_09nTS5u0tSgwWGOoZurc2g2JIgXL&limit=3&target=production',
    headers={'Authorization': f'Bearer {tok}'},
)
with urllib.request.urlopen(req, timeout=30) as r:
    d = json.loads(r.read())

for dep in d['deployments'][:3]:
    msg = dep.get('meta', {}).get('githubCommitMessage', '?')[:60]
    print(f"{dep['state']:10s}  {dep['uid'][-12:]}  https://{dep['url'][:60]}")
    print(f"             commit: {msg}")
