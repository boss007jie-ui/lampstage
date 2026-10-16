import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";
import { cleanTemplateRecipe, templateStructureSignature } from "../../lib/video/template-recipe";
import { getVideoTemplate, listVideoTemplates, submitVideoFeedback, updateVideoTemplate } from "../../lib/video/template-service";
import { getVideoDelivery } from "../../lib/video/delivery-service";
import { createVideoDraft } from "../../lib/video/job-quota";
import { parseSixReferencePlan } from "../../lib/video/six-reference-plan";
import { ensureVideoAssetSha256 } from "../../lib/video/asset-hash";
import { VIDEO_MAX_BYTES } from "../../lib/video/types";

const enabled = process.env.RUN_VIDEO_DATABASE_TESTS === "1" && process.platform === "win32";
const hash = "a".repeat(64);
const output = "b".repeat(64);
const value = <T>(result: { ok: true; value: T } | { ok: false; status: number; body: Record<string, unknown> }): T => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
};
const status = <T>(result: { ok: true; value: T } | { ok: false; status: number; body: Record<string, unknown> }) => result.ok ? 200 : result.status;
const data = (instructions = "Open the package") => ({ version: 1, imageCalls: 0, generationMode: "six_references", workflowProfile: "sixref-v1", sourceDuration: 5,
  referenceImages: [{ assetId: "product", role: "product", label: "Product" }],
  segments: [{ index: 0, start: 0, sourceWindowDuration: 5, duration: 5, trimStart: 0, attempt: 3,
    instructions, beforeState: "Package closed", afterState: "Package open",
    referenceImages: [{ assetId: "product", role: "product", label: "Product", key: "private-path", sha256: hash }],
    accepted: true, candidateKey: "videos/owner/candidate.mp4", candidateSha256: "c".repeat(64),
    tailKey: "videos/owner/tail.png", tailSha256: "d".repeat(64), history: [{ attempt: 1, reason: "old" }] }],
  outputKey: "videos/owner/output.mp4", outputSha256: output,
  renderConsent: { at: "yesterday", maxCoins: 100, estimatedCoins: 100, perSegmentCoins: 100, segmentIndices: [0] } });

