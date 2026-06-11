"""推送 Resend 配置到 Vercel + 触发新部署。

读：
  - .vercel_token.md (Vercel API token)
  - .resend_key.md (Resend API key)

做：
  1. 把 RESEND_API_KEY 推到 Vercel env (production + preview)
  2. 把 RESEND_FROM=Lampstage <onboarding@resend.dev> 推上去（DNS 没 verify 之前用 Resend 默认域）
  3. 触发 production deployment
  4. 等部署 ready
  5. 打印部署 URL
"""
from __future__ import annotations
import json, os, re, sys, time
import urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")


def clean_secret_file(p: Path) -> str:
    if not p.exists():
        sys.exit(f"FAIL: {p} not found")
    text = p.read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
        if m:
            v = m.group(1).strip().strip('"').strip("'").strip("`")
            if len(v) >= 16:
                return v
        if re.match(r"^[A-Za-z0-9_\-]{16,}$", ln):
            return ln
    sys.exit(f"FAIL: no usable token in {p}")


def vercel_api(method, path, token, body=None, team_id=None, retries=3):
    url = f"https://api.vercel.com{path}"
    if team_id:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}teamId={team_id}"
    data = json.dumps(body).encode() if body else None
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "lampstage-deploy/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read())
            except Exception:
                return e.code, {"error": "non-json"}
        except (urllib.error.URLError, OSError, ConnectionError) as e:
            last_err = e
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"   [retry] {type(e).__name__}, sleeping {wait}s")
                time.sleep(wait)
                continue
    raise RuntimeError(f"after {retries} retries: {last_err}")


def upsert_env(token, project_id, key, value, target=("production", "preview")):
    s, ex = vercel_api("GET", f"/v9/projects/{project_id}/env?decrypt=false", token)
    existing = {e["key"]: e["id"] for e in (ex.get("envs", []) if s == 200 else [])}
    if key in existing:
        s, d = vercel_api(
            "PATCH",
            f"/v10/projects/{project_id}/env/{existing[key]}",
            token, body={"value": value, "target": list(target)},
        )
        return ("updated", s, d)
    s, d = vercel_api(
        "POST",
        f"/v10/projects/{project_id}/env",
        token,
        body={"key": key, "value": value, "type": "encrypted", "target": list(target)},
    )
    return ("created", s, d)


def main():
    print("[1] reading tokens")
    vercel_tok = clean_secret_file(HERMES / ".vercel_token.md")
    resend_key = clean_secret_file(HERMES / ".resend_key.md")
    print(f"   vercel: prefix={vercel_tok[:4]}... len={len(vercel_tok)}")
    print(f"   resend: prefix={resend_key[:3]}... len={len(resend_key)}")

    if not resend_key.startswith("re_"):
        print(f"   ⚠️  resend key doesn't start with 're_' — proceeding anyway")

    print("\n[2] verify Vercel token")
    s, d = vercel_api("GET", "/v2/user", vercel_tok)
    if s != 200:
        sys.exit(f"   token invalid: {d}")
    user = d.get("user", {})
    print(f"   ✅ {user.get('username')}")

    print("\n[3] find lampstage project")
    s, d = vercel_api("GET", "/v9/projects/lampstage", vercel_tok)
    if s != 200:
        sys.exit(f"   not found: {d}")
    project_id = d.get("id")
    print(f"   ✅ id={project_id}")

    print("\n[4] push RESEND_API_KEY to Vercel env")
    action, s, d = upsert_env(vercel_tok, project_id, "RESEND_API_KEY", resend_key)
    print(f"   {action}: status={s}")
    if s not in (200, 201):
        sys.exit(f"   failed: {d}")

    print("\n[5] push RESEND_FROM (use resend.dev default until DNS verifies)")
    # Once DNS verified, we'll change to "Lampstage <hello@lampstage.com>"
    from_value = "Lampstage <onboarding@resend.dev>"
    action, s, d = upsert_env(vercel_tok, project_id, "RESEND_FROM", from_value)
    print(f"   {action}: status={s}, value={from_value}")

    print("\n[6] trigger production deployment from latest master")
    s, project = vercel_api("GET", "/v9/projects/lampstage", vercel_tok)
    repo_id = project.get("link", {}).get("repoId")
    body = {
        "name": "lampstage",
        "gitSource": {"type": "github", "repoId": repo_id, "ref": "master"},
        "target": "production",
    }
    s, d = vercel_api("POST", "/v13/deployments", vercel_tok, body=body)
    if s not in (200, 201):
        print(f"   ⚠️ {s}: {d}")
        sys.exit(1)
    deploy_id = d.get("id")
    deploy_url = d.get("url")
    print(f"   ✅ id={deploy_id}")
    print(f"   URL: https://{deploy_url}")

    print("\n[7] poll deployment status (max 4 min)")
    t0 = time.time()
    last_state = None
    while time.time() - t0 < 240:
        s, d = vercel_api("GET", f"/v13/deployments/{deploy_id}", vercel_tok)
        state = d.get("readyState", "?")
        if state != last_state:
            print(f"   t+{int(time.time()-t0)}s  state={state}")
            last_state = state
        if state == "READY":
            print(f"\n🎉 deployed: https://{deploy_url}")
            print(f"   alias:    https://lampstage.vercel.app")
            return
        if state == "ERROR":
            print(f"   ❌ build failed")
            print(f"   {d.get('errorMessage')}")
            sys.exit(1)
        time.sleep(8)
    print("   ⏰ timeout polling — check Vercel dashboard")


if __name__ == "__main__":
    main()
