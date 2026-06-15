"""试发 Resend 邮件到 qq，带重试，定位 email_send_failed。"""
import json, re, time, urllib.request, urllib.error
from pathlib import Path

text = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.resend_key.md").read_text(encoding='utf-8').replace('\ufeff','').replace('\\_','_')
tok=None
for ln in text.splitlines():
    ln=ln.strip()
    if not ln or ln.startswith('#'): continue
    m=re.match(r'^[A-Z_0-9]+\s*=\s*(.+)$', ln)
    if m: tok=m.group(1).strip().strip('"').strip("'").strip('`'); break
    if re.match(r'^re_[A-Za-z0-9_-]+$', ln): tok=ln; break

body = json.dumps({
    "from": "Lampstage <send@lampstage.com>",
    "to": ["519140027@qq.com"],
    "subject": "Lampstage 验证码测试",
    "html": "<p>test 123456</p>",
}).encode()

for attempt in range(5):
    try:
        req = urllib.request.Request('https://api.resend.com/emails', data=body,
            headers={'Authorization': f'Bearer {tok}', 'Content-Type':'application/json', 'User-Agent':'lampstage/1.0'},
            method='POST')
        with urllib.request.urlopen(req, timeout=40) as r:
            print(f"✅ OK {r.status}: {r.read().decode()[:300]}")
            break
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP {e.code}: {e.read().decode()[:500]}")
        break
    except Exception as e:
        print(f"  尝试{attempt+1} 网络错: {type(e).__name__}, 重试…")
        time.sleep(3)
