"""测 /api/generation/suggest/thumb 按需缩略图。"""
import json, sys, time, urllib.request, urllib.error
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


def upload(file_path: Path):
    boundary = "----LampThumbBoundary" + str(int(time.time() * 1000))
    parts = []
    parts.append(f"--{boundary}".encode())
    parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"'.encode()
    )
    parts.append(b"Content-Type: image/jpeg")
    parts.append(b"")
    parts.append(file_path.read_bytes())
    parts.append(f"--{boundary}--".encode())
    parts.append(b"")
    body = b"\r\n".join(parts)
    req = urllib.request.Request(
        BASE + "/api/uploads",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with opener.open(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    email = f"thumb-{int(time.time())}@lampstage.com"
    print(f"[1] sign in {email}")
    s, d = post("/api/auth/send-code", {"identifier": email})
    code = d["devCode"]
    s, d = post("/api/auth/verify-code", {"identifier": email, "code": code})
    print(f"   user={d['user_id']} balance={d['credit_balance']}")

    print("\n[2] upload showcase image")
    asset = upload(TEST_IMG)
    print(f"   asset_id={asset['id']}")

    print("\n[3] suggest scenes (~21s)")
    t0 = time.time()
    s, d = post("/api/generation/suggest", {"uploaded_asset_id": asset["id"]})
    print(f"   {time.time()-t0:.1f}s, got {len(d['scenes'])} scenes")
    scene = d["scenes"][0]
    print(f"   scene[0]: {scene['title']} - {scene['pitch']}")

    print(f"\n[4] thumb idx=0 (cold, expect generate ~10-15s)")
    t0 = time.time()
    s, d = post(
        "/api/generation/suggest/thumb",
        {
            "uploaded_asset_id": asset["id"],
            "idx": 0,
            "prompt_en": scene["prompt_en"],
        },
    )
    print(f"   {time.time()-t0:.1f}s, status={s} url={d.get('thumb_url')} cached={d.get('cached')}")

    print(f"\n[5] thumb idx=0 again (warm, expect cached ~0.1s)")
    t0 = time.time()
    s, d = post(
        "/api/generation/suggest/thumb",
        {
            "uploaded_asset_id": asset["id"],
            "idx": 0,
            "prompt_en": scene["prompt_en"],
        },
    )
    print(f"   {time.time()-t0:.1f}s, status={s} cached={d.get('cached')}")

    # check the file actually got saved
    expected = WEB / "public" / "suggest-thumbs" / asset["id"] / "0.jpg"
    if expected.exists():
        print(f"\n[6] file on disk: {expected.stat().st_size // 1024}KB ✅")
    else:
        print(f"\n[6] FILE MISSING at {expected}")
        sys.exit(1)

    print("\n[7] check no extra credits charged (suggest 不扣费, thumb 不扣费)")
    s, d = opener.open(urllib.request.Request(BASE + "/api/me"), timeout=10).read(), None
    s, d = post("/api/me", {})  # post fails, use get
    # actually use get
    req = urllib.request.Request(BASE + "/api/me")
    with opener.open(req, timeout=10) as r:
        data = json.loads(r.read())
    print(f"   balance now: {data['credit_balance']} (started 20, suggest+thumb should NOT charge)")
    assert data['credit_balance'] == 20, f"unexpected balance {data['credit_balance']}"
    print("\n🎉 thumb on-demand works")


if __name__ == "__main__":
    main()
