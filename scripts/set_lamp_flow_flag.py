"""推 NEXT_PUBLIC_NEW_LAMP_FLOW_ENABLED Feature Flag 到 Vercel。
默认 false——上线后页面不变化，等用户确认稳定后改 true 启用。
"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

PROJECT_ID = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"
TEAM_ID = "team_dgmxAeThUgKds9L4lhLAEOFx"

text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.vercel_token.md").read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
tok = None
for ln in text.splitlines():
    ln = ln.strip()
    if not ln or ln.startswith("#"): continue
    m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
    if m: tok = m.group(1).strip().strip('"').strip("'").strip("`"); break
    if re.match(r"^[A-Za-z0-9_-]{16,}$", ln): tok = ln; break

def vapi(method, path, body=None):
    url = f"https://api.vercel.com{path}"
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}teamId={TEAM_ID}"
    data = json.dumps(body).encode() if body else None
    for a in range(4):
        try:
            req = urllib.request.Request(url, data=data, method=method,
                headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "User-Agent": "l/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read())
            except: return e.code, {}
        except (urllib.error.URLError, OSError):
            time.sleep(2 ** a)
    raise RuntimeError("api fail")

KEY = "NEXT_PUBLIC_NEW_LAMP_FLOW_ENABLED"
VAL = "true"  # 启用新流程

s, ex = vapi("GET", f"/v9/projects/{PROJECT_ID}/env?decrypt=false")
existing = {e["key"]: e["id"] for e in ex.get("envs", [])}

if KEY in existing:
    s, d = vapi("PATCH", f"/v10/projects/{PROJECT_ID}/env/{existing[KEY]}",
        body={"value": VAL, "target": ["production", "preview"]})
    print(f"updated {KEY}={VAL}: HTTP {s}")
else:
    s, d = vapi("POST", f"/v10/projects/{PROJECT_ID}/env",
        body={"key": KEY, "value": VAL, "type": "plain", "target": ["production", "preview"]})
    print(f"created {KEY}={VAL}: HTTP {s}")
