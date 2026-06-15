"""把虎皮椒 AppID/Secret 推到 Vercel lampstage 项目（production+preview），然后触发部署。
不打印 secret 字面量。
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"

PROJECT_ID = "prj_09nTS5u0tSgwWGOoZurc2g2JIgXL"
TEAM_ID = "team_dgmxAeThUgKds9L4lhLAEOFx"


def read_token() -> str:
    text = (HERMES / ".vercel_token.md").read_text(encoding="utf-8").replace("\ufeff", "").replace("\\_", "_")
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^[A-Z_0-9]+\s*=\s*(.+)$", ln)
        if m:
            return m.group(1).strip().strip('"').strip("'").strip("`")
        if re.match(r"^[A-Za-z0-9_-]{16,}$", ln):
            return ln
    sys.exit("no vercel token")


def read_xunhupay() -> tuple[str, str]:
    p = HERMES / ".xunhupay.md"
    if not p.exists():
        sys.exit(f"FAIL: {p} not found")
    raw = p.read_text(encoding="utf-8").replace("\ufeff", "")
    appid = secret = None
    for ln in raw.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^(appid|app[\s_]?id|XUNHUPAY_APPID)\s*[:：=]\s*(.+)$", ln, re.IGNORECASE)
        if m:
            appid = m.group(2).strip().strip('"').strip("'").strip("`")
            continue
        m = re.match(r"^(密钥|secret|app[\s_]?secret|key|XUNHUPAY_APPSECRET)\s*[:：=]\s*(.+)$", ln, re.IGNORECASE)
        if m:
            secret = m.group(2).strip().strip('"').strip("'").strip("`")
    if not appid or not secret:
        sys.exit(f"FAIL: cannot parse appid/secret from {p}")
    return appid, secret


def vapi(method: str, path: str, token: str, body=None, retries=4):
    url = f"https://api.vercel.com{path}"
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}teamId={TEAM_ID}"
    data = json.dumps(body).encode() if body else None
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(
                url, data=data, method=method,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "User-Agent": "lampstage/1.0",
                },
            )
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read())
            except Exception:
                return e.code, {"error": "non-json"}
        except (urllib.error.URLError, OSError) as e:
            last = e
            time.sleep(2 ** a)
    raise RuntimeError(f"vercel api failed: {last}")


def upsert_env(token: str, key: str, value: str):
    s, ex = vapi("GET", f"/v9/projects/{PROJECT_ID}/env?decrypt=false", token)
    existing = {e["key"]: e["id"] for e in (ex.get("envs", []) if s == 200 else [])}
    targets = ["production", "preview"]
    if key in existing:
        s, d = vapi(
            "PATCH", f"/v10/projects/{PROJECT_ID}/env/{existing[key]}",
            token, body={"value": value, "target": targets},
        )
        print(f"  {key}: PATCH -> {s}")
    else:
        s, d = vapi(
            "POST", f"/v10/projects/{PROJECT_ID}/env", token,
            body={"key": key, "value": value, "type": "encrypted", "target": targets},
        )
        print(f"  {key}: POST -> {s}")
    if s not in (200, 201):
        print(f"     ❌ failed: {d}")
        return False
    return True


def main():
    token = read_token()
    appid, secret = read_xunhupay()
    print(f"appid len={len(appid)} prefix={appid[:4]}…")
    print(f"secret len={len(secret)} prefix={secret[:4]}…")

    print("\n[push to Vercel lampstage project]")
    ok1 = upsert_env(token, "XUNHUPAY_APPID", appid)
    ok2 = upsert_env(token, "XUNHUPAY_APPSECRET", secret)

    if not (ok1 and ok2):
        sys.exit("env push failed")
    print("\n✅ env vars pushed. Now triggering production deployment from local code.")

    # 触发本地代码部署
    e = os.environ.copy()
    e["VERCEL_TOKEN"] = token
    cmd = ["npx", "vercel", "--prod", "--yes", "--token", token, "--scope", "shawn-sd-projects1"]
    r = subprocess.run(cmd, cwd=str(ROOT), env=e, shell=True, capture_output=True, text=True, timeout=600)
    out = (r.stdout or "") + "\n" + (r.stderr or "")
    print(out[-2500:])


if __name__ == "__main__":
    main()