test("video template migration and transactional save enforce ownership, hash, structure and idempotency", { skip: !enabled, timeout: 240_000 }, async () => {
  const cluster = await isolatedVideoPostgres({ templateColumn: false });
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const db = client();
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), "lamp-template-hash-"));
  const priorStorageRoot = process.env.VIDEO_STORAGE_DIR;
  process.env.VIDEO_STORAGE_DIR = storageRoot;
  try {
    await db.$executeRawUnsafe(`CREATE TABLE "VideoAsset" (
      "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "storage_key" TEXT NOT NULL UNIQUE,
      "mime" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const sql = await readFile(path.join(process.cwd(), "prisma/migrations/20261015150000_video_templates_delivery/migration.sql"), "utf8");
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    await db.$executeRawUnsafe(`CREATE TABLE "UploadedAsset" ("id" TEXT PRIMARY KEY)`);
    const characterSql = await readFile(path.join(process.cwd(), "prisma/migrations/20261016010000_character_library/migration.sql"), "utf8");
    for (const statement of characterSql.split(";").map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    await db.$executeRaw`INSERT INTO "User" ("id") VALUES ('owner'), ('stranger')`;
    await db.videoAsset.create({ data: { id: "source", user_id: "owner", storage_key: "videos/owner/source.mp4", mime: "video/mp4", size_bytes: 100, status: "ready", sha256: hash } });
    const legacyBytes = Buffer.from("historical private video bytes");
    await mkdir(path.join(storageRoot, "videos", "owner"), { recursive: true });
    await writeFile(path.join(storageRoot, "videos", "owner", "legacy.mp4"), legacyBytes);
    await db.videoAsset.createMany({ data: [
      { id: "legacy-source", user_id: "owner", storage_key: "videos/owner/legacy.mp4", mime: "video/mp4", size_bytes: legacyBytes.length, status: "ready" },
      { id: "oversized-source", user_id: "owner", storage_key: "videos/owner/oversized.mp4", mime: "video/mp4", size_bytes: VIDEO_MAX_BYTES + 1, status: "ready" },
    ] });
    const legacyHash = createHash("sha256").update(legacyBytes).digest("hex");
    assert.equal(await ensureVideoAssetSha256("owner", "legacy-source", db), legacyHash);
    assert.equal((await db.videoAsset.findUniqueOrThrow({ where: { id: "legacy-source" } })).sha256, legacyHash);
    assert.equal(await ensureVideoAssetSha256("stranger", "legacy-source", db), null);
    assert.equal(await ensureVideoAssetSha256("owner", "oversized-source", db), null);
    const job = await db.videoJob.create({ data: { id: "job", user_id: "owner", source_asset_id: "source", product_asset_id: "product",
      title: "Clothing demo", instructions: "Keep colour", preserve_audio: true, status: "completed", stage: "complete", data: data() } });
    const input = { decision: "satisfied_save_template" as const, output_sha256: output, name: "Opening", category: "Clothing" };
    assert.equal(status(await submitVideoFeedback("stranger", job.id, input, db)), 404);
    assert.equal(status(await submitVideoFeedback("owner", job.id, { ...input, output_sha256: "e".repeat(64) }, db)), 409);
    const first = client(); const second = client();
    const results = await Promise.all([submitVideoFeedback("owner", job.id, input, first), submitVideoFeedback("owner", job.id, input, second)]);
    assert.ok(results.every(r => r.ok), JSON.stringify(results));
    assert.equal(value(results[0]).version_id, value(results[1]).version_id);
    assert.equal(await db.videoTemplate.count(), 1);
    assert.equal(await db.videoTemplateVersion.count(), 1);
    assert.equal(value(await getVideoDelivery("owner", job.id, db)).feedback?.template_version_id, value(results[0]).version_id);
    const changedOutput = data(); changedOutput.outputSha256 = "f".repeat(64);
    await db.videoJob.update({ where: { id: job.id }, data: { data: changedOutput } });
    assert.equal(value(await getVideoDelivery("owner", job.id, db)).feedback, null, "stale feedback is not shown for a changed output");
    await db.videoJob.update({ where: { id: job.id }, data: { data: data() } });
    const detail = await getVideoTemplate("owner", value(results[0]).template!.id, undefined, db);
    assert.equal(detail.ok, true);
    assert.equal(status(await getVideoTemplate("stranger", value(results[0]).template!.id, undefined, db)), 404);
    const recipeText = JSON.stringify(value(detail).selected_version.create_payload);
    for (const prohibited of ["renderConsent", "candidateKey", "accepted", "tailKey", "history", "attempt", "trimStart", "private-path"])
      assert.ok(!recipeText.includes(prohibited), prohibited);
    const recipe = cleanTemplateRecipe({ source_asset_id: job.source_asset_id, product_asset_id: job.product_asset_id,
      title: job.title, instructions: job.instructions, preserve_audio: true, data: data() as any });
    assert.equal(templateStructureSignature(recipe, hash), (await db.videoTemplate.findFirstOrThrow()).structure_signature);
    const revised = await submitVideoFeedback("owner", job.id, { decision: "needs_changes", output_sha256: output,
      notes: "Check the sleeve\nThen inspect the seam" }, db);
    assert.equal(revised.ok, true);
    assert.equal(value(revised).feedback.notes, "Check the sleeve\nThen inspect the seam");
    assert.equal(value(revised).version_id, value(results[0]).version_id, "feedback edit retains saved version");
    assert.equal(await db.videoTemplateVersion.count(), 1);
    const templateId = value(results[0]).template!.id;
    assert.equal(status(await updateVideoTemplate("stranger", templateId, { archived: true }, db)), 404);
    await db.videoAsset.createMany({ data: [
      { id: "source-reupload", user_id: "owner", storage_key: "videos/owner/reupload.mp4", mime: "video/mp4", size_bytes: 100, status: "ready", sha256: hash },
      { id: "source-other", user_id: "owner", storage_key: "videos/owner/other.mp4", mime: "video/mp4", size_bytes: 100, status: "ready", sha256: "e".repeat(64) },
      { id: "foreign-source", user_id: "stranger", storage_key: "videos/stranger/source.mp4", mime: "video/mp4", size_bytes: 100, status: "ready", sha256: hash },
    ] });
    assert.deepEqual(value(await listVideoTemplates("owner", { source_asset_id: "source-reupload" }, db)).templates.map(t => t.id), [templateId]);
    assert.equal(value(await listVideoTemplates("owner", { source_asset_id: "source-other" }, db)).templates.length, 0);
    assert.equal(status(await listVideoTemplates("owner", { source_asset_id: "foreign-source" }, db)), 404);
    assert.equal(value(await listVideoTemplates("stranger", { source_asset_id: "foreign-source" }, db)).templates.length, 0);
    const savedPayload = value(detail).selected_version.create_payload;
    const reuseInput = { source_asset_id: savedPayload.source_asset_id, product_asset_id: savedPayload.product_asset_id,
      title: savedPayload.title, instructions: savedPayload.instructions, preserve_audio: savedPayload.preserve_audio,
      stage: "waiting", data: parseSixReferencePlan(savedPayload as any), template_version_id: value(results[0]).version_id! };
    const reuploadDraft = value(await createVideoDraft("owner", { ...reuseInput, source_asset_id: "source-reupload" }, { db }));
    assert.equal(reuploadDraft.template_version_id, value(results[0]).version_id);
    assert.equal(status(await createVideoDraft("owner", { ...reuseInput, source_asset_id: "source-other" }, { db })), 409);
    assert.equal((await updateVideoTemplate("owner", templateId, { archived: true }, db)).ok, true);
    assert.equal(status(await createVideoDraft("owner", reuseInput, { db })), 409, "archived template cannot create a draft");
    assert.equal(value(await listVideoTemplates("owner", {}, db)).templates.length, 0);
    assert.equal(value(await listVideoTemplates("owner", { status: "archived" }, db)).templates.length, 1);
    await updateVideoTemplate("owner", templateId, { archived: false }, db);
    assert.equal(value(await createVideoDraft("owner", reuseInput, { db })).template_version_id, value(results[0]).version_id);
    let releaseLock!: () => void;
    const held = new Promise<void>(resolve => { releaseLock = resolve; });
    let lockAcquired!: () => void;
    const acquired = new Promise<void>(resolve => { lockAcquired = resolve; });
    const locker = client(); const archiver = client(); const creator = client();
    const holding = locker.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = 'owner' FOR UPDATE`;
      lockAcquired(); await held;
    }, { timeout: 15_000 });
    await acquired;
    const archiveRace = updateVideoTemplate("owner", templateId, { archived: true }, archiver);
    await new Promise(resolve => setTimeout(resolve, 75));
    const createRace = createVideoDraft("owner", reuseInput, { db: creator });
    releaseLock();
    await holding;
    const archived = value(await archiveRace).template;
    assert.equal(archived.archived, true);
    const racedCreate = await createRace;
    assert.ok(status(racedCreate) === 409 || (racedCreate.ok && racedCreate.value.created_at <= new Date(archived.updated_at)),
      "create may succeed only when it wins the account lock before archive");
    await updateVideoTemplate("owner", templateId, { archived: false }, db);
    const differentStructure = structuredClone(reuseInput);
    differentStructure.data.segments[0].duration = 4;
    assert.equal(status(await createVideoDraft("owner", differentStructure, { db })), 409);
    const another = await db.videoJob.create({ data: { id: "other-job", user_id: "owner", source_asset_id: "source", product_asset_id: "product",
      title: "Other structure", status: "completed", stage: "complete", data: data("Different move") } });
    // Action text may change without changing the structure.
    assert.equal((await submitVideoFeedback("owner", another.id, { ...input, template_id: templateId }, db)).ok, true);
    assert.equal(await db.videoTemplateVersion.count(), 2);
    await db.videoTemplate.create({ data: { id: "ordinal-999", user_id: "owner", code: "T999", name: "Legacy code",
      source_asset_id: "source", source_sha256: hash, source_duration: 5, structure_signature: "0".repeat(64) } });
    const laterJobs = [];
    for (const label of ["ordinal-1000", "ordinal-1001"]) laterJobs.push(await db.videoJob.create({ data: {
      id: label, user_id: "owner", source_asset_id: "source", product_asset_id: "product", title: label,
      status: "completed", stage: "complete", data: data() } }));
    for (const later of laterJobs) assert.equal(value(await submitVideoFeedback("owner", later.id, input, db)).template?.code,
      later.id === "ordinal-1000" ? "T1000" : "T1001");
    const longTitle = await db.videoJob.create({ data: { id: "long-title", user_id: "owner", source_asset_id: "source",
      product_asset_id: "product", title: "A".repeat(80), status: "completed", stage: "complete", data: data() } });
    const defaultNamed = value(await submitVideoFeedback("owner", longTitle.id, { decision: "satisfied_save_template",
      output_sha256: output, name: "", category: "C".repeat(40) }, db));
    assert.ok(defaultNamed.template && defaultNamed.template.name.length <= 80 && defaultNamed.template.name.endsWith("5秒"));
    const pageCodes: string[] = []; let cursor: string | undefined;
    for (;;) { const page = value(await listVideoTemplates("owner", { limit: "1", status: "all", cursor }, db));
      pageCodes.push(...page.templates.map(t => t.code)); cursor = page.next_cursor ?? undefined; if (!cursor) break; }
    assert.equal(new Set(pageCodes).size, pageCodes.length);
    assert.ok(pageCodes.includes("T1000") && pageCodes.includes("T1001"));
    assert.equal(status(await submitVideoFeedback("owner", another.id, { ...input, template_id: "ordinal-999" }, db)), 409,
      "a saved output cannot be silently retargeted to a different template");
    const changed = data(); changed.segments[0].duration = 4;
    const incompatible = await db.videoJob.create({ data: { id: "incompatible", user_id: "owner", source_asset_id: "source", product_asset_id: "product",
      title: "Changed window", status: "completed", stage: "complete", data: changed } });
    assert.equal(status(await submitVideoFeedback("owner", incompatible.id, { ...input, template_id: templateId }, db)), 409);
    await db.videoJob.update({ where: { id: another.id }, data: { status: "generating" } });
    assert.equal(status(await submitVideoFeedback("owner", another.id, input, db)), 409);
  } finally {
    await Promise.all(clients.map(c => c.$disconnect()));
    await cluster.cleanup();
    if (priorStorageRoot === undefined) delete process.env.VIDEO_STORAGE_DIR;
    else process.env.VIDEO_STORAGE_DIR = priorStorageRoot;
    await rm(storageRoot, { recursive: true, force: true });
  }
});
