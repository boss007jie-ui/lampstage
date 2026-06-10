"""End-to-end test: sign in -> upload lamp -> generate -> poll until done -> verify outputs."""
import json
import sys
import time
import urllib.request
from pathlib import Path
from http.cookiejar import CookieJar
from urllib.parse import urlencode

BASE = "http://localhost:3000"
WEB = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp\apps\web")
TEST_IMG = WEB / "public" / "showcase" / "01_living_pendant.jpg"

cj = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post_json(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def get_json(path):
    req = urllib.request.Request(BASE + path)
    with opener.open(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def post_multipart(path, file_path: Path, file_field="file"):
    boundary = "----LampstageBoundary" + str(int(time.time() * 1000))
    body_parts = []
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"'.encode()
    )
    body_parts.append(b"Content-Type: image/jpeg")
    body_parts.append(b"")
    body_parts.append(file_path.read_bytes())
    body_parts.append(f"--{boundary}--".encode())
    body_parts.append(b"")
    body = b"\r\n".join(body_parts)
    req = urllib.request.Request(
        BASE + path,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with opener.open(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def main():
    print("=== E2E test: full lampstage generation flow ===\n")

    test_email = f"e2e-{int(time.time())}@lampstage.com"

    # 1) send code
    print("[1] /api/auth/send-code")
    s, d = post_json("/api/auth/send-code", {"identifier": test_email})
    code = d.get("devCode")
    print(f"   status={s} code={code}")

    # 2) verify
    print("[2] /api/auth/verify-code")
    s, d = post_json(
        "/api/auth/verify-code", {"identifier": test_email, "code": code}
    )
    print(f"   status={s} user_id={d.get('user_id')} balance={d.get('credit_balance')}")

    # 3) /api/me check
    print("[3] /api/me")
    s, d = get_json("/api/me")
    print(f"   status={s} email={d.get('email')} balance={d.get('credit_balance')}")
    starting_balance = d["credit_balance"]

    # 4) upload
    print(f"[4] /api/uploads (file={TEST_IMG.name}, {TEST_IMG.stat().st_size // 1024}KB)")
    s, d = post_multipart("/api/uploads", TEST_IMG)
    asset_id = d.get("id")
    print(
        f"   status={s} asset={asset_id} bg={d.get('background_type')} "
        f"size={d.get('width')}x{d.get('height')} warning={d.get('quality_warning')}"
    )

    # 5) templates list (pick first)
    print("[5] /api/templates")
    s, d = get_json("/api/templates")
    tpls = d.get("templates", [])
    print(f"   status={s} got {len(tpls)} templates")
    tpl = next((t for t in tpls if t["lamp_type"] == "吊灯"), tpls[0])
    print(f"   chosen: {tpl['id']} ({tpl['name']})")

    # 6) precheck
    print("[6] /api/generation/precheck")
    s, d = post_json(
        "/api/generation/precheck",
        {"uploaded_asset_id": asset_id, "template_id": tpl["id"]},
    )
    print(
        f"   status={s} match={d.get('match')} detected={d.get('detected')} "
        f"template={d.get('template_lamp_type')}"
    )

    # 7) submit job
    print("[7] /api/generation/jobs")
    s, d = post_json(
        "/api/generation/jobs",
        {
            "uploaded_asset_id": asset_id,
            "template_id": tpl["id"],
            "platform_style": "domestic_ecommerce",
            "aspect_ratio": "4_5",
        },
    )
    if s != 200:
        print(f"   FAIL status={s} body={d}")
        sys.exit(1)
    job_id = d["job_id"]
    print(f"   status={s} job={job_id} balance_after_charge={d['credit_balance']}")

    # 8) poll until completed/failed
    print("[8] poll /api/generation/jobs/[id]")
    t0 = time.time()
    last_stage = None
    while True:
        elapsed = time.time() - t0
        if elapsed > 240:
            print("   TIMEOUT after 240s")
            sys.exit(1)
        s, d = get_json(f"/api/generation/jobs/{job_id}")
        status = d.get("status")
        stage = d.get("stage_hint")
        if stage != last_stage:
            print(f"   t+{elapsed:5.1f}s  status={status:10s} stage={stage}")
            last_stage = stage
        if status == "completed":
            outs = d.get("outputs", [])
            print(f"\n   ✅ COMPLETED in {elapsed:.1f}s")
            print(f"   {len(outs)} output images:")
            for i, o in enumerate(outs, 1):
                print(f"     {i}. {o['image_url']}")
            break
        if status == "failed":
            print(f"\n   ❌ FAILED: {d.get('failure_reason')}")
            sys.exit(1)
        time.sleep(2)

    # 9) check balance after
    s, d = get_json("/api/me")
    print(f"\n[9] post-gen balance: {d['credit_balance']} (was {starting_balance})")
    spent = starting_balance - d["credit_balance"]
    print(f"   spent: {spent} credits  (expected 4)")

    print("\n🎉 ALL OK")


if __name__ == "__main__":
    main()
