"""直接查 Supabase 看 RechargeOrder 表是否存在 + 字段。"""
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

# 用 node + prisma client 查
script = '''
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  try {
    const cols = await p.$queryRawUnsafe(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'RechargeOrder' ORDER BY ordinal_position"
    );
    console.log("RechargeOrder columns:", cols.length);
    cols.forEach(c => console.log("  " + c.column_name + " : " + c.data_type));
  } catch (e) {
    console.log("err:", e.message);
  } finally { await p.$disconnect(); }
})();
'''
e = os.environ.copy()
e['DATABASE_URL']=url
e['DIRECT_URL']=url

p = Path(r'C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp\apps\web\_chk.js')
p.write_text(script, encoding='utf-8')
r = subprocess.run(['node','_chk.js'], cwd=str(p.parent), env=e, shell=True, capture_output=True, text=True, timeout=60)
print(r.stdout)
if r.stderr: print("ERR:", r.stderr[-500:])
p.unlink(missing_ok=True)
