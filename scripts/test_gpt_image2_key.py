"""测试 yunwu gpt-image-2 /v1/images/edits 是否可用。
从 .gpt_image_key.md 读取 key，不在日志打印完整 key。
使用现有一张本地灯具图作为 image，生成 1024x1536。
"""
from pathlib import Path
import re, json, urllib.request, urllib.error, uuid

HERMES = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes")
ROOT = HERMES / "lamp-saas-mvp"
key_text = (HERMES / ".gpt_image_key.md").read_text(encoding="utf-8").replace("\ufeff", "")
key = re.search(r"sk-[A-Za-z0-9]+", key_text).group(0)
img_path = ROOT / "apps" / "web" / "public" / "templates" / "tpl_dining_long_table_pendant.jpg"

boundary = "----lampstage" + uuid.uuid4().hex
parts = []

def add_field(name, value):
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())

def add_file(name, path):
    data = path.read_bytes()
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\nContent-Type: image/jpeg\r\n\r\n".encode()
        + data
        + b"\r\n"
    )

add_file("image", img_path)
add_field("prompt", "Use the uploaded lamp as reference. Create a realistic Nordic living room scene. Keep the lamp in realistic small scale, as a subtle ceiling pendant, not oversized.")
add_field("model", "gpt-image-2")
add_field("n", "1")
add_field("quality", "low")
add_field("size", "1024x1536")
body = b"".join(parts) + f"--{boundary}--\r\n".encode()

req = urllib.request.Request(
    "https://yunwu.ai/v1/images/edits",
    data=body,
    method="POST",
    headers={
        "Accept": "application/json",
        "Authorization": f"Bearer {key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    },
)
print(f"key len={len(key)} prefix={key[:6]} suffix={key[-4:]}")
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read().decode("utf-8", errors="replace")
        print("HTTP", r.status)
        print(raw[:1000])
except urllib.error.HTTPError as e:
    print("HTTP_ERROR", e.code)
    print(e.read().decode("utf-8", errors="replace")[:1500])
except Exception as e:
    print("ERROR", type(e).__name__, str(e))
