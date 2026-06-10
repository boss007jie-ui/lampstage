"""Run prisma migrate dev with proper DATABASE_URL/DIRECT_URL from .supabase_url.md."""
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps" / "web"
HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")


def clean(text: str) -> str:
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


def url_encode_pw(url: str) -> str:
    m = re.match(
        r"^(?P<scheme>postgresql|postgres)://"
        r"(?P<user>[^:]+):"
        r"(?P<pw>[^@]+)@"
        r"(?P<rest>.+)$",
        url, re.IGNORECASE,
    )
    if not m:
        return url
    g = m.groupdict()
    return f"{g['scheme']}://{g['user']}:{quote(g['pw'], safe='')}@{g['rest']}"


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "migration"

    raw = clean((HERMES / ".supabase_url.md").read_text(encoding="utf-8"))
    runtime = url_encode_pw(raw)
    migrate = re.sub(r":6543/", ":5432/", runtime)
    migrate = re.sub(r"[?&]pgbouncer=true\b", "", migrate)

    e = os.environ.copy()
    e["DATABASE_URL"] = migrate
    e["DIRECT_URL"] = migrate

    print(f"[migrate] running prisma migrate dev --name {name}")
    r = subprocess.run(
        ["npx", "prisma", "migrate", "dev", "--name", name, "--skip-seed"],
        cwd=WEB, env=e, shell=True, capture_output=True, text=True, timeout=180,
    )
    print(r.stdout[-3000:])
    if r.stderr:
        print("STDERR:", r.stderr[-1500:])
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
