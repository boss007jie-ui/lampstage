"""只读：查看最新 job 的 asset profile 字段和完整 prompt_text 前几段。"""
import os, re, subprocess
from pathlib import Path
from urllib.parse import quote
ROOT=Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp")
HERMES=Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
raw=(HERMES/".supabase_url.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
url=None
for ln in raw.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_]+\s*=\s*(.+)$',ln)
    if m: url=m.group(1).strip().strip('"').strip("'"); break
    if ln.startswith('postgresql'): url=ln; break
m=re.match(r'^(postgresql|postgres)://([^:]+):([^@]+)@(.+)$',url,re.I)
if m: url=f"{m.group(1)}://{m.group(2)}:{quote(m.group(3),safe='')}@{m.group(4)}"
url=re.sub(r':6543/',':5432/',url); url=re.sub(r'[?&]pgbouncer=true\b','',url)
js=ROOT/'apps'/'web'/'_inspect_latest_profile_prompt.js'
js.write_text(r'''
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async()=>{
 const j=await p.generationJob.findFirst({orderBy:{created_at:'desc'}, include:{uploaded_asset:true}});
 console.log(JSON.stringify({
  job_id:j.id, created_at:j.created_at, status:j.status, scene_kind:j.scene_kind,
  profile:{lamp_type:j.uploaded_asset.detected_lamp_type,size_class:j.uploaded_asset.size_class,size_hint_cm:j.uploaded_asset.size_hint_cm,color_temp:j.uploaded_asset.color_temp,target_audience:j.uploaded_asset.target_audience,ai_inferred_at:j.uploaded_asset.ai_inferred_at},
  prompt_text:j.prompt_text
 }, null, 2));
})().catch(e=>{console.error(e);process.exit(1)}).finally(()=>p.$disconnect());
''',encoding='utf-8')
env=os.environ.copy(); env['DATABASE_URL']=url; env['DIRECT_URL']=url
r=subprocess.run(['node',str(js.name)],cwd=str(js.parent),env=env,text=True,capture_output=True,timeout=60,shell=True)
print(r.stdout[:6000])
if r.stderr: print('STDERR', r.stderr[-1000:])
try: js.unlink()
except Exception: pass
