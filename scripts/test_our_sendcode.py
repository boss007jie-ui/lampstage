"""测 lampstage.com 自己的 send-code API。"""
import json, time, urllib.request, urllib.error

email = f"verify-{int(time.time())}@qq.com"
for attempt in range(4):
    try:
        req = urllib.request.Request(
            'https://lampstage.com/api/auth/send-code',
            data=json.dumps({"identifier": email}).encode(),
            headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
            method='POST')
        with urllib.request.urlopen(req, timeout=40) as r:
            print(f"lampstage.com send-code: HTTP {r.status}: {r.read().decode()[:200]}")
            break
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:200]}")
        break
    except Exception as e:
        print(f"  尝试{attempt+1}: {type(e).__name__}, 重试…")
        time.sleep(3)
