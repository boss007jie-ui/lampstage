"""规范化虎皮椒 key 文件 → 标准 KEY=VAL 格式（方便代码读取，不影响人类可读）。"""
import re
from pathlib import Path

p = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\.xunhupay.md")
raw = p.read_text(encoding='utf-8').replace('\ufeff','')

appid = None
secret = None

for ln in raw.splitlines():
    ln = ln.strip()
    if not ln or ln.startswith('#'):
        continue
    # 兼容 "Appid:xxx" / "Appid：xxx" / "APPID=xxx" 等
    m = re.match(r'^(appid|app[\s_]?id)\s*[:：=]\s*(.+)$', ln, re.IGNORECASE)
    if m:
        appid = m.group(2).strip().strip('"').strip("'").strip('`')
        continue
    m = re.match(r'^(密钥|secret|app[\s_]?secret|key)\s*[:：=]\s*(.+)$', ln, re.IGNORECASE)
    if m:
        secret = m.group(2).strip().strip('"').strip("'").strip('`')

print(f"appid: 长度={len(appid) if appid else 0}, 首4={appid[:4] if appid else '-'}")
print(f"secret: 长度={len(secret) if secret else 0}, 首4={secret[:4] if secret else '-'}")

if appid and secret:
    new_content = f"""# 虎皮椒支付 V2 凭据
# 后台: https://www.xunhupay.com/
# 网关: https://api.xunhupay.com/payment/do.html

XUNHUPAY_APPID={appid}
XUNHUPAY_APPSECRET={secret}
"""
    p.write_text(new_content, encoding='utf-8')
    print("✅ 已规范化 .xunhupay.md（保留原 key，仅改成 KEY=VAL 格式）")
