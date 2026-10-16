import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  createXunhupayOrder,
  getPack,
  queryXunhupayOrder,
  signXunhupay,
  verifyNotifySignature,
} from "../../lib/xunhupay";

const secret = "test-secret";
const createInput = {
  appid: "test-app",
  appsecret: secret,
  orderNo: "ORDER_1",
  amountYuan: "30.00",
  title: "Test order",
  notifyUrl: "https://merchant.example/notify",
  returnUrl: "https://merchant.example/return",
};

function signed(payload: Record<string, string | number>) {
  return { ...payload, hash: signXunhupay(payload, secret) };
}

function withFetch(reply: () => Response | Promise<Response>, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return reply();
  }) as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

test("hash signs flat scalar fields and excludes hash only", () => {
  const expected = createHash("md5").update("a=1&sign=sigtest-secret").digest("hex");
  assert.equal(signXunhupay({ sign: "sig", a: "1", hash: "ignored" }, secret), expected);
  assert.throws(() => signXunhupay({ a: {} } as never, secret));
});

test("notification hash requires 32 hex characters and exact signed fields", () => {
  const payload = signed({ appid: "test-app", status: "OD", trade_order_id: "ORDER_1" });
  assert.equal(verifyNotifySignature(payload, secret), true);
  assert.equal(verifyNotifySignature({ ...payload, hash: "abc" }, secret), false);
  assert.equal(verifyNotifySignature({ ...payload, status: "WP" }, secret), false);
  assert.equal(verifyNotifySignature({ ...payload, extra: { nested: true } } as never, secret), false);
});

test("create accepts signed QR and mobile URLs separately and form posts signed fields", async () => {
  let posted: URLSearchParams | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "https://api.xunhupay.com/payment/do.html");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    posted = new URLSearchParams(String(init?.body));
    assert.equal(posted.get("payment"), null);
    assert.equal(posted.get("type"), null);
    assert.equal(posted.get("trade_order_id"), "ORDER_1");
    const body = signed({ errcode: 0, errmsg: "success!", url: "https://pay.example/mobile", url_qrcode: "https://pay.example/qr.png", openid: "P123" });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await createXunhupayOrder({ ...createInput, paymentType: "wechat" }), {
      ok: true, payUrl: "https://pay.example/mobile", qrCodeUrl: "https://pay.example/qr.png", providerOrderId: "P123",
    });
    assert.ok(posted?.get("hash"));
  } finally { globalThis.fetch = original; }
});

test("unsigned or malformed create responses never yield a usable payment URL", async () => {
  for (const response of [
    { errcode: 0, url: "https://pay.example/mobile" },
    signed({ errcode: 0, url: "http://pay.example/mobile" }),
    signed({ errcode: 0, url: "javascript:alert(1)" }),
    signed({ errcode: 0 }),
    signed({ errcode: "0", url: "https://pay.example/mobile" }),
  ]) {
    await withFetch(() => new Response(JSON.stringify(response)), async () => {
      const result = await createXunhupayOrder(createInput);
      assert.deepEqual(result.ok, false);
      if (!result.ok) assert.equal(result.kind, "unknown");
    });
  }
});

test("QR-only signed response leaves mobile URL empty", async () => {
  await withFetch(() => new Response(JSON.stringify(signed({ errcode: 0, url_qrcode: "https://pay.example/qr.png", openid: 123 }))), async () => {
    assert.deepEqual(await createXunhupayOrder(createInput), {
      ok: true, payUrl: null, qrCodeUrl: "https://pay.example/qr.png", providerOrderId: "123",
    });
  });
});

test("create rejects unapproved gateways before any network call", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("fetch should not be called"); }) as typeof fetch;
  try {
    assert.deepEqual(await createXunhupayOrder({ ...createInput, gateway: "https://attacker.example/payment/do.html" }), {
      ok: false, kind: "unknown", code: "invalid_input",
    });
  } finally { globalThis.fetch = original; }
});

test("create bounds response bytes and treats non-200 as uncertain", async () => {
  await withFetch(() => new Response("x".repeat(16_385)), async () => {
    assert.deepEqual(await createXunhupayOrder(createInput), { ok: false, kind: "unknown", code: "transport_error" });
  });
  await withFetch(() => new Response("bad gateway", { status: 502 }), async () => {
    assert.deepEqual(await createXunhupayOrder(createInput), { ok: false, kind: "unknown", code: "transport_error" });
  });
});

test("signed rejection is distinct from transport uncertainty", async () => {
  await withFetch(() => new Response(JSON.stringify(signed({ errcode: 500, errmsg: "secret upstream detail" }))), async () => {
    assert.deepEqual(await createXunhupayOrder(createInput), { ok: false, kind: "rejected", code: "provider_rejected" });
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network unavailable"); }) as typeof fetch;
  try {
    assert.deepEqual(await createXunhupayOrder(createInput), { ok: false, kind: "unknown", code: "transport_error" });
  } finally { globalThis.fetch = original; }
});

test("query result remains advisory even when it says paid", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "https://api.xunhupay.com/payment/query.html");
    assert.equal(init?.redirect, "error");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("out_trade_order"), "ORDER_1");
    return new Response(JSON.stringify({ errcode: 0, data: { status: "OD", open_order_id: "P123" }, errmsg: "success!", hash: "a".repeat(32) }));
  }) as typeof fetch;
  try {
    assert.deepEqual(await queryXunhupayOrder({ appid: "test-app", appsecret: secret, orderNo: "ORDER_1" }), {
      ok: true, status: "OD", responseSignatureVerified: false, advisoryOnly: true,
    });
  } finally { globalThis.fetch = original; }
});

test("query rejects malformed status and never upgrades it to financial proof", async () => {
  await withFetch(() => new Response(JSON.stringify({ errcode: 0, data: { status: ["OD"] } })), async () => {
    assert.deepEqual(await queryXunhupayOrder({ appid: "test-app", appsecret: secret, orderNo: "ORDER_1" }), {
      ok: false, kind: "invalid_response", code: "invalid_response",
    });
  });
});

test("prototype names cannot resolve recharge packs", () => {
  assert.equal(getPack("toString"), null);
  assert.equal(getPack("__proto__"), null);
});
