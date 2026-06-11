"""DNS 验证完成后切换 RESEND_FROM 到自定义域名 + 触发部署。"""
import json, re, sys, time
import urllib.error, urllib.request
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")

def secret(p: Path):
    text = p.read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
    text = re.sub(r'^```.*$', '', text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith('#'): continue
        m = re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
        if m:
            v = m.group(1).strip().strip('"').strip("'").strip('`')
            if len(v) >= 16: return v
        if re.match(r'^[A-Za-z0-9_\-]{16,}$', ln):
            return ln
    sys.exit(f"FAIL: no token in {p}")

VTOK = secret(HERMES / ".vercel_token.md")
PROJECT = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"


def vapi(method, path, body=None, retries=3):
    url = f"https://api.vercel.com{path}"
    data = json.dumps(body).encode() if body else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, method=method,
            headers={"Authorization": f"Bearer {VTOK}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try: return e.code, json.loads(e.read())
            except: return e.code, {}
        except (urllib.error.URLError, OSError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise


print("[1] update RESEND_FROM to use lampstage.com domain")
s, ex = vapi("GET", f"/v9/projects/{PROJECT}/env?decrypt=false")
existing = {e["key"]: e["id"] for e in ex.get("envs", [])}

# Use 'send@lampstage.com' since SPF record name is 'send'
new_from = "Lampstage <send@lampstage.com>"
if "RESEND_FROM" in existing:
    s, d = vapi("PATCH", f"/v10/projects/{PROJECT}/env/{existing['RESEND_FROM']}",
                body={"value": new_from, "target": ["production", "preview"]})
    print(f"   updated: {s}, value={new_from}")

print("\n[2] trigger deployment")
s, p = vapi("GET", f"/v9/projects/lampstage")
repo_id = p.get("link", {}).get("repoId")
s, d = vapi("POST", "/v13/deployments",
            body={"name": "lampstage",
                  "gitSource": {"type": "github", "repoId": repo_id, "ref": "master"},
                  "target": "production"})
print(f"   id={d.get('id')}")
deploy_id = d.get('id')

print("\n[3] wait until READY")
t0 = time.time()
while time.time() - t0 < 180:
    s, d = vapi("GET", f"/v13/deployments/{deploy_id}")
    state = d.get("readyState")
    print(f"   t+{int(time.time()-t0)}s  state={state}")
    if state == "READY":
        print(f"\n🎉 deployed: https://{d.get('url')}")
        print(f"   alias:    https://lampstage.vercel.app")
        sys.exit(0)
    if state == "ERROR":
        sys.exit(f"   ❌ {d.get('errorMessage')}")
    time.sleep(8)
print("   timeout — check Vercel dashboard")
