"""读取最近生成任务对应的 uploaded asset image_url（只读）。"""
import os, re, subprocess
from pathlib import Path
from urllib.parse import quote

ROOT = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp")
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
raw = (HERMES / ".supabase_url.md").read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
url = None
for ln in raw.splitlines():
    ln = ln.strip()
    if not ln or ln.startswith("#"):
        continue
    m = re.match(r"^[A-Z_]+\s*=\s*(.+)$", ln)
    if m:
        url = m.group(1).strip().strip('"').strip("'")
        break
    if ln.startswith("postgresql"):
        url = ln
        break
if not url:
    raise SystemExit("no db url")
m = re.match(r"^(postgresql|postgres)://([^:]+):([^@]+)@(.+)$", url, re.I)
if m:
    url = f"{m.group(1)}://{m.group(2)}:{quote(m.group(3), safe='')}@{m.group(4)}"
url = re.sub(r":6543/", ":5432/", url)
url = re.sub(r"[?&]pgbouncer=true\b", "", url)
js = ROOT / "apps" / "web" / "_latest_asset.js"
js.write_text(r'''
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const job = await p.generationJob.findFirst({
    orderBy: { created_at: 'desc' },
    include: { uploaded_asset: true },
  });
  if (!job) throw new Error('no job');
  console.log(JSON.stringify({ job_id: job.id, asset_id: job.uploaded_asset_id, image_url: job.uploaded_asset.image_url, file_type: job.uploaded_asset.file_type }));
})().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
''', encoding="utf-8")
env = os.environ.copy(); env["DATABASE_URL"] = url; env["DIRECT_URL"] = url
r = subprocess.run(["node", str(js.name)], cwd=str(js.parent), env=env, text=True, capture_output=True, timeout=60, shell=True)
print(r.stdout.strip())
if r.stderr:
    print(r.stderr[-1000:])
try: js.unlink()
except Exception: pass
