"""
Auto-provision Cloudflare R2:
1. Verify R2 enabled (list buckets)
2. Create bucket 'lampstage-uploads' if missing
3. Create R2 API token (S3-compatible) scoped to that bucket only
4. Optionally: configure public dev URL OR custom domain (uploads.lampstage.com)
5. Save all secrets to apps/web/.env.local
6. Print summary

Secrets layout written to .env.local:
  R2_ACCOUNT_ID=xxx
  R2_BUCKET=lampstage-uploads
  R2_ACCESS_KEY_ID=xxx
  R2_SECRET_ACCESS_KEY=xxx
  R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
  R2_PUBLIC_BASE=<set after we configure public URL>
"""
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ENV_FILE = REPO / "apps" / "web" / ".env.local"

BUCKET = "lampstage-uploads"
TOKEN_NAME = "lampstage-app"


def clean(text):
    text = text.replace("\ufeff", "").replace("\\_", "_")
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^[A-Z_]+\s*=\s*(.+)$", ln)
        if m:
            ln = m.group(1).strip()
        return ln.strip('"').strip("'").strip("`")
    return ""


KEY = clean((HERMES / ".cloudflare_token.md").read_text(encoding="utf-8"))


def cf(method, path, body=None):
    url = f"https://api.cloudflare.com/client/v4{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def upsert_env(content, key, value):
    pattern = rf"(?m)^{re.escape(key)}\s*=.*$"
    line = f'{key}="{value}"'
    if re.search(pattern, content):
        return re.sub(pattern, line, content)
    if content and not content.endswith("\n"):
        content += "\n"
    return content + line + "\n"


def main():
    # 1) find account_id
    print("[1] find account id")
    s, d = cf("GET", "/zones")
    account_id = None
    for z in d.get("result", []):
        if z["name"] == "lampstage.com":
            account_id = z["account"]["id"]
            break
    if not account_id:
        print("[fatal] no lampstage.com zone in this token's scope")
        sys.exit(1)
    print(f"   account_id={account_id[:8]}...")

    # 2) ensure bucket
    print(f"\n[2] ensure bucket '{BUCKET}'")
    s, d = cf("GET", f"/accounts/{account_id}/r2/buckets")
    if not d.get("success"):
        print(f"   list buckets failed: {d}")
        sys.exit(1)
    existing = [b["name"] for b in d.get("result", {}).get("buckets", [])]
    if BUCKET in existing:
        print(f"   ✅ exists already")
    else:
        s, d = cf(
            "POST",
            f"/accounts/{account_id}/r2/buckets",
            body={"name": BUCKET, "locationHint": "apac"},
        )
        if not d.get("success"):
            print(f"   create failed: {d}")
            sys.exit(1)
        print(f"   ✅ created (apac region)")

    # 3) configure public dev URL (managed.r2.dev) so images can be served back
    print(f"\n[3] enable managed dev URL on {BUCKET}")
    s, d = cf(
        "PUT",
        f"/accounts/{account_id}/r2/buckets/{BUCKET}/domains/managed",
        body={"enabled": True},
    )
    if d.get("success"):
        public_base = d["result"].get("domain")
        if public_base and not public_base.startswith("http"):
            public_base = f"https://{public_base}"
        print(f"   ✅ public base: {public_base}")
    else:
        # If managed-domain endpoint differs, try the legacy way
        print(f"   note: managed domain API returned: {d.get('errors')}")
        public_base = ""

    # 4) create API token (S3-compatible) scoped to this bucket only
    print(f"\n[4] create R2 API token '{TOKEN_NAME}'")
    s, d = cf(
        "POST",
        f"/accounts/{account_id}/r2/tokens",
        body={
            "name": TOKEN_NAME,
            "policies": [
                {
                    "effect": "allow",
                    "permission": "object_read_and_write",
                    "buckets": [BUCKET],
                }
            ],
        },
    )
    if not d.get("success"):
        # Try alternate API shape (older / newer endpoint)
        print(f"   primary endpoint failed: {d.get('errors')}")
        print(f"   trying alternate /r2/api-tokens shape")
        s, d = cf(
            "POST",
            f"/accounts/{account_id}/r2/api-tokens",
            body={
                "name": TOKEN_NAME,
                "policies": [
                    {
                        "effect": "allow",
                        "permission": "object_read_and_write",
                        "buckets": [BUCKET],
                    }
                ],
            },
        )
    if not d.get("success"):
        print(f"   ❌ token creation failed via API: {d}")
        print()
        print("   FALLBACK: Please create R2 API token manually:")
        print("   1. https://dash.cloudflare.com → R2 → Manage R2 API Tokens")
        print("   2. Create API Token → 'Object Read & Write' → bucket 'lampstage-uploads'")
        print("   3. Save Access Key ID + Secret Access Key into:")
        print(f"      {HERMES}\\.r2_keys.md")
        print("   4. Format: R2_ACCESS_KEY_ID=xxx<newline>R2_SECRET_ACCESS_KEY=xxx")
        sys.exit(2)

    token = d["result"]
    access_key_id = token.get("accessKeyId") or token.get("access_key_id")
    secret_access_key = token.get("secretAccessKey") or token.get("secret_access_key")
    print(f"   ✅ token created. access_key_id={access_key_id[:8]}... len_secret={len(secret_access_key)}")

    # 5) write to .env.local
    print(f"\n[5] write secrets to {ENV_FILE.relative_to(REPO)}")
    env = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.exists() else ""
    env = upsert_env(env, "R2_ACCOUNT_ID", account_id)
    env = upsert_env(env, "R2_BUCKET", BUCKET)
    env = upsert_env(env, "R2_ACCESS_KEY_ID", access_key_id)
    env = upsert_env(env, "R2_SECRET_ACCESS_KEY", secret_access_key)
    env = upsert_env(
        env,
        "R2_ENDPOINT",
        f"https://{account_id}.r2.cloudflarestorage.com",
    )
    if public_base:
        env = upsert_env(env, "R2_PUBLIC_BASE", public_base)
    ENV_FILE.write_text(env, encoding="utf-8")
    print(f"   ✅ env written. line count: {len(env.splitlines())}")

    print("\n🎉 R2 ready. Bucket=lampstage-uploads, public_base=" + (public_base or "(not yet)"))


if __name__ == "__main__":
    main()
