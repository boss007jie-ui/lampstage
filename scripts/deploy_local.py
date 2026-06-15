"""直接从本地代码部署到 Vercel（绕开 GitHub）。
读 .vercel_token.md 拿 token → 在 apps/web 跑 vercel --prod。
"""
import os, re, subprocess, sys
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"
WEB = ROOT / "apps" / "web"

# 读 token
text = (HERMES / ".vercel_token.md").read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
tok = None
for ln in text.splitlines():
    ln = ln.strip()
    if not ln or ln.startswith("#"):
        continue
    m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
    if m:
        tok = m.group(1).strip().strip('"').strip("'").strip("`")
        break
    if re.match(r"^[A-Za-z0-9_-]{16,}$", ln):
        tok = ln
        break

if not tok:
    sys.exit("no token")
print(f"token len={len(tok)} prefix={tok[:4]}…")

# 跑 vercel CLI
e = os.environ.copy()
e["VERCEL_TOKEN"] = tok

cmd = ["npx", "vercel", "--prod", "--yes", "--token", tok, "--scope", "shawn-sd-projects1"]
print(f"\n[deploy] cwd={ROOT}")
r = subprocess.run(cmd, cwd=str(ROOT), env=e, shell=True, capture_output=True, text=True, timeout=600)
print("STDOUT:")
print(r.stdout[-3000:])
if r.stderr:
    print("STDERR:")
    print(r.stderr[-1500:])
sys.exit(r.returncode)
