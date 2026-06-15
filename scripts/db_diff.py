"""调试：确认 schema 和 Supabase DB 之间的差异。
只读，不修改任何东西。
"""
import os, re, subprocess
from pathlib import Path
from urllib.parse import quote

raw = Path(r'C:\Users\boss0\Desktop\05-项目文件夹\hermes\.supabase_url.md').read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
url=None
for ln in raw.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_]+\s*=\s*(.+)$', ln)
    if m: url=m.group(1).strip().strip('"').strip("'"); break
    if ln.startswith('postgresql'): url=ln; break

m = re.match(r'^(postgresql|postgres)://([^:]+):([^@]+)@(.+)$', url, re.IGNORECASE)
if m:
    url = f'{m.group(1)}://{m.group(2)}:{quote(m.group(3), safe="")}@{m.group(4)}'
url = re.sub(r':6543/', ':5432/', url)
url = re.sub(r'[?&]pgbouncer=true\b', '', url)

e = os.environ.copy()
e['DATABASE_URL']=url
e['DIRECT_URL']=url

print("=== schema vs DB 差异 ===")
r = subprocess.run(
    ['npx','prisma','migrate','diff',
     '--from-schema-datamodel','prisma/schema.prisma',
     '--to-url', url,
     '--script'],
    cwd='apps/web', env=e, shell=True, capture_output=True, text=True, timeout=120,
)
print("STDOUT:", r.stdout[-2500:])
print("STDERR:", r.stderr[-1000:])
