import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { requestAsyncStorage, type RequestStore } from "next/dist/client/components/request-async-storage.external";
import { prisma } from "../../lib/db";
import { GET } from "../../app/api/account/video-jobs/[id]/media/route";
import { stubMethod } from "./lifecycle-route-fixture";

test("session delivery media checks owner and serves local byte ranges", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lamp-template-media-"));
  const previous = process.env.VIDEO_STORAGE_DIR;
  process.env.VIDEO_STORAGE_DIR = root;
  t.after(async () => { if (previous === undefined) delete process.env.VIDEO_STORAGE_DIR;
    else process.env.VIDEO_STORAGE_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const key = "videos/owner/output.mp4";
  await mkdir(path.join(root, "videos", "owner"), { recursive: true });
  await writeFile(path.join(root, key), Buffer.from("0123456789"));
  let signedIn = true; let viewer = "owner";
  t.mock.method(requestAsyncStorage, "getStore", () => ({ cookies: { get: () => signedIn ? { name: "lamp_session", value: "fixture" } : undefined } }) as unknown as RequestStore);
  stubMethod(t, prisma.session, "findUnique", async () => ({ id: "fixture", expires_at: new Date("2099-01-01"), user: { id: viewer, role: "USER", email: null } }));
  stubMethod(t, prisma.videoJob, "findFirst", async ({ where }: { where: { id: string; user_id: string } }) =>
    where.id === "job" && where.user_id === "owner" ? { id: "job", user_id: "owner", data: { version: 1, imageCalls: 0, segments: [], outputKey: key },
      source_asset: { storage_key: "videos/owner/source.mp4", mime: "video/mp4" } } : null);
  const request = (query = "", range?: string) => new NextRequest(`https://lampstage.com/api/account/video-jobs/job/media?kind=output${query}`,
    { headers: range ? { range } : {} });
  const ranged = await GET(request("", "bytes=2-5"), { params: { id: "job" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await ranged.text(), "2345");
  const download = await GET(request("&download=1"), { params: { id: "job" } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  viewer = "stranger";
  const foreign = await GET(request(), { params: { id: "job" } });
  assert.equal(foreign.status, 404);
  signedIn = false;
  const guest = await GET(request(), { params: { id: "job" } });
  assert.equal(guest.status, 401);
});
