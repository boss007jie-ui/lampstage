import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient, VideoJob } from "@prisma/client";
import { claimJob } from "../../lib/video/repository";

test("recovery-only claims inspect reconcile and assemble while leaving render and prepare queued", async () => {
  const rows = ["render", "prepare_sixref", "reconcile", "assemble"].map((phase, i) => ({
    id: `job-${phase}`, phase, status: "queued", revision: 1, lease_owner: null as string | null, lease_until: null as Date | null,
    created_at: new Date(2026, 0, 1, 0, i), data: { segments: [] },
  }));
  const selectedPhases: string[][] = [];
  const db = { videoJob: {
    findMany: async ({ where, take }: { where: { status: string; lease_owner: null; phase?: { in: string[] } }; take: number }) => {
      assert.equal(where.status, "queued");
      assert.equal(where.lease_owner, null);
      assert.equal(take, 10);
      selectedPhases.push(where.phase?.in ?? []);
      return rows.filter(row => row.status === "queued" && row.lease_owner === null &&
        (!where.phase || where.phase.in.includes(row.phase))).slice(0, take) as unknown as VideoJob[];
    },
    updateMany: async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      if (typeof where.status === "object") return { count: 0 }; // Expired-lease sweep.
      const row = rows.find(item => item.id === where.id && item.status === where.status && item.revision === where.revision && item.lease_owner === null);
      if (!row) return { count: 0 };
      row.status = data.status;
      row.lease_owner = data.lease_owner;
      row.lease_until = data.lease_until;
      row.revision += data.revision.increment;
      return { count: 1 };
    },
    findFirst: async ({ where }: { where: { id: string; lease_owner: string } }) =>
      rows.find(row => row.id === where.id && row.lease_owner === where.lease_owner) as unknown as VideoJob | undefined,
  } } as unknown as PrismaClient;
  const first = await claimJob("recovery-worker", db, { recoveryOnly: true });
  const second = await claimJob("recovery-worker", db, { recoveryOnly: true });
  const third = await claimJob("recovery-worker", db, { recoveryOnly: true });
  assert.equal(first?.phase, "reconcile");
  assert.equal(second?.phase, "assemble");
  assert.equal(third, null);
  assert.deepEqual(selectedPhases, [["reconcile", "assemble"], ["reconcile", "assemble"], ["reconcile", "assemble"]]);
  assert.deepEqual(rows.filter(row => row.status === "queued").map(row => row.phase), ["render", "prepare_sixref"]);
});
