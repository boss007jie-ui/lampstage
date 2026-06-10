"""Verify Cloudflare API token: list zones we can access."""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

P = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.cloudflare_token.md")
if not P.exists():
    print("FAIL: cloudflare token file missing")
    sys.exit(1)

token = P.read_text(encoding="utf-8").strip().splitlines()[0].strip()
token = token.strip('"').strip("'")
print(f"token length: {len(token)}")

def call(path):
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

# 1. Verify the token itself
try:
    v = call("/user/tokens/verify")
    print(f"\nverify: {v.get('success')}")
    if v.get("result"):
        print(f"  status: {v['result'].get('status')}")
except urllib.error.HTTPError as e:
    print(f"verify FAIL: {e.code} {e.read().decode()[:200]}")
    sys.exit(1)

# 2. List zones
try:
    z = call("/zones")
    zones = z.get("result", []) or []
    print(f"\nzones available to this token: {len(zones)}")
    for zone in zones:
        print(f"  - {zone.get('name')}  status={zone.get('status')}  id={zone.get('id')[:8]}…")

    # specifically look for lampstage.com
    found = [zone for zone in zones if zone.get("name") == "lampstage.com"]
    if found:
        z0 = found[0]
        print(f"\n✅ lampstage.com is reachable")
        print(f"   nameservers: {z0.get('name_servers')}")
        print(f"   status: {z0.get('status')}")
    else:
        print("\n⚠️  lampstage.com not in token-accessible zones")
        print("   if Cloudflare is your registrar, the zone exists automatically;")
        print("   token may be scoped too narrowly. Try a token with All zones (Read).")
except urllib.error.HTTPError as e:
    print(f"zones FAIL: {e.code} {e.read().decode()[:200]}")
