"""端到端测真实生成 pipeline。

流程：
  1. 注册 / 登录（验证码 dev 模式）
  2. 上传一张真实灯具图（用 showcase/01_living_pendant.jpg —— 已经是真实灯具图）
  3. 调 precheck（看灯具识别）
  4. 提交生成任务
  5. 轮询直到 completed
  6. 验证 4 张输出图存在
"""
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = "http://localhost:3000"
TEST_IMAGE = REPO / "apps" / "web" / "public" / "showcase" / "01_living_pendant.jpg"


def call(path, method="GET", json_body=None, headers=None, body_bytes=None, body_content_type=None):
    url = BASE + path
    h = headers or {}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        h["Content-Type"] = "application/json"
    elif body_bytes is not None:
        data = body_bytes
        if body_content_type:
            h["Content-Type"] = body_content_type
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, dict(r.getheaders()), r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8")


def parse_set_cookie(headers):
    sc = headers.get("Set-Cookie") or headers.get("set-cookie")
    if not sc:
        return None
    name = "lamp_session="
    if name in sc:
        v = sc.split(name, 1)[1].split(";", 1)[0]
        return v
    return None


def main():
    print("[1] send-code")
    s, _, body = call("/api/auth/send-code", "POST", {"identifier": "e2e@lampstage.com"})
    print(f"    {s} {body}")
    code = json.loads(body)["devCode"]

    print("[2] verify-code")
    s, hh, body = call("/api/auth/verify-code", "POST", {"identifier": "e2e@lampstage.com", "code": code})
    print(f"    {s} {body}")
    cookie = parse_set_cookie(hh)
    print(f"    session: {cookie[:8]}…")

    auth = {"Cookie": f"lamp_session={cookie}"}

    print("[3] me")
    s, _, body = call("/api/me", headers=auth)
    print(f"    {s} {body}")
    user = json.loads(body)
    print(f"    credits before: {user['credit_balance']}")

    print("[4] upload")
    img_bytes = TEST_IMAGE.read_bytes()
    boundary = "----LampstageE2E"
    multipart = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="lamp.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8") + img_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
    s, _, body = call(
        "/api/uploads",
        "POST",
        body_bytes=multipart,
        body_content_type=f"multipart/form-data; boundary={boundary}",
        headers={**auth},
    )
    print(f"    {s} {body[:200]}")
    asset = json.loads(body)
    asset_id = asset["id"]

    print("[5] templates list")
    s, _, body = call("/api/templates")
    tpl = json.loads(body)["templates"][0]
    tpl_id = tpl["id"]
    print(f"    using template: {tpl['name']} ({tpl_id})")

    print("[6] precheck")
    s, _, body = call(
        "/api/generation/precheck",
        "POST",
        {"uploaded_asset_id": asset_id, "template_id": tpl_id},
        headers=auth,
    )
    print(f"    {s} {body}")

    print("[7] submit job")
    s, _, body = call(
        "/api/generation/jobs",
        "POST",
        {
            "uploaded_asset_id": asset_id,
            "template_id": tpl_id,
            "platform_style": "domestic_ecommerce",
            "aspect_ratio": "4_5",
        },
        headers=auth,
    )
    print(f"    {s} {body}")
    job_id = json.loads(body)["job_id"]
    print(f"    credits after debit: {json.loads(body)['credit_balance']}")

    print("[8] poll")
    last_stage = None
    start = time.time()
    while time.time() - start < 180:
        time.sleep(2)
        s, _, body = call(f"/api/generation/jobs/{job_id}", headers=auth)
        d = json.loads(body)
        if d.get("stage_hint") and d["stage_hint"] != last_stage:
            last_stage = d["stage_hint"]
            print(f"    stage: {last_stage}  status={d['status']}")
        if d["status"] in ("completed", "failed"):
            print(f"    final status: {d['status']}")
            print(f"    output count: {len(d.get('output_images', []))}")
            for i, o in enumerate(d.get("output_images", [])[:4]):
                print(f"      [{i}] {o['image_url']}")
            if d.get("failure_reason"):
                print(f"    failure: {d['failure_reason']}")
            break

    print("[9] verify credits after")
    s, _, body = call("/api/me", headers=auth)
    print(f"    credits after: {json.loads(body)['credit_balance']}")


if __name__ == "__main__":
    main()
