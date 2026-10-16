import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";
import { signXunhupay } from "../../lib/xunhupay";

const enabled = process.env.RUN_RECHARGE_DATABASE_TESTS === "1" && process.platform === "win32";
const appid = "recharge-postgres-fixture";
const secret = "local-fixture-secret-not-a-merchant-credential";
const baseUrl = "https://merchant.example";
const owner = "recharge-owner";
const stranger = "recharge-stranger";
const pack = "basic";
const freshOrderNo = () => `LP${randomUUID().replace(/-/g, "").slice(0, 24)}`;

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  creation_state: string;
  credit_transaction_id: string | null;
  provider_payment_key: string | null;
  provider_query_status: string | null;
};

const signed = (fields: Record<string, string>) => ({ ...fields, hash: signXunhupay(fields, secret) });
const signedProvider = (fields: Record<string, string | number>) => ({ ...fields, hash: signXunhupay(fields, secret) });
const paid = (orderNo: string, providerId: string, overrides: Record<string, string> = {}) => signed({
  appid,
  trade_order_id: orderNo,
  total_fee: "30.00",
  status: "OD",
  transaction_id: providerId,
  open_order_id: `open-${providerId}`,
  ...overrides,
});

async function migrate(db: PrismaClient, relativePath: string) {
  const source = await readFile(path.join(process.cwd(), relativePath), "utf8");
  // These two migrations contain only top-level SQL statements. Keep the fixture bounded.
  for (const statement of source.split(";").map(value => value.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
}

async function rows(db: PrismaClient, orderNo?: string): Promise<OrderRow[]> {
  return orderNo
    ? db.$queryRaw<OrderRow[]>`SELECT "id", "order_no", "status"::TEXT AS "status", "creation_state", "credit_transaction_id", "provider_payment_key", "provider_query_status" FROM "RechargeOrder" WHERE "order_no" = ${orderNo}`
    : db.$queryRaw<OrderRow[]>`SELECT "id", "order_no", "status"::TEXT AS "status", "creation_state", "credit_transaction_id", "provider_payment_key", "provider_query_status" FROM "RechargeOrder" ORDER BY "created_at", "order_no"`;
}

async function balance(db: PrismaClient, userId = owner) {
  const result = await db.$queryRaw<Array<{ credit_balance: number }>>`SELECT "credit_balance" FROM "User" WHERE "id" = ${userId}`;
  return result[0]?.credit_balance;
}

async function ledger(db: PrismaClient) {
  return db.$queryRaw<Array<{ id: string; user_id: string; amount: number; type: string }>>`
    SELECT "id", "user_id", "amount", "type"::TEXT AS "type" FROM "CreditTransaction" ORDER BY "created_at", "id"`;
}

async function seedOrder(db: PrismaClient, orderNo: string, status: "pending" | "expired" = "pending", userId = owner) {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO "RechargeOrder" (
      "id", "order_no", "user_id", "pack", "amount_yuan", "credits", "status", "created_at", "updated_at", "expires_at",
      "provider_appid", "provider_gateway", "creation_state", "display_mode"
    ) VALUES (
      ${id}, ${orderNo}, ${userId}, ${pack}, 30.00, 100, ${status}::"RechargeStatus", CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP - INTERVAL '1 hour',
      ${appid}, 'https://api.xunhupay.com/payment/do.html', 'ready', 'desktop'
    )`;
  return orderNo;
}

function restoreEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("recharge orders and notifications preserve the PostgreSQL money and ledger invariants", { skip: !enabled, timeout: 240_000 }, async t => {
  const cluster = await isolatedVideoPostgres();
  const db = new PrismaClient({ datasourceUrl: cluster.url });
  const previousGlobal = global.prismaGlobal;
  const originalFetch = globalThis.fetch;
  const envNames = ["XUNHUPAY_APPID", "XUNHUPAY_APPSECRET", "PUBLIC_BASE_URL", "RECHARGE_ENABLED"];
  const previousEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
  try {
    await db.$executeRawUnsafe(`CREATE TYPE "CreditTxType" AS ENUM ('grant', 'consume', 'refund', 'manual_adjustment')`);
    await db.$executeRawUnsafe(`CREATE TABLE "CreditTransaction" (
      "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "type" "CreditTxType" NOT NULL, "amount" INTEGER NOT NULL, "related_job_id" TEXT,
      "note" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await migrate(db, "prisma/migrations/20260613012931_add_recharge_order/migration.sql");
    await migrate(db, "prisma/migrations/20261016020000_recharge_integrity/migration.sql");
    await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${owner}), (${stranger})`;
    global.prismaGlobal = db;
    process.env.XUNHUPAY_APPID = appid;
    process.env.XUNHUPAY_APPSECRET = secret;
    process.env.PUBLIC_BASE_URL = baseUrl;
    process.env.RECHARGE_ENABLED = "true";

    // Load only after the isolated client is installed. No production database is touched.
    const { processRechargeNotification } = await import("../../lib/billing/notifications");
    const { createRechargeOrder, getOwnedRechargeOrder, refreshRechargeOrder } = await import("../../lib/billing/orders");
    const attemptNotification = async (fields: Record<string, string>) => {
      try { return await processRechargeNotification(fields); }
      catch { return { applied: false }; }
    };
    const input = (key = randomUUID(), selectedPack = pack, displayMode: "desktop" | "mobile" = "desktop") => ({
      pack: selectedPack, display_mode: displayMode, idempotency_key: key,
    });

    await t.test("15 simultaneous callbacks credit one order and one linked ledger entry", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      await Promise.allSettled(Array.from({ length: 15 }, () => processRechargeNotification(paid(orderNo, "transaction-one"))));
      const order = (await rows(db, orderNo))[0];
      assert.equal(order.status, "paid");
      assert.equal(await balance(db), 100);
      const entries = await ledger(db);
      assert.equal(entries.length, 1);
      assert.deepEqual({ user_id: entries[0].user_id, amount: entries[0].amount, type: entries[0].type }, { user_id: owner, amount: 100, type: "grant" });
      assert.equal(order.credit_transaction_id, entries[0].id);
      assert.ok(order.provider_payment_key);
    });

    await t.test("separate paid orders each credit once; provider transaction cannot pay another order", async () => {
      const first = await seedOrder(db, freshOrderNo());
      const second = await seedOrder(db, freshOrderNo());
      await Promise.all([processRechargeNotification(paid(first, "transaction-two")), processRechargeNotification(paid(second, "transaction-three"))]);
      assert.equal(await balance(db), 300);
      assert.equal((await ledger(db)).length, 3);
      const duplicate = await seedOrder(db, freshOrderNo());
      await attemptNotification(paid(duplicate, "transaction-two"));
      assert.equal((await rows(db, duplicate))[0].status, "pending");
      assert.equal(await balance(db), 300);
      assert.equal((await ledger(db)).length, 3);
    });

    await t.test("invalid merchant, amount, status, or hash never credits", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      const valid = paid(orderNo, "transaction-invalid");
      const cases: Record<string, string>[] = [
        paid(orderNo, "transaction-invalid", { appid: "foreign-merchant" }),
        paid(orderNo, "transaction-invalid", { total_fee: "0.01" }),
        paid(orderNo, "transaction-invalid", { total_fee: "30.001" }),
        paid(orderNo, "transaction-invalid", { status: "WP" }),
        { ...valid, status: "OD", hash: "0".repeat(32) },
      ];
      const missingStatus: Record<string, string> = { ...valid }; delete missingStatus.status; cases.push(signed(missingStatus));
      const missingAmount: Record<string, string> = { ...valid }; delete missingAmount.total_fee; cases.push(signed(missingAmount));
      const missingTransaction: Record<string, string> = { ...valid }; delete missingTransaction.transaction_id; cases.push(signed(missingTransaction));
      const missingProviderOrder: Record<string, string> = { ...valid }; delete missingProviderOrder.open_order_id; cases.push(signed(missingProviderOrder));
      for (const callback of cases) {
        await attemptNotification(callback);
        assert.equal((await rows(db, orderNo))[0].status, "pending");
        assert.equal(await balance(db), 300);
        assert.equal((await ledger(db)).length, 3);
      }
    });

    await t.test("ledger insert failure rolls back order and balance, then retry commits", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      await db.$executeRawUnsafe(`CREATE FUNCTION fail_recharge_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture ledger failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER recharge_ledger_failure BEFORE INSERT ON "CreditTransaction" FOR EACH ROW EXECUTE FUNCTION fail_recharge_ledger()`);
      try {
        await attemptNotification(paid(orderNo, "transaction-retry"));
        assert.equal((await rows(db, orderNo))[0].status, "pending");
        assert.equal((await rows(db, orderNo))[0].credit_transaction_id, null);
        assert.equal(await balance(db), 300);
        assert.equal((await ledger(db)).length, 3);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER recharge_ledger_failure ON "CreditTransaction"`);
        await db.$executeRawUnsafe(`DROP FUNCTION fail_recharge_ledger()`);
      }
      await processRechargeNotification(paid(orderNo, "transaction-retry"));
      assert.equal((await rows(db, orderNo))[0].status, "paid");
      assert.equal(await balance(db), 400);
      assert.equal((await ledger(db)).length, 4);
    });

    await t.test("valid late payment after local expiry is credited exactly once", async () => {
      const orderNo = await seedOrder(db, freshOrderNo(), "expired");
      await Promise.allSettled([processRechargeNotification(paid(orderNo, "transaction-late")), processRechargeNotification(paid(orderNo, "transaction-late"))]);
      assert.equal((await rows(db, orderNo))[0].status, "paid");
      assert.equal(await balance(db), 500);
      assert.equal((await ledger(db)).length, 5);
    });

    await t.test("concurrent same UUID creates one provider order; reuse with changed input conflicts", async () => {
      let providerPosts = 0;
      globalThis.fetch = (async (_url, init) => {
        providerPosts++;
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify(signedProvider({ errcode: 0, errmsg: "success!", url: "https://pay.example/mobile", url_qrcode: "https://pay.example/qr.png", openid: "provider-created" })), { status: 200 });
      }) as typeof fetch;
      const key = randomUUID();
      const results = await Promise.all([createRechargeOrder(owner, input(key)), createRechargeOrder(owner, input(key))]);
      assert.equal(results[0].order.order_no, results[1].order.order_no);
      assert.equal(providerPosts, 1);
      assert.equal((await rows(db, results[0].order.order_no)).length, 1);
      for (const changed of [input(key, "business"), input(key, pack, "mobile")]) {
        await assert.rejects(() => createRechargeOrder(owner, changed));
      }
      assert.equal(providerPosts, 1);
    });

    await t.test("unknown gateway result stays inspectable and retry does not POST again", async () => {
      let providerPosts = 0;
      globalThis.fetch = (async () => { providerPosts++; throw new Error("fixture transport lost"); }) as typeof fetch;
      const key = randomUUID();
      const first = await createRechargeOrder(stranger, input(key));
      assert.equal(first.order.creation_state, "unknown");
      assert.equal((await rows(db, first.order.order_no))[0].creation_state, "unknown");
      const again = await createRechargeOrder(stranger, input(key));
      assert.equal(again.order.order_no, first.order.order_no);
      assert.equal(providerPosts, 1);
      assert.equal((await rows(db, first.order.order_no)).length, 1);
    });

    await t.test("provider query OD remains advisory; foreign owner cannot inspect", async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ errcode: 0, data: { status: "OD", open_order_id: "provider-created" }, errmsg: "success!", hash: "a".repeat(32) }))) as typeof fetch;
      const target = await seedOrder(db, freshOrderNo());
      await refreshRechargeOrder(owner, target);
      assert.equal((await rows(db, target))[0].status, "pending");
      assert.equal((await rows(db, target))[0].provider_query_status, "OD");
      assert.equal(await balance(db), 500);
      assert.equal((await ledger(db)).length, 5);
      const before = (await rows(db)).length;
      await assert.rejects(() => getOwnedRechargeOrder(stranger, target));
      await assert.rejects(() => refreshRechargeOrder(stranger, target));
      assert.equal((await rows(db)).length, before);
    });

    await t.test("closed recharge gate blocks new orders but honors signed old payment", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      process.env.RECHARGE_ENABLED = "false";
      try {
        await assert.rejects(() => createRechargeOrder(owner, input()));
        await processRechargeNotification(paid(orderNo, "transaction-gated"));
        assert.equal((await rows(db, orderNo))[0].status, "paid");
        assert.equal(await balance(db), 600);
        assert.equal((await ledger(db)).length, 6);
      } finally { process.env.RECHARGE_ENABLED = "true"; }
    });

    await t.test("signed CD stays terminal after UD; a later OD requires manual review", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      const startingBalance = await balance(db);
      const startingLedgerCount = (await ledger(db)).length;
      const providerId = "transaction-cd-ud";
      await assert.rejects(() => processRechargeNotification(paid(orderNo, providerId, { status: "CD", total_fee: "0.01" })));
      assert.equal((await getOwnedRechargeOrder(owner, orderNo)).requires_review, false);
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId, { status: "CD" })), { applied: false });
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId, { status: "UD" })), { applied: false });
      const proof = await db.$queryRaw<Array<{ callback_raw: { refund?: { status?: string }; requires_review?: boolean } }>>`
        SELECT "callback_raw" FROM "RechargeOrder" WHERE "order_no" = ${orderNo}`;
      assert.equal(proof[0].callback_raw.refund?.status, "CD");
      assert.equal(proof[0].callback_raw.requires_review, true);
      await assert.rejects(() => processRechargeNotification(paid(orderNo, providerId)));
      assert.equal((await rows(db, orderNo))[0].status, "pending");
      assert.equal((await getOwnedRechargeOrder(owner, orderNo)).requires_review, true);
      assert.equal(await balance(db), startingBalance);
      assert.equal((await ledger(db)).length, startingLedgerCount);
    });

    await t.test("signed RD before OD never silently converts to a paid order", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      const startingBalance = await balance(db);
      const startingLedgerCount = (await ledger(db)).length;
      const providerId = "transaction-rd-before-od";
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId, { status: "RD" })), { applied: false });
      await assert.rejects(() => processRechargeNotification(paid(orderNo, providerId)));
      assert.equal((await rows(db, orderNo))[0].status, "pending");
      assert.equal((await getOwnedRechargeOrder(owner, orderNo)).requires_review, true);
      assert.equal(await balance(db), startingBalance);
      assert.equal((await ledger(db)).length, startingLedgerCount);
    });

    await t.test("paid OD followed by CD and duplicate OD retains one grant and review flag", async () => {
      const orderNo = await seedOrder(db, freshOrderNo());
      const startingBalance = await balance(db);
      const startingLedgerCount = (await ledger(db)).length;
      const providerId = "transaction-paid-cd";
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId)), { applied: true });
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId, { status: "CD" })), { applied: false });
      assert.deepEqual(await processRechargeNotification(paid(orderNo, providerId)), { applied: false });
      const order = (await rows(db, orderNo))[0];
      assert.equal(order.status, "paid");
      assert.equal((await getOwnedRechargeOrder(owner, orderNo)).requires_review, true);
      assert.equal(await balance(db), startingBalance! + 100);
      assert.equal((await ledger(db)).length, startingLedgerCount + 1);
      const linked = await db.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CreditTransaction" WHERE "id" = ${order.credit_transaction_id}`;
      assert.equal(linked.length, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    global.prismaGlobal = previousGlobal;
    restoreEnv(previousEnv);
    await db.$disconnect();
    await cluster.cleanup();
  }
});
