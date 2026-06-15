"""调 lampstage.com 的 debug/email endpoint，看 Resend 真实错误 + 环境变量状态。"""
import json, time, urllib.request, urllib.error

for attempt in range(4):
    try:
        req = urllib.request.Request(
            'https://lampstage.com/api/debug/email',
            data=json.dumps({"to": "verify-debug@qq.com"}).encode(),
            headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
            method='POST')
        with urllib.request.urlopen(req, timeout=40) as r:
            print(json.dumps(json.loads(r.read()), ensure_ascii=False, indent=2))
            break
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}:")
        try: print(json.dumps(json.loads(e.read()), ensure_ascii=False, indent=2))
        except: print(e.read().decode()[:400])
        break
    except Exception as e:
        print(f"  尝试{attempt+1}: {type(e).__name__}, 重试…")
        time.sleep(3)
