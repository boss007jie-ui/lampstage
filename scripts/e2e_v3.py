"""E2E v3: 三路场景方案各跑一次。"""
import json
import sys
import time
import urllib.request
import urllib.error
from http.cookiejar import CookieJar
from pathlib import Path

BASE = "http://localhost:3000"
WEB = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp\apps\web")
TEST_IMG = WEB / "public" / "showcase" / "01_living_pendant.jpg"

cj = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post(path, payload):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def get(path):
    req = urllib.request.Request(BASE + path)
    with opener.open(req, timeout=30) as r:
        return r.status, json.loads(r.read())


def upload_file(file_path: Path):
    boundary = "----LampstageBoundary" + str(int(time.time() * 1000))
    body_parts = []
    body_parts.append(f"--{boundary}".encode())
    body_parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"'.encode()
    )
    body_parts.append(b"Content-Type: image/jpeg")
    body_parts.append(b"")
    body_parts.append(file_path.read_bytes())
    body_parts.append(f"--{boundary}--".encode())
    body_parts.append(b"")
    body = b"\r\n".join(body_parts)
    req = urllib.request.Request(
        BASE + "/api/uploads",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with opener.open(req, timeout=120) as r:
        return r.status, json.loads(r.read())


def poll_job(job_id, timeout=240):
    t0 = time.time()
    last_stage = None
    while True:
        if time.time() - t0 > timeout:
            return None
        s, d = get(f"/api/generation/jobs/{job_id}")
        if d.get("stage_hint") != last_stage:
            print(f"      t+{time.time()-t0:5.1f}s  status={d.get('status'):10s} stage={d.get('stage_hint')}")
            last_stage = d.get("stage_hint")
        if d.get("status") in ("completed", "failed"):
            return d
        time.sleep(2)


def main():
    test_email = f"e2ev3-{int(time.time())}@lampstage.com"

    print("[1] sign in")
    s, d = post("/api/auth/send-code", {"identifier": test_email})
    code = d["devCode"]
    s, d = post("/api/auth/verify-code", {"identifier": test_email, "code": code})
    print(f"   user={d['user_id']} balance={d['credit_balance']}")

    print(f"\n[2] upload {TEST_IMG.name}")
    s, d = upload_file(TEST_IMG)
    asset_id = d["id"]
    print(f"   asset={asset_id}")

    # === Path A: smart suggest ===
    print("\n[A1] /api/generation/suggest (gpt-5-mini)")
    t0 = time.time()
    s, d = post("/api/generation/suggest", {"uploaded_asset_id": asset_id})
    print(f"   status={s} in {time.time()-t0:.1f}s, got {len(d['scenes'])} scenes")
    for sc in d["scenes"]:
        print(f"      - {sc['title']}: {sc['pitch']}  | tags: {sc['best_for']}")
    chosen_scene = d["scenes"][0]

    print(f"\n[A2] generate using recommended scene '{chosen_scene['title']}'")
    s, d = post("/api/generation/jobs", {
        "uploaded_asset_id": asset_id,
        "scene_kind": "recommended",
        "recommended_prompt_en": chosen_scene["prompt_en"],
        "platform_style": "domestic_ecommerce",
        "aspect_ratio": "4_5",
    })
    print(f"   job={d['job_id']} balance={d['credit_balance']}")
    final = poll_job(d["job_id"])
    if final and final["status"] == "completed":
        print(f"   ✅ recommended path: {len(final['outputs'])} images")
    else:
        print(f"   ❌ recommended path failed: {final}")
        sys.exit(1)

    # === Path B: custom prompt ===
    print("\n[B] generate using custom prompt")
    s, d = post("/api/generation/jobs", {
        "uploaded_asset_id": asset_id,
        "scene_kind": "custom",
        "custom_prompt": "工业风咖啡店，砖墙，木桌，暖光，傍晚",
        "platform_style": "brand_site",
        "aspect_ratio": "16_9",
    })
    print(f"   job={d['job_id']} balance={d['credit_balance']}")
    final = poll_job(d["job_id"])
    if final and final["status"] == "completed":
        print(f"   ✅ custom path: {len(final['outputs'])} images")
    else:
        print(f"   ❌ custom path failed: {final}")
        sys.exit(1)

    # === Path C: legacy template ===
    print("\n[C] generate using fixed template (legacy path)")
    s, d = get("/api/templates")
    tpl = d["templates"][0]
    s, d = post("/api/generation/jobs", {
        "uploaded_asset_id": asset_id,
        "scene_kind": "template",
        "template_id": tpl["id"],
        "platform_style": "domestic_ecommerce",
        "aspect_ratio": "1_1",
    })
    print(f"   job={d['job_id']} template={tpl['name']} balance={d['credit_balance']}")
    final = poll_job(d["job_id"])
    if final and final["status"] == "completed":
        print(f"   ✅ template path: {len(final['outputs'])} images")
    else:
        print(f"   ❌ template path failed: {final}")
        sys.exit(1)

    s, d = get("/api/me")
    print(f"\n[final] balance: {d['credit_balance']} (consumed 12 = 4×3)")
    print("\n🎉 ALL THREE SCENE PATHS WORK")


if __name__ == "__main__":
    main()
