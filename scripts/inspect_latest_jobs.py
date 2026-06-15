"""只读检查最近生成任务是否走 profile-driven 新流程。"""
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
# direct URL for prisma query
m = re.match(r"^(postgresql|postgres)://([^:]+):([^@]+)@(.+)$", url, re.I)
if m:
    url = f"{m.group(1)}://{m.group(2)}:{quote(m.group(3), safe='')}@{m.group(4)}"
url = re.sub(r":6543/", ":5432/", url)
url = re.sub(r"[?&]pgbouncer=true\b", "", url)

js = ROOT / "apps" / "web" / "_inspect_jobs.js"
js.write_text(r'''
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const jobs = await p.generationJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 8,
    select: {
      id: true,
      scene_kind: true,
      prompt_text: true,
      status: true,
      failure_reason: true,
      created_at: true,
      outputs: { select: { id: true }, take: 5 }
    }
  });
  for (const j of jobs) {
    console.log('---');
    console.log('id=', j.id);
    console.log('created=', j.created_at.toISOString());
    console.log('scene_kind=', j.scene_kind, 'status=', j.status, 'outputs=', j.outputs.length);
    console.log('failure=', j.failure_reason || '');
    console.log('prompt=', (j.prompt_text || '').replace(/\n/g, ' ').slice(0, 500));
  }
})().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
''', encoding="utf-8")

env = os.environ.copy()
env["DATABASE_URL"] = url
env["DIRECT_URL"] = url
r = subprocess.run(["node", str(js.name)], cwd=str(js.parent), env=env, text=True, capture_output=True, timeout=60, shell=True)
print(r.stdout)
if r.stderr:
    print("STDERR:", r.stderr[-1000:])
try:
    js.unlink()
except Exception:
    pass
