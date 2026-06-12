"""验证生产 admin API 鉴权 + 页面可达。"""
import urllib.request, urllib.error

def check(path, method="GET"):
    try:
        req = urllib.request.Request(f"https://lampstage.vercel.app{path}",
            headers={"User-Agent":"verify/1.0"}, method=method)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()[:120].decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:120].decode(errors="replace")
    except Exception as e:
        return None, str(e)[:80]

for p in ["/admin", "/api/admin/overview", "/api/admin/users", "/workspace", "/"]:
    s, body = check(p)
    print(f"{s}  {p}  {body[:70]}")
