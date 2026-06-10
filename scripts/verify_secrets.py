"""Verify both Supabase URL and Cloudflare token.

Robust to common copy/paste artifacts: BOM, surrounding quotes, trailing
whitespace/newlines, leading 'Bearer ', etc.
"""
import json
import re
import socket
import sys
import urllib.error
import urllib.request
from pathlib import Path


def clean(text: str) -> str:
    text = text.replace("\ufeff", "")  # strip BOM
    # markdown-escaped underscores: DATABASE\_URL -> DATABASE_URL
    text = text.replace("\\_", "_")
    # remove markdown code fence lines
    text = re.sub(r"^```.*$", "", text, flags=re.MULTILINE)
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        # support `DATABASE_URL="postgres://..."` shape
        m = re.match(r"^[A-Z_]+\s*=\s*(.+)$", ln)
        if m:
            ln = m.group(1).strip()
        ln = ln.strip('"').strip("'").strip("`")
        ln = re.sub(r"^Bearer\s+", "", ln, flags=re.IGNORECASE)
        return ln
    return ""


def verify_supabase():
    print("=" * 60)
    print("[1] Supabase connection string")
    print("=" * 60)
    p = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.supabase_url.md")
    if not p.exists():
        print("FAIL: file missing")
        return False
    line = clean(p.read_text(encoding="utf-8"))
    print(f"line length: {len(line)}")

    if not line.lower().startswith(("postgresql://", "postgres://")):
        print(f"FAIL: not a postgres URL. head: {line[:50]!r}")
        return False

    pat = re.compile(
        r"^(?P<scheme>postgresql|postgres)://"
        r"(?P<user>[^:@]+):"
        r"(?P<pw>[^@]+)@"
        r"(?P<host>[^:/]+):"
        r"(?P<port>\d+)/"
        r"(?P<db>[^?]+)"
        r"(?P<qs>\?.*)?$",
        re.IGNORECASE,
    )
    m = pat.match(line)
    if not m:
        print(f"FAIL: cannot parse. head: {line[:50]!r}")
        return False

    g = m.groupdict()
    pw = g["pw"]
    print(f"  user: {g['user']}")
    print(f"  pw:   <{len(pw)} chars>")
    print(f"  host: {g['host']}")
    print(f"  port: {g['port']}")
    print(f"  db:   {g['db']}")
    print(f"  qs:   {g['qs'] or '<none>'}")

    if "YOUR-PASSWORD" in pw.upper() or "[YOUR" in pw.upper():
        print("FAIL: password placeholder not replaced")
        return False

    try:
        ip = socket.gethostbyname(g["host"])
        print(f"  DNS: {g['host']} -> {ip}")
    except Exception as e:
        print(f"FAIL DNS: {e}")
        return False

    try:
        s = socket.create_connection((g["host"], int(g["port"])), timeout=10)
        s.close()
        print(f"  TCP: {g['host']}:{g['port']} reachable  ✓")
    except Exception as e:
        print(f"FAIL TCP: {e}")
        return False

    print(f"\n  ✅ Supabase OK  (port {g['port']} {'pooler' if g['port']=='6543' else 'direct'})")
    return True


def verify_cloudflare():
    print()
    print("=" * 60)
    print("[2] Cloudflare API token")
    print("=" * 60)
    p = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.cloudflare_token.md")
    if not p.exists():
        print("FAIL: file missing")
        return False
    token = clean(p.read_text(encoding="utf-8"))
    print(f"token length: {len(token)}")
    # show shape: alnum / hex / has dashes? — never print value
    n_alnum = sum(c.isalnum() for c in token)
    n_dash_underscore = sum(c in "-_" for c in token)
    print(f"  alnum chars: {n_alnum}, dash/underscore: {n_dash_underscore}")
    print(f"  expected for API Token: 40 alnum chars")

    def call(path):
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4{path}",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())

    try:
        v = call("/user/tokens/verify")
        print(f"  verify.success: {v.get('success')}")
        print(f"  verify.status:  {(v.get('result') or {}).get('status')}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:400]
        print(f"  verify HTTP {e.code}: {body}")
        return False

    try:
        z = call("/zones")
        zones = z.get("result", []) or []
        print(f"\n  zones available: {len(zones)}")
        for zone in zones:
            print(f"    - {zone.get('name')}  status={zone.get('status')}  id={zone.get('id', '')[:8]}…")
        match = [zone for zone in zones if zone.get("name") == "lampstage.com"]
        if match:
            z0 = match[0]
            print(f"\n  ✅ lampstage.com reachable")
            print(f"     status: {z0.get('status')}")
            print(f"     ns:     {z0.get('name_servers')}")
            return True
        else:
            print(f"\n  ⚠️  lampstage.com not in this token's zones.")
            return False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        print(f"  zones HTTP {e.code}: {body}")
        return False


supabase_ok = verify_supabase()
cf_ok = verify_cloudflare()

print()
print("=" * 60)
print(f"Supabase   : {'OK' if supabase_ok else 'NEEDS FIX'}")
print(f"Cloudflare : {'OK' if cf_ok else 'NEEDS FIX'}")
sys.exit(0 if (supabase_ok and cf_ok) else 1)
