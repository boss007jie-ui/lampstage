"""一键部署 Lampstage 到 Vercel：
1. 读 .vercel_token.md (token)
2. 读 apps/web/.env.local (16 个环境变量)
3. 用 token 调 Vercel API 找/创建 lampstage project
4. 推所有 env vars 到 production
5. 调用 vercel CLI 触发部署 (--prod)

不打印 secret 字面量。
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
WEB = REPO / "apps" / "web"

PROJECT_NAME = "lampstage"


def read_token() -> str:
    p = HERMES / ".vercel_token.md"
    if not p.exists():
        sys.exit(f"FAIL: {p} not found")
    text = p.read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        # KEY=*** style
        m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
        if m:
            v = m.group(1).strip().strip('"').strip("'").strip("`")
            if len(v) >= 16:
                return v
        # Bare token
        if re.match(r"^[A-Za-z0-9_\-]{16,}$", ln):
            return ln
    sys.exit("FAIL: no usable token in file")


def read_envs() -> dict[str, str]:
    p = WEB / ".env.local"
    if not p.exists():
        sys.exit(f"FAIL: {p} not found")
    out: dict[str, str] = {}
    for ln in p.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^([A-Z_0-9]+)\s*=\s*(.+)$", ln)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v.startswith('"') and v.endswith('"'):
            v = v[1:-1]
        elif v.startswith("'") and v.endswith("'"):
            v = v[1:-1]
        if not v or "***" in v:  # skip placeholders
            continue
        if k.startswith("OSS_") and not v:  # skip empty oss
            continue
        out[k] = v
    return out


def vercel_api(method: str, path: str, token: str, body=None, team_id=None, retries=3):
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
                print(f"   [retry] {type(e).__name__} on {method} {path[:60]}, sleeping {wait}s...")
                time.sleep(wait)
                continue
    raise RuntimeError(f"vercel API failed after {retries} retries: {last_err}")


def main():
    print("[1] reading token + env vars")
    token = read_token()
    envs = read_envs()
    print(f"   token len={len(token)} prefix={token[:4]}...")
    print(f"   env vars: {len(envs)}")

    print("\n[2] verify token")
    s, d = vercel_api("GET", "/v2/user", token)
    if s != 200:
        sys.exit(f"   token rejected: {d}")
    user = d.get("user", {})
    print(f"   ✅ {user.get('username')} ({user.get('email')})")

    print("\n[3] list teams to find correct scope")
    s, teams_data = vercel_api("GET", "/v2/teams", token)
    teams = teams_data.get("teams", []) if s == 200 else []
    print(f"   personal + {len(teams)} team(s):")
    print(f"     - <personal>")
    for t in teams:
        print(f"     - {t.get('slug')} (id={t.get('id')})")

    # Find lampstage project across personal + each team
    print(f"\n[4] looking for project '{PROJECT_NAME}'")
    found_team_id = None
    found_project = None
    # personal
    s, d = vercel_api("GET", f"/v9/projects/{PROJECT_NAME}", token)
    if s == 200:
        found_project = d
        print(f"   ✅ found on personal account: id={d.get('id')}")
    else:
        for t in teams:
            tid = t.get("id")
            s, d = vercel_api("GET", f"/v9/projects/{PROJECT_NAME}", token, team_id=tid)
            if s == 200:
                found_team_id = tid
                found_project = d
                print(f"   ✅ found on team {t.get('slug')}: id={d.get('id')}")
                break

    if not found_project:
        print(f"   ❌ project '{PROJECT_NAME}' not found")
        print("   creating new project...")
        # Create on personal account, linked to GitHub
        body = {
            "name": PROJECT_NAME,
            "framework": "nextjs",
            "rootDirectory": "apps/web",
            "gitRepository": {
                "type": "github",
                "repo": "boss007jie-ui/lampstage",
            },
        }
        s, d = vercel_api("POST", "/v11/projects", token, body=body)
        if s not in (200, 201):
            sys.exit(f"   create failed: {d}")
        found_project = d
        print(f"   ✅ created: id={d.get('id')}")

    project_id = found_project.get("id")
    rd = found_project.get("rootDirectory")
    print(f"   current rootDirectory: {rd!r}")

    # Force-set rootDirectory if not apps/web
    if rd != "apps/web":
        print(f"\n[5] PATCH rootDirectory -> apps/web")
        s, d = vercel_api(
            "PATCH",
            f"/v9/projects/{project_id}",
            token,
            body={"rootDirectory": "apps/web", "framework": "nextjs"},
            team_id=found_team_id,
        )
        if s != 200:
            print(f"   ⚠️  PATCH failed: {d}")
        else:
            print(f"   ✅ rootDirectory now apps/web")
    else:
        print(f"\n[5] rootDirectory already correct, skip")

    # Push env vars
    print(f"\n[6] pushing {len(envs)} env vars to production")
    # First, fetch existing to avoid duplicate-create errors
    s, ex = vercel_api(
        "GET", f"/v9/projects/{project_id}/env?decrypt=false",
        token, team_id=found_team_id,
    )
    existing = {e["key"]: e["id"] for e in (ex.get("envs", []) if s == 200 else [])}

    pushed = 0
    failed = 0
    for k, v in envs.items():
        targets = ["production", "preview"]
        body = {
            "key": k,
            "value": v,
            "type": "encrypted",
            "target": targets,
        }
        if k in existing:
            s, d = vercel_api(
                "PATCH",
                f"/v10/projects/{project_id}/env/{existing[k]}",
                token, body={"value": v, "target": targets},
                team_id=found_team_id,
            )
            action = "updated"
        else:
            s, d = vercel_api(
                "POST",
                f"/v10/projects/{project_id}/env",
                token, body=body, team_id=found_team_id,
            )
            action = "created"
        if s in (200, 201):
            pushed += 1
            print(f"   ✅ {action} {k}")
        else:
            failed += 1
            print(f"   ❌ {k}: {d}")

    print(f"\n[7] {pushed}/{len(envs)} env vars set in production+preview+dev")

    # Trigger redeployment via API: create a new deployment from latest commit
    print(f"\n[8] triggering production deployment")
    # Easier: tell Vercel to deploy latest from git
    body = {
        "name": PROJECT_NAME,
        "gitSource": {
            "type": "github",
            "repoId": found_project.get("link", {}).get("repoId"),
            "ref": "master",
        },
        "target": "production",
    }
    s, d = vercel_api("POST", "/v13/deployments", token, body=body, team_id=found_team_id)
    if s in (200, 201):
        url = d.get("url")
        did = d.get("id")
        print(f"   ✅ deployment created: id={did}")
        print(f"   URL: https://{url}")
        print(f"\n   👉 watch progress: https://vercel.com/{user.get('username')}/{PROJECT_NAME}/deployments")
    else:
        print(f"   ⚠️  API deploy failed ({s}): {d}")
        print(f"   Fallback: go to Vercel dashboard and click Redeploy on the latest commit.")
        print(f"   URL: https://vercel.com/{user.get('username')}/{PROJECT_NAME}/deployments")


if __name__ == "__main__":
    main()
