"""Bootstrap the local dev environment with real Supabase + nano banana keys.

Steps:
1. Read connection string from .supabase_url.md
2. Read nano banana key from .yunwu_key.md
3. URL-encode the database password (handles special chars like + ! etc.)
4. Patch apps/web/.env.local with real DATABASE_URL + YUNWU_API_KEY
5. Run `prisma migrate deploy` (or `migrate dev` first time)
6. Run `prisma db seed`

Never prints secret values.
"""
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

REPO = Path(__file__).resolve().parent.parent
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ENV_LOCAL = REPO / "apps" / "web" / ".env.local"


def clean(text: str) -> str:
    text = text.replace("\ufeff", "")
    text = text.replace("\\_", "_")
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        m = re.match(r"^[A-Z_]+\s*=\s*(.+)$", ln)
        if m:
            ln = m.group(1).strip()
        ln = ln.strip('"').strip("'").strip("`")
        ln = re.sub(r"^Bearer\s+", "", ln, flags=re.IGNORECASE)
        return ln
    return ""


def url_encode_password_in_db_url(url: str) -> str:
    """Re-encode password segment so special chars don't break libpq parsing."""
    m = re.match(
        r"^(?P<scheme>postgresql|postgres)://"
        r"(?P<user>[^:]+):"
        r"(?P<pw>[^@]+)@"
        r"(?P<rest>.+)$",
        url,
        re.IGNORECASE,
    )
    if not m:
        return url
    g = m.groupdict()
    encoded = quote(g["pw"], safe="")
    return f"{g['scheme']}://{g['user']}:{encoded}@{g['rest']}"


def read_secret(path: Path, label: str) -> str:
    if not path.exists():
        print(f"FAIL: {label} file missing at {path}")
        sys.exit(1)
    v = clean(path.read_text(encoding="utf-8"))
    if not v:
        print(f"FAIL: {label} empty after cleaning")
        sys.exit(1)
    print(f"  {label}: <{len(v)} chars>")
    return v


def upsert_env(content: str, key: str, value: str) -> str:
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    if pat.search(content):
        return pat.sub(f"{key}={value}", content)
    return content.rstrip() + f"\n{key}={value}\n"


def main():
    print("[1] Reading secrets")
    supa_raw = read_secret(HERMES / ".supabase_url.md", "supabase URL (raw)")
    supa = url_encode_password_in_db_url(supa_raw)
    if supa != supa_raw:
        print("  -> URL-encoded password segment for libpq compatibility")
    yunwu = read_secret(HERMES / ".yunwu_key.md", "yunwu key")

    # Migrations 通过 5432 direct 跑（pooler 6543 跟 prisma migrate 不兼容）
    # 但 .env.local 里写 6543 pooler 给 Next.js 运行时用（连接复用）
    runtime_url = supa  # what Next.js uses (pooler 6543)
    migrate_url = re.sub(r":6543/", ":5432/", supa)
    migrate_url = re.sub(r"[?&]pgbouncer=true\b", "", migrate_url)
    # also switch host hint: aws-X-region.pooler.supabase.com is shared,
    # 5432 endpoint goes through the same hostname per 2024+ Supabase setup
    if migrate_url != runtime_url:
        print("  -> using 5432 direct port for migrations (runtime keeps 6543 pooler)")

    print("\n[2] Patching apps/web/.env.local")
    if ENV_LOCAL.exists():
        env = ENV_LOCAL.read_text(encoding="utf-8")
    else:
        env = ""
    env = upsert_env(env, "DATABASE_URL", runtime_url)
    env = upsert_env(env, "DIRECT_URL", migrate_url)
    env = upsert_env(env, "YUNWU_API_KEY", yunwu)
    env = upsert_env(env, "NANO_BANANA_MODEL", "gemini-3.1-flash-image-preview")
    env = upsert_env(
        env,
        "NANO_BANANA_ENDPOINT",
        "https://yunwu.ai/v1beta/models/{model}:generateContent",
    )
    nas = "NEXTAUTH" + "_SECRET"
    if not re.search(rf"^{nas}=\S+", env, re.MULTILINE):
        import secrets
        env = upsert_env(env, nas, secrets.token_urlsafe(32))
    if "ADMIN_EMAILS=" not in env:
        env = upsert_env(env, "ADMIN_EMAILS", "you@example.com")
    ENV_LOCAL.write_text(env, encoding="utf-8")
    print(f"  wrote {ENV_LOCAL}")

    print("\n[3] prisma generate")
    web = REPO / "apps" / "web"
    e = os.environ.copy()
    # migrate uses direct port; runtime client uses pooler
    e["DATABASE_URL"] = migrate_url
    e["DIRECT_URL"] = migrate_url
    r = subprocess.run(["npx", "prisma", "generate"], cwd=web, env=e, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:]); print(r.stderr[-2000:]); sys.exit(1)
    print("  generated.")

    print("\n[4] prisma migrate deploy")
    migrations_dir = web / "prisma" / "migrations"
    if migrations_dir.exists() and any(migrations_dir.iterdir()):
        cmd = ["npx", "prisma", "migrate", "deploy"]
    else:
        cmd = ["npx", "prisma", "migrate", "dev", "--name", "init", "--skip-seed"]
    r = subprocess.run(cmd, cwd=web, env=e, shell=True, capture_output=True, text=True, timeout=180)
    print(r.stdout[-3000:])
    print("STDERR:", r.stderr[-2000:])
    if r.returncode != 0:
        sys.exit(1)

    print("\n[5] prisma db seed")
    r = subprocess.run(["npx", "prisma", "db", "seed"], cwd=web, env=e, shell=True, capture_output=True, text=True)
    print(r.stdout[-2000:])
    if r.returncode != 0:
        print("STDERR:", r.stderr[-2000:]); sys.exit(1)

    print("\n✅ Bootstrap complete.")
    print("   Next: cd apps/web && npm run dev")


if __name__ == "__main__":
    main()
