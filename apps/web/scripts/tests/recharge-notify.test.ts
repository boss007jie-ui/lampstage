import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { signXunhupay } from "../../lib/xunhupay";

const appid = "fixture-merchant";
const secret = "fixture-only-not-a-credential";
const order = { id: "fixture-order", order_no: "LPfixture", user_id: "owner", pack: "basic", amount_yuan: "30.00", credits: 100, status: "pending" };
let writes = 0;
let failTransaction = false;
const db = {
  rechargeOrder: { findUnique: async () => order, update: async () => { writes++; return order; } },
  user: { update: async () => { writes++; return { credit_balance: 100 }; } },
  creditTransaction: { create: async () => { writes++; return { id: "ledger" }; } },
  $transaction: async (action: (tx: unknown) => unknown) => {
    if (failTransaction) throw new Error("fixture database failure");
    return action(db);
  },
};

const base = { appid, trade_order_id: order.order_no, total_fee: "30.00", status: "OD", transaction_id: "trade-1", open_order_id: "provider-1" };
function request(fields: Record<string, string>) {
  return new Request("https://lampstage.com/api/recharge/notify", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, hash: signXunhupay(fields, secret) }),
  });
}
test("signed notifications require explicit paid status, amount and the configured merchant before storage", async () => {
  const previous = global.prismaGlobal;
  const env = { appid: process.env.XUNHUPAY_APPID, secret: process.env.XUNHUPAY_APPSECRET };
  global.prismaGlobal = db as unknown as PrismaClient;
  process.env.XUNHUPAY_APPID = appid; process.env.XUNHUPAY_APPSECRET = secret;
  try {
    const { POST } = await import("../../app/api/recharge/notify/route");
    for (const field of ["status", "total_fee"] as const) {
      writes = 0;
      const fields: Record<string, string> = { ...base }; delete fields[field];
      const response = await POST(request(fields));
      assert.equal(writes, 0, `missing ${field} must not write balances or orders`);
      assert.equal(response.status, 400);
      assert.notEqual(await response.text(), "success");
    }
    writes = 0;
    const wrongMerchant = await POST(request({ ...base, appid: "different-merchant" }));
    assert.equal(writes, 0);
    assert.equal(wrongMerchant.status, 400);
  } finally {
    global.prismaGlobal = previous;
    if (env.appid === undefined) delete process.env.XUNHUPAY_APPID; else process.env.XUNHUPAY_APPID = env.appid;
    if (env.secret === undefined) delete process.env.XUNHUPAY_APPSECRET; else process.env.XUNHUPAY_APPSECRET = env.secret;
  }
});

test("database failure must not acknowledge successful payment processing", async () => {
  const env = { appid: process.env.XUNHUPAY_APPID, secret: process.env.XUNHUPAY_APPSECRET };
  process.env.XUNHUPAY_APPID = appid; process.env.XUNHUPAY_APPSECRET = secret;
  failTransaction = true;
  try {
    const { POST } = await import("../../app/api/recharge/notify/route");
    const response = await POST(request(base));
    assert.equal(response.status, 503);
    assert.notEqual(await response.text(), "success");
  } finally {
    failTransaction = false;
    if (env.appid === undefined) delete process.env.XUNHUPAY_APPID; else process.env.XUNHUPAY_APPID = env.appid;
    if (env.secret === undefined) delete process.env.XUNHUPAY_APPSECRET; else process.env.XUNHUPAY_APPSECRET = env.secret;
  }
});

test("notification parsing rejects duplicates, nested values and oversized bodies", async () => {
  const { parseRechargeNotification } = await import("../../lib/billing/notifications");
  const req = (body: string, type = "application/json") => new Request("https://merchant.example/notify", {
    method: "POST", headers: { "content-type": type }, body,
  });
  for (const body of ['{"status":"OD","status":"CD"}', '{"status":"OD","sta\\u0074us":"CD"}',
    '{"data":{"status":"OD"}}', '{"status":null}', '{"status":true}']) {
    await assert.rejects(() => parseRechargeNotification(req(body)));
  }
  await assert.rejects(() => parseRechargeNotification(req("status=OD&status=CD", "application/x-www-form-urlencoded")));
  await assert.rejects(() => parseRechargeNotification(req("x=" + "a".repeat(17000), "application/x-www-form-urlencoded")));
  const parsed = await parseRechargeNotification(req('{"status":"OD","total_fee":30,"title":"a, \\\"b\\\": 1"}'));
  assert.equal(parsed.status, "OD"); assert.equal(parsed.total_fee, "30"); assert.equal(parsed.title, 'a, "b": 1');
});

test("currency parsing rejects rounding, exponents and non-positive amounts", async () => {
  const { moneyCents } = await import("../../lib/billing/catalog");
  assert.equal(moneyCents("30.01"), 3001);
  for (const value of ["0", "0.00", "-1", "30.001", "3e1", "+30", "030", " 30", "NaN", "Infinity"]) assert.equal(moneyCents(value), null);
});
