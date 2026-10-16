import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { requestAsyncStorage, type RequestStore } from "next/dist/client/components/request-async-storage.external";
import { DELETE as revokeKey } from "../../app/api/account/api-keys/[id]/route";
import { authenticateApiKey } from "../../lib/api-key";
import { prisma } from "../../lib/db";

type KeyRow = { id: string; user_id: string; revoked_at: Date | null };
type Query = { where: { id?: string; user_id?: string; revoked_at?: null }; data?: { revoked_at: Date } };

// Only persistence and request context are simulated. The real route and
// credential rejection code run without reading any local or production keys.
function fixture(t: TestContext, signedIn = true) {
  const keys: KeyRow[] = [
    { id: "own-key", user_id: "owner", revoked_at: null },
    { id: "foreign-key", user_id: "another-user", revoked_at: null },
  ];
  let revocations = 0;
  t.mock.method(requestAsyncStorage, "getStore", () => ({
    cookies: { get: () => signedIn ? { name: "lamp_session", value: "test-session" } : undefined },
  }) as unknown as RequestStore);
  const replace = (model: object, method: string, implementation: (query: Query) => unknown) => {
    const delegate = model as Record<string, (query: Query) => Promise<unknown>>;
    const original = delegate[method];
    delegate[method] = async query => implementation(query);
    t.after(() => { delegate[method] = original; });
  };
  replace(prisma.session, "findUnique", () => ({
    id: "test-session", user_id: "owner", expires_at: new Date("2099-01-01"),
    user: { id: "owner" },
  }));
  replace(prisma.apiKey, "updateMany", query => {
    const key = keys.find(row => row.id === query.where.id && row.user_id === query.where.user_id && row.revoked_at === null);
    if (!key) return { count: 0 };
    key.revoked_at = query.data!.revoked_at;
    revocations++;
    return { count: 1 };
  });
  replace(prisma.apiKey, "findFirst", query => keys.find(row => row.id === query.where.id && row.user_id === query.where.user_id) ?? null);
  replace(prisma.apiKey, "findUnique", () => ({ ...keys[0], user: { id: "owner" } }));
  replace(prisma.apiKey, "update", () => keys[0]);
  return { keys, get revocations() { return revocations; } };
}

const request = () => new Request("https://lampstage.com/api/account/api-keys/own-key", { method: "DELETE" });

test("repeated revocation of an owned key succeeds without changing its original timestamp", async t => {
  const f = fixture(t);
  assert.equal((await revokeKey(request(), { params: { id: "own-key" } })).status, 200);
  const revokedAt = f.keys[0].revoked_at;
  assert.ok(revokedAt);
  const repeated = await revokeKey(request(), { params: { id: "own-key" } });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), { ok: true });
  assert.equal(f.revocations, 1);
  assert.equal(f.keys[0].revoked_at, revokedAt);
});

test("two concurrent revoke requests acknowledge the same completed revocation", async t => {
  const f = fixture(t);
  const responses = await Promise.all([
    revokeKey(request(), { params: { id: "own-key" } }),
    revokeKey(request(), { params: { id: "own-key" } }),
  ]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(f.revocations, 1);
});

test("a different account's key and a nonexistent key both return 404", async t => {
  const f = fixture(t);
  for (const id of ["foreign-key", "missing-key"]) {
    const response = await revokeKey(request(), { params: { id } });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
  assert.equal(f.revocations, 0);
  assert.ok(f.keys.every(key => key.revoked_at === null));
});

test("signed-out requests cannot revoke a key", async t => {
  const f = fixture(t, false);
  const response = await revokeKey(request(), { params: { id: "own-key" } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "not_signed_in" });
  assert.equal(f.revocations, 0);
});

test("revocation invalidates authentication while preserving the audit row", async t => {
  const f = fixture(t);
  const apiRequest = new Request("https://lampstage.com/api/v1/account/usage", {
    headers: { Authorization: "Bearer lmp_live_test_fixture_only" },
  });
  assert.ok(await authenticateApiKey(apiRequest));
  assert.equal((await revokeKey(request(), { params: { id: "own-key" } })).status, 200);
  assert.equal(await authenticateApiKey(apiRequest), null);
  assert.equal(f.keys.length, 2);
});
