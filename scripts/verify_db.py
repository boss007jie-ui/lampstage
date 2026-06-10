"""Verify the Supabase connection string: length / parse / TCP reachability."""
from pathlib import Path
import re
import socket
import sys

P = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.supabase_url.md")
if not P.exists():
    print("FAIL: file missing")
    sys.exit(1)

raw = P.read_text(encoding="utf-8").strip()
line = ""
for ln in raw.splitlines():
    ln = ln.strip()
    if ln and not ln.startswith("#"):
        line = ln
        break

print(f"file size: {P.stat().st_size} bytes")
print(f"line length: {len(line)}")

scheme_ok = line.split("://", 1)[0].lower() in ("postgresql", "postgres")
if not scheme_ok:
    print(f"FAIL: not a postgres URL. masked head: {line[:40]!r}")
    sys.exit(1)

# scheme://user:password@host:port/db?qs
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
    print(f"FAIL: cannot parse. masked head: {line[:40]!r}")
    sys.exit(1)

g = m.groupdict()
pw = g["pw"]
print(f"scheme: {g['scheme']}")
print(f"user:   {g['user']}")
print(f"pw:     <{len(pw)} chars>")
print(f"host:   {g['host']}")
print(f"port:   {g['port']}")
print(f"db:     {g['db']}")
print(f"qs:     {g['qs'] or '<none>'}")

if "YOUR-PASSWORD" in pw.upper() or "YOUR_PASSWORD" in pw.upper():
    print("\nFAIL: password placeholder not replaced.")
    sys.exit(1)

try:
    ip = socket.gethostbyname(g["host"])
    print(f"\nDNS: {g['host']} -> {ip}")
except Exception as e:
    print(f"\nDNS FAIL: {e}")
    sys.exit(1)

try:
    s = socket.create_connection((g["host"], int(g["port"])), timeout=10)
    s.close()
    print(f"TCP {g['host']}:{g['port']}  OK")
except Exception as e:
    print(f"TCP FAIL: {e}")
    sys.exit(1)

if g["port"] == "6543":
    print("\nNote: this is the Transaction pooler (recommended for runtime).")
elif g["port"] == "5432":
    print("\nNote: this is a direct connection (5432). Fine for migrate; runtime prefers 6543.")
