import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";
import { uploadImageContent, registerExistingImage, verifyOriginalImage } from "../../lib/assets/image-content";
import { getCharacter, listCharacters, saveCharacter, saveCharacterVersion, updateCharacter } from "../../lib/characters/service";
import { extractCharacterBindings, loadJobCharacterImageHashes } from "../../lib/characters/bindings";
import { cancelVideoDraft, createVideoDraft } from "../../lib/video/job-quota";
import { submitVideoFeedback, getVideoTemplate } from "../../lib/video/template-service";
import { getVideoDelivery } from "../../lib/video/delivery-service";
import { parseSixReferencePlan } from "../../lib/video/six-reference-plan";
import { cleanTemplateRecipe, templateStructureSignature } from "../../lib/video/template-recipe";

const enabled = process.env.RUN_VIDEO_DATABASE_TESTS === "1" && process.platform === "win32";
const failure = (code: string, status: number) => ({ code, status });
const saveInput = (key: string, asset_id: string, description = "Blue coat") => ({ idempotency_key: key,
  name: "Mum", category: "Clothing", description, reference_assets: [{ asset_id, label: "Front" }] });
async function migrate(db: PrismaClient, root: string) {
  await db.$executeRawUnsafe(`CREATE TYPE "BackgroundType" AS ENUM ('transparent', 'white', 'simple', 'complex', 'unknown')`);
  await db.$executeRawUnsafe(`CREATE TABLE "UploadedAsset" (
    "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"),
    "image_url" TEXT NOT NULL, "file_type" TEXT NOT NULL, "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL, "background_type" "BackgroundType" NOT NULL DEFAULT 'unknown',
    "detected_lamp_type" TEXT, "quality_warning" TEXT, "size_class" TEXT, "size_hint_cm" INTEGER,
    "shade_diameter_cm" INTEGER, "fixture_height_cm" INTEGER, "cord_or_chain_drop_cm" INTEGER,
    "scale_band" TEXT, "color_temp" TEXT, "target_audience" TEXT, "material_keywords" TEXT,
    "space_fit" TEXT, "ai_inferred_at" TIMESTAMP(3), "planned_shots" JSONB, "planned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.$executeRawUnsafe(`CREATE TABLE "VideoAsset" (
    "id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "storage_key" TEXT NOT NULL UNIQUE,
    "mime" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  for (const migration of ["20261015150000_video_templates_delivery", "20261016010000_character_library"]) {
    const sql = await readFile(path.join(root, "prisma", "migrations", migration, "migration.sql"), "utf8");
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  }
}

test("isolated Postgres character content, saves, versions, ownership and FK retention", { skip: !enabled, timeout: 240_000 }, async () => {
  const root = process.cwd();
  const cluster = await isolatedVideoPostgres({ templateColumn: false });
  const clients: PrismaClient[] = [];
  const client = () => { const db = new PrismaClient({ datasourceUrl: cluster.url }); clients.push(db); return db; };
  const db = client();
  const storage = await mkdtemp(path.join(os.tmpdir(), "lamp-character-content-"));
  const owner = `owner_${Date.now()}`; const stranger = `stranger_${Date.now()}`;
  let writes = 0;
  const io = { write: async (key: string, bytes: Buffer) => {
    writes++;
    const url = `/uploads/${key}`;
    const full = path.join(storage, "public", url.slice(1));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return url;
  } };
  try {
    await migrate(db, root);
    process.chdir(storage);
    await db.$executeRaw`INSERT INTO "User" ("id") VALUES (${owner}), (${stranger})`;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
    const sha = createHash("sha256").update(png).digest("hex");
    const a = client(), b = client();
    const [first, second] = await Promise.all([
      uploadImageContent(owner, png, { db: a, io, background_type: "unknown", quality_warning: "First" }),
      uploadImageContent(owner, png, { db: b, io, background_type: "unknown", quality_warning: "Second" }),
    ]);
    assert.equal(writes, 1, "concurrent identical uploads write one underlying object");
    assert.notEqual(first.asset.id, second.asset.id, "normal product uploads retain independent rows");
    assert.equal(first.asset.image_content_id, second.asset.image_content_id);
    assert.equal(first.content.sha256, sha);
    assert.deepEqual(new Set([first.asset.quality_warning, second.asset.quality_warning]), new Set(["First", "Second"]));
    const third = await uploadImageContent(owner, png, { db, io, reuseAsset: true });
    assert.ok([first.asset.id, second.asset.id].includes(third.asset.id));
    assert.equal(writes, 1);
    const foreign = await uploadImageContent(stranger, png, { db, io });
    assert.notEqual(foreign.content.id, first.content.id, "same bytes remain scoped by account");
    assert.equal(writes, 2);

    const legacyUrl = `/uploads/${owner}/legacy.png`;
    const legacyPath = path.join(storage, "public", legacyUrl.slice(1));
    await mkdir(path.dirname(legacyPath), { recursive: true }); await writeFile(legacyPath, png);
    await db.uploadedAsset.create({ data: { id: "legacy", user_id: owner, image_url: legacyUrl, file_type: "png", width: 8, height: 8 } });
    const registered = await registerExistingImage(owner, "legacy", { db });
    assert.equal(registered.content?.id, first.content.id);
    assert.equal((await db.uploadedAsset.findUniqueOrThrow({ where: { id: "legacy" } })).image_url, legacyUrl);
    assert.equal(writes, 2, "legacy backfill does not write a new object");
    const reuploaded = await uploadImageContent(owner, png, { db, io });
    assert.equal(reuploaded.content.id, first.content.id); assert.equal(writes, 2);
    assert.equal(reuploaded.asset.image_url, first.content.storage_url);

    const input = saveInput("first-key", first.asset.id);
    const [saved1, saved2] = await Promise.all([saveCharacter(owner, input, a), saveCharacter(owner, input, b)]);
    assert.equal(saved1.character.id, saved2.character.id);
    assert.equal(saved1.selected_version.id, saved2.selected_version.id);
    assert.equal(await db.characterProfile.count(), 1); assert.equal(await db.characterVersion.count(), 1);
    assert.equal(await db.characterSaveReceipt.count(), 1);
    assert.equal((await saveCharacter(owner, input, db)).reused, true);
    await assert.rejects(saveCharacter(owner, { ...input, name: "Changed" }, db), failure("character_idempotency_conflict", 409));
    const sameContent = await Promise.all([saveCharacter(owner, saveInput("second-key", first.asset.id), a),
      saveCharacter(owner, saveInput("third-key", first.asset.id), b)]);
    assert.ok(sameContent.every(s => s.reused));
    assert.equal(await db.characterProfile.count(), 1);
    assert.equal(await db.characterVersion.count(), 1);
    assert.equal(await db.characterSaveReceipt.count(), 3);
    await assert.rejects(saveCharacter(owner, { ...saveInput("duplicate-content", first.asset.id),
      reference_assets: [{ asset_id: first.asset.id, label: "Front" }, { asset_id: second.asset.id, label: "Side" }] }, db),
    failure("duplicate_character_image", 400));
    assert.equal(await db.characterSaveReceipt.count(), 3, "rejected save leaves no receipt");
    assert.equal(await db.videoJob.count(), 0); assert.equal(await db.videoJobFeedback.count(), 0);
    assert.equal(await db.videoTemplate.count(), 0); assert.equal(await db.videoPermit.count(), 0);
    await assert.rejects(saveCharacter(owner, saveInput("foreign", foreign.asset.id), db), failure("asset_not_found", 404));
    await assert.rejects(getCharacter(stranger, saved1.character.id, undefined, db), failure("not_found", 404));
    assert.equal((await listCharacters(stranger, {}, db)).characters.length, 0);

    const versionInput = { expected_latest_version_id: saved1.selected_version.id, description: "Blue coat, side view",
      reference_assets: [{ asset_id: first.asset.id, label: "Front" }] };
    const next = await saveCharacterVersion(owner, saved1.character.id, versionInput, db);
    assert.equal(next.selected_version.version, 2);
    const repeated = await saveCharacterVersion(owner, saved1.character.id, versionInput, db);
    assert.equal(repeated.selected_version.id, next.selected_version.id); assert.equal(repeated.character.version_count, 2);
    await assert.rejects(saveCharacterVersion(owner, saved1.character.id, { ...versionInput, description: "Stale new content" }, db),
      failure("character_version_changed", 409));
    await assert.rejects(saveCharacterVersion(stranger, saved1.character.id, versionInput, db), failure("not_found", 404));
    const archived = await updateCharacter(owner, saved1.character.id, { archived: true }, db);
    assert.equal(archived.character.archived, true);
    assert.equal((await listCharacters(owner, {}, db)).characters.length, 0);
    assert.equal((await listCharacters(owner, { status: "archived" }, db)).characters.length, 1);
    assert.equal((await getCharacter(owner, saved1.character.id, saved1.selected_version.id, db)).selected_version.version, 1);
    await assert.rejects(saveCharacterVersion(owner, saved1.character.id, { ...versionInput,
      expected_latest_version_id: next.selected_version.id, description: "Third" }, db), failure("character_archived", 409));
    await assert.rejects(db.uploadedAsset.delete({ where: { id: first.asset.id } }), /violates RESTRICT setting/);
    await assert.rejects(db.imageContent.delete({ where: { id: first.content.id } }), /violates RESTRICT setting/);

    const jobData = { version: 1, imageCalls: 0, generationMode: "six_references", workflowProfile: "sixref-v1",
      referenceImages: [{ assetId: first.asset.id, role: "character", label: "Person" }],
      segments: [{ index: 0, start: 0, sourceWindowDuration: 5, duration: 5, trimStart: 0, attempt: 0, instructions: "Walk",
        beforeState: "Standing", afterState: "Walking", referenceImages: [{ assetId: first.asset.id, role: "character", label: "Person" }] }] };
    const draftInput = { source_asset_id: "source", product_asset_id: "product", title: "Character draft",
      instructions: "Walk", preserve_audio: true, stage: "waiting", data: jobData as any,
      character_bindings: [{ segment_index: -1, reference_index: 0, asset_id: first.asset.id,
        character_version_id: saved1.selected_version.id, image_index: 0 }] };
    const archivedDraft = await createVideoDraft(owner, draftInput, { db });
    assert.equal(archivedDraft.ok, false);
    if (!archivedDraft.ok) assert.equal(archivedDraft.body.error, "character_archived");
    await updateCharacter(owner, saved1.character.id, { archived: false }, db);
    const draft = await createVideoDraft(owner, draftInput, { db });
    assert.equal(draft.ok, true, JSON.stringify(draft));
    if (!draft.ok) throw new Error(JSON.stringify(draft));
    const hashes = await loadJobCharacterImageHashes(db, owner, draft.value.id, jobData as any);
    assert.equal(hashes.get(first.asset.id), sha);
    assert.doesNotThrow(() => verifyOriginalImage(png, hashes.get(first.asset.id)!));
    assert.throws(() => verifyOriginalImage(Buffer.from("changed image bytes"), hashes.get(first.asset.id)!),
      failure("image_content_changed", 409));
    assert.equal(await db.videoPermit.count(), 0, "fixed-pin validation creates no paid permit");
    const cancellation = await cancelVideoDraft(owner, draft.value.id, { db });
    assert.equal(cancellation.ok, true, JSON.stringify(cancellation));
    assert.equal((await db.videoJobCharacterBinding.findMany({ where: { job_id: draft.value.id } })).length, 1,
      "cancelled jobs retain their immutable character pin");

    const source = await db.videoAsset.create({ data: { id: "template-source", user_id: owner,
      storage_key: `videos/${owner}/source.mp4`, mime: "video/mp4", size_bytes: 100, status: "ready", sha256: "a".repeat(64) } });
    const bothPins = [-1, 0].map(segment_index => ({ segment_index, reference_index: 0, asset_id: first.asset.id,
      character_version_id: saved1.selected_version.id, image_index: 0 }));
    const completedDraft = await createVideoDraft(owner, { ...draftInput, source_asset_id: source.id,
      title: "Character action", character_bindings: bothPins }, { db });
    assert.equal(completedDraft.ok, true, JSON.stringify(completedDraft));
    if (!completedDraft.ok) throw new Error(JSON.stringify(completedDraft));
    const outputSha = "c".repeat(64);
    const completedData = { ...jobData, sourceDuration: 5, outputKey: `videos/${owner}/finished.mp4`, outputSha256: outputSha,
      segments: [{ ...jobData.segments[0], accepted: true, candidateKey: `videos/${owner}/candidate.mp4`,
        candidateSha256: "d".repeat(64) }] };
    await db.videoJob.update({ where: { id: completedDraft.value.id }, data: { status: "completed", stage: "complete", data: completedData } });
    const expectedRecipe = cleanTemplateRecipe({ source_asset_id: source.id, product_asset_id: "product",
      title: "Character action", instructions: "Walk", preserve_audio: true, data: completedData as any });
    const expectedSignature = templateStructureSignature(expectedRecipe, source.sha256!);
    const feedback = await submitVideoFeedback(owner, completedDraft.value.id, { decision: "satisfied_save_template",
      output_sha256: outputSha, name: "Walk" }, db);
    assert.equal(feedback.ok, true, JSON.stringify(feedback));
    if (!feedback.ok || !feedback.value.version_id || !feedback.value.template) throw new Error(JSON.stringify(feedback));
    const templateVersionId = feedback.value.version_id;
    const templateId = feedback.value.template.id;
    const stored = await db.videoTemplateVersion.findUniqueOrThrow({ where: { id: templateVersionId } });
    assert.equal(stored.recipe_schema_version, 2);
    assert.equal(stored.structure_signature, expectedSignature);
    assert.equal((await db.videoTemplate.findUniqueOrThrow({ where: { id: templateId } })).structure_signature, expectedSignature);
    assert.deepEqual((await db.videoTemplateCharacterBinding.findMany({ where: { template_version_id: templateVersionId },
      orderBy: { segment_index: "asc" } })).map(p => p.segment_index), [-1, 0]);
    const storedText = JSON.stringify(stored.create_payload);
    assert.ok(!storedText.includes(first.asset.id), "pinned slot stores no duplicate asset ID");
    assert.ok(!storedText.includes("Blue coat"), "template does not copy character description");
    const detail = await getVideoTemplate(owner, templateId, undefined, db);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    if (!detail.ok) throw new Error(JSON.stringify(detail));
    const resolved = detail.value.selected_version.create_payload;
    assert.equal(resolved.reference_assets[0].asset_id, first.asset.id);
    assert.equal((resolved.reference_assets[0] as any).character_version_id, saved1.selected_version.id);
    assert.equal(detail.value.selected_version.character_bindings[0].code, saved1.character.code);
    const delivery = await getVideoDelivery(owner, completedDraft.value.id, db);
    assert.equal(delivery.ok, true);
    if (!delivery.ok) throw new Error(JSON.stringify(delivery));
    assert.deepEqual(delivery.value.character_references.map(r => ({ asset_id: r.asset_id, sha256: r.sha256,
      character_version_id: r.character_version_id })), [{ asset_id: first.asset.id, sha256: sha,
      character_version_id: saved1.selected_version.id }]);
    await updateCharacter(owner, saved1.character.id, { archived: true }, db);
    const reusedData = parseSixReferencePlan(resolved as any);
    const selections = extractCharacterBindings(resolved as any);
    assert.deepEqual(selections.map(s => s.segment_index), [-1, 0]);
    const reuseInput = { source_asset_id: source.id, product_asset_id: resolved.product_asset_id,
      title: resolved.title, instructions: resolved.instructions, preserve_audio: resolved.preserve_audio,
      stage: "waiting", data: reusedData, template_version_id: templateVersionId, character_bindings: selections };
    const fixedReuse = await createVideoDraft(owner, reuseInput, { db });
    assert.equal(fixedReuse.ok, true, JSON.stringify(fixedReuse));
    if (!fixedReuse.ok) throw new Error(JSON.stringify(fixedReuse));
    assert.equal(await db.videoJobCharacterBinding.count({ where: { job_id: fixedReuse.value.id } }), 2);
    assert.equal((await cancelVideoDraft(owner, fixedReuse.value.id, { db })).ok, true);
    const omitted = await createVideoDraft(owner, { ...reuseInput, character_bindings: [] }, { db });
    assert.equal(omitted.ok, false);
    if (!omitted.ok) assert.deepEqual([omitted.status, omitted.body.error], [409, "character_binding_required"]);
    const nullSelections = selections.map(s => ({ ...s, character_version_id: null, image_index: undefined }));
    const detached = await createVideoDraft(owner, { ...reuseInput, character_bindings: nullSelections }, { db });
    assert.equal(detached.ok, true, JSON.stringify(detached));
    if (!detached.ok) throw new Error(JSON.stringify(detached));
    assert.equal(await db.videoJobCharacterBinding.count({ where: { job_id: detached.value.id } }), 0);
    assert.equal((await cancelVideoDraft(owner, detached.value.id, { db })).ok, true);
    const changedVersion = await createVideoDraft(owner, { ...reuseInput,
      character_bindings: selections.map(s => ({ ...s, character_version_id: next.selected_version.id })) }, { db });
    assert.equal(changedVersion.ok, false);
    if (!changedVersion.ok) assert.deepEqual([changedVersion.status, changedVersion.body.error], [409, "character_archived"]);
    const mismatched = await createVideoDraft(owner, { ...reuseInput,
      data: { ...reusedData, referenceImages: [{ assetId: second.asset.id, role: "character", label: "Person" }] } as any,
      character_bindings: [{ ...selections[0], asset_id: second.asset.id }, selections[1]] }, { db });
    assert.equal(mismatched.ok, false);
    if (!mismatched.ok) assert.equal(mismatched.body.error, "character_image_mismatch");
    const archivedDelivery = await getVideoDelivery(owner, completedDraft.value.id, db);
    assert.equal(archivedDelivery.ok, true);
    if (archivedDelivery.ok) assert.equal(archivedDelivery.value.character_references[0].sha256, sha);

    await db.characterProfile.create({ data: { id: "ordinal-999", user_id: owner, code: "C999", name: "Historical" } });
    const otherBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
    const otherAsset = await uploadImageContent(owner, otherBytes, { db, io });
    const thousand = await saveCharacter(owner, saveInput("thousand", otherAsset.asset.id), db);
    assert.equal(thousand.character.code, "C1000");
    const codes: string[] = []; let cursor: string | undefined;
    do { const page = await listCharacters(owner, { status: "all", limit: "1", cursor }, db);
      codes.push(...page.characters.map(c => c.code)); cursor = page.next_cursor ?? undefined; } while (cursor);
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(codes.includes("C1000") && codes.includes("C999"));
  } finally {
    process.chdir(root);
    await Promise.all(clients.map(c => c.$disconnect()));
    await cluster.cleanup();
    assert.equal(path.dirname(path.resolve(storage)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(storage).startsWith("lamp-character-"));
    await rm(storage, { recursive: true, force: true });
  }
});
