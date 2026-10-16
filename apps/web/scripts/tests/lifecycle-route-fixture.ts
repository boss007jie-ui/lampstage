import type { TestContext } from "node:test";
import { prisma } from "../../lib/db";

type Method = (...args: any[]) => Promise<any>;

export function stubMethod(t: TestContext, model: object, name: string, implementation: Method) {
  const delegate = model as Record<string, Method>;
  const original = delegate[name];
  delegate[name] = implementation;
  t.after(() => { delegate[name] = original; });
}

/** Keep transaction-backed route tests entirely inside the in-memory Prisma fixture. */
export function lifecycleTransaction(t: TestContext, counts: Record<string, number> = {}) {
  stubMethod(t, prisma, "$transaction", async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
  stubMethod(t, prisma, "$queryRaw", async (strings: TemplateStringsArray) =>
    String(strings[0]).includes("clock_timestamp") ? [{ now: new Date("2026-10-15T12:00:00.000Z") }] : [{ id: "owner" }]);
  stubMethod(t, prisma.videoJob, "findMany", async () => []);
  stubMethod(t, prisma.videoJob, "groupBy", async () => Object.entries(counts).map(([status, count]) => ({ status, _count: { _all: count } })));
  stubMethod(t, prisma.videoPermit, "findMany", async () => []);
}
