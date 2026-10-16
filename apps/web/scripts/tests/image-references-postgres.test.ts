import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import type { ImageAssetReference } from "../../lib/image-reference-contract";
import { isolatedVideoPostgres } from "./helpers/isolated-video-postgres";

const enabled = process.env.RUN_IMAGE_DATABASE_TESTS === "1" && process.platform === "win32";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function schema(db: PrismaClient) {
  for (const [name, values] of Object.entries({ Role: ["USER", "ADMIN"], BackgroundType: ["transparent", "white", "simple", "complex", "unknown"],
    PlatformStyle: ["domestic_ecommerce", "brand_site"], AspectRatio: ["ratio_1_1", "ratio_4_5", "ratio_16_9"],
    SceneKind: ["recommended", "template", "custom", "profile"], JobStatus: ["created", "uploading", "generating", "completed", "failed"],
    CreditTxType: ["grant", "consume", "refund", "manual_adjustment"] })) {
    await db.$executeRawUnsafe(`CREATE TYPE "${name}" AS ENUM (${values.map(v => `'${v}'`).join(", ")})`);
  }
  const statements = [
    `CREATE TABLE "ApiKey" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "name" TEXT NOT NULL DEFAULT 'WorkBuddy',
      "key_prefix" TEXT NOT NULL, "key_hash" TEXT NOT NULL UNIQUE, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_used_at" TIMESTAMP(3), "revoked_at" TIMESTAMP(3))`,
    `CREATE TABLE "ImageContent" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "sha256" TEXT NOT NULL,
      "storage_url" TEXT NOT NULL, "mime" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL, "width" INTEGER NOT NULL,
      "height" INTEGER NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "UploadedAsset" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "image_url" TEXT NOT NULL,
      "image_content_id" TEXT REFERENCES "ImageContent"("id"), "file_type" TEXT NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL,
      "background_type" "BackgroundType" NOT NULL DEFAULT 'unknown', "detected_lamp_type" TEXT, "quality_warning" TEXT,
      "size_class" TEXT, "size_hint_cm" INTEGER, "shade_diameter_cm" INTEGER, "fixture_height_cm" INTEGER, "cord_or_chain_drop_cm" INTEGER,
      "scale_band" TEXT, "color_temp" TEXT, "target_audience" TEXT, "material_keywords" TEXT, "space_fit" TEXT,
      "ai_inferred_at" TIMESTAMP(3), "planned_shots" JSONB, "planned_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "CharacterProfile" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"), "code" TEXT NOT NULL,
      "name" TEXT NOT NULL, "category" TEXT NOT NULL DEFAULT '', "archived" BOOLEAN NOT NULL DEFAULT false,
      "latest_version_id" TEXT, "version_count" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "CharacterVersion" ("id" TEXT PRIMARY KEY, "character_id" TEXT NOT NULL REFERENCES "CharacterProfile"("id"),
      "version" INTEGER NOT NULL, "description" TEXT NOT NULL, "content_digest" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "CharacterVersionImage" ("version_id" TEXT NOT NULL REFERENCES "CharacterVersion"("id"), "position" INTEGER NOT NULL,
      "asset_id" TEXT NOT NULL REFERENCES "UploadedAsset"("id"), "image_content_id" TEXT NOT NULL REFERENCES "ImageContent"("id"),
      "label" TEXT NOT NULL, PRIMARY KEY ("version_id", "position"))`,
    `CREATE TABLE "Template" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "category" TEXT NOT NULL, "lamp_type" TEXT NOT NULL,
      "scene_space" TEXT NOT NULL, "preview_image_url" TEXT NOT NULL, "prompt_template" TEXT NOT NULL,
      "is_active" BOOLEAN NOT NULL DEFAULT true, "sort_order" INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "GenerationJob" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"),
      "uploaded_asset_id" TEXT NOT NULL REFERENCES "UploadedAsset"("id"), "template_id" TEXT REFERENCES "Template"("id"),
      "scene_kind" "SceneKind" NOT NULL DEFAULT 'template', "prompt_text" TEXT, "platform_style" "PlatformStyle" NOT NULL,
      "aspect_ratio" "AspectRatio" NOT NULL, "credit_cost" INTEGER NOT NULL DEFAULT 4, "status" "JobStatus" NOT NULL DEFAULT 'created',
      "failure_reason" TEXT, "provider_job_id" TEXT, "stage_hint" TEXT, "metadata" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "OutputImage" ("id" TEXT PRIMARY KEY, "job_id" TEXT NOT NULL REFERENCES "GenerationJob"("id"),
      "image_url" TEXT NOT NULL, "thumbnail_url" TEXT, "quality_score" DOUBLE PRECISION, "is_downloaded" BOOLEAN NOT NULL DEFAULT false,
      "downloaded_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "CreditTransaction" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id"),
      "type" "CreditTxType" NOT NULL, "amount" INTEGER NOT NULL, "related_job_id" TEXT REFERENCES "GenerationJob"("id"),
      "note" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE "ToolCallLog" ("id" TEXT PRIMARY KEY, "tool" TEXT NOT NULL, "model" TEXT, "job_id" TEXT, "asset_id" TEXT,
      "status" TEXT NOT NULL, "http_status" INTEGER, "duration_ms" INTEGER, "error" TEXT, "result_json" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  ];
  for (const sql of statements) await db.$executeRawUnsafe(sql);
}

test("actual image generation pins ordered references, charges outputs, and rejects invalid inputs before charge", { skip: !enabled, timeout: 240_000 }, async () => {
  const root = process.cwd();
  const cluster = await isolatedVideoPostgres();
  const db = new PrismaClient({ datasourceUrl: cluster.url });
  const storage = await mkdtemp(path.join(os.tmpdir(), "lamp-image-references-"));
  const priorFetch = globalThis.fetch;
  const priorGlobal = global.prismaGlobal;
  const priorKey = process.env.OPENLUX_API_KEY;
  const priorR2 = Object.fromEntries(["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT"].map(k => [k, process.env[k]]));
  const calls: Array<{ url: string; body: unknown }> = [];
  let failProvider = false;
  try {
    process.chdir(storage);
    global.prismaGlobal = db;
    process.env.OPENLUX_API_KEY = "offline-test-placeholder";
    for (const key of Object.keys(priorR2)) delete process.env[key];
    await schema(db);
    const { createAndRunGenerationJob } = await import("../../lib/generation");
    const { generateApiKey } = await import("../../lib/api-key");
    const { POST: postImageJob } = await import("../../app/api/v1/image-jobs/route");
    const { GET: getJob } = await import("../../app/api/v1/jobs/[id]/route");
    const owner = "owner", stranger = "stranger";
    await db.user.createMany({ data: [{ id: owner, credit_balance: 20 }, { id: stranger, credit_balance: 20 }] });
    const asset = async (user: string, id: string, color: string, overrideBytes?: Buffer) => {
      const bytes = overrideBytes ?? await sharp({ create: { width: 9, height: 9, channels: 3, background: color } }).png().toBuffer();
      const sha = digest(bytes), url = `/uploads/${user}/${sha}.png`;
      const file = path.join(storage, "public", url.slice(1));
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
      const content = await db.imageContent.create({ data: { id: `content_${id}`, user_id: user, sha256: sha,
        storage_url: url, mime: "image/png", size_bytes: bytes.length, width: 9, height: 9 } });
      const row = await db.uploadedAsset.create({ data: { id, user_id: user, image_url: url, image_content_id: content.id,
        file_type: "png", width: 9, height: 9 } });
      return { row, bytes, sha, file };
    };
    const mother = await asset(owner, "mother", "#e35d5d");
    const baby = await asset(owner, "baby", "#e9b86b");
    const product = await asset(owner, "product", "#475dbb");
    const scene = await asset(owner, "scene", "#83a4a0");
    const foreign = await asset(stranger, "foreign", "#777777");
    const duplicate = await asset(owner, "duplicate", "#e35d5d", mother.bytes);
    await db.characterProfile.create({ data: { id: "family", user_id: owner, code: "C001", name: "Family" } });
    await db.characterVersion.createMany({ data: [
      { id: "version_mother", character_id: "family", version: 1, description: "Mother", content_digest: "mother" },
      { id: "version_baby", character_id: "family", version: 2, description: "Baby", content_digest: "baby" },
    ] });
    await db.characterVersionImage.createMany({ data: [
      { version_id: "version_mother", position: 0, asset_id: mother.row.id, image_content_id: "content_mother", label: "Mother" },
      { version_id: "version_baby", position: 0, asset_id: baby.row.id, image_content_id: "content_baby", label: "Baby" },
    ] });
    const refs: ImageAssetReference[] = [
      { asset_id: mother.row.id, role: "character" as const, label: "mother", character_version_id: "version_mother", image_index: 0 },
      { asset_id: baby.row.id, role: "character" as const, label: "baby", character_version_id: "version_baby", image_index: 0 },
      { asset_id: product.row.id, role: "product" as const, label: "toy" },
      { asset_id: scene.row.id, role: "scene" as const, label: "nursery" },
    ];
    const pngOutput = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://api.openlux.ai/")) throw new Error(`Unexpected network request: ${url}`);
      calls.push({ url, body: init?.body });
      if (failProvider) return new Response("unavailable", { status: 503 });
      return Response.json(url.includes("generateContent")
        ? { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: pngOutput.toString("base64") } }] } }] }
        : { data: [{ b64_json: pngOutput.toString("base64") }] });
    }) as typeof fetch;
    const run = (referenceAssets: typeof refs, extra: Record<string, unknown> = {}) => createAndRunGenerationJob({
      userId: owner, uploadedAssetId: referenceAssets[0]?.asset_id ?? mother.row.id, referenceAssets,
      customPrompt: "Family playing with the toy in a nursery", imageCount: 2,
      platformStyle: "brand_site", aspectRatio: "1_1", imageModel: "nano_banana_21", ...extra,
    } as Parameters<typeof createAndRunGenerationJob>[0]);
    const baseline = async () => ({ jobs: await db.generationJob.count(), tx: await db.creditTransaction.count(),
      balance: (await db.user.findUniqueOrThrow({ where: { id: owner } })).credit_balance, calls: calls.length });
    const rejectWithoutSideEffects = async (expected: string, referenceAssets: typeof refs, extra: Record<string, unknown> = {}) => {
      const before = await baseline();
      const result = await run(referenceAssets, extra);
      assert.deepEqual(result, { ok: false, reason: expected, status: result.ok ? undefined : result.status });
      assert.deepEqual(await baseline(), before, expected);
    };
    const success = await run(refs);
    assert.equal(success.ok, true, JSON.stringify(success));
    if (!success.ok) throw new Error(JSON.stringify(success));
    const firstJob = await db.generationJob.findUniqueOrThrow({ where: { id: success.jobId }, include: { outputs: true, credit_txs: true } });
    assert.equal(firstJob.status, "completed"); assert.equal(firstJob.credit_cost, 2); assert.equal(firstJob.outputs.length, 2);
    assert.deepEqual(firstJob.credit_txs.map(t => [t.type, t.amount]), [["consume", -2]]);
    const meta = firstJob.metadata as Record<string, unknown>;
    assert.equal(meta.reference_count, 4); assert.equal(meta.image_count, 2); assert.equal(meta.reference_schema_version, 1);
    assert.deepEqual(meta.billing, { mode: "standard", quoted_credits: 2, charged_credits: 2 });
    const firstUsage = meta.usage as { provider_attempts: Array<{ status: string; image_ready: boolean; tokens: { total_tokens: number } }> };
    assert.equal(firstUsage.provider_attempts.length, 2);
    assert.ok(firstUsage.provider_attempts.every(attempt => attempt.status === "response_received" && attempt.image_ready && attempt.tokens.total_tokens === 19));
    assert.deepEqual(meta.reference_assets, refs.map((ref, i) => ({ ...ref, sha256: [mother, baby, product, scene][i].sha })));
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.match(call.url, /gemini-nano-banana-2\.1:generateContent$/);
      const parts = (JSON.parse(call.body as string).contents[0].parts as Array<Record<string, any>>);
      assert.match(parts[0].text, /Image 1: role=character; label="mother"/);
      assert.match(parts[0].text, /Image 4: role=scene; label="nursery"/);
      assert.doesNotMatch(parts[0].text, /lamp appearance|room_reference=|prompt_planner=/i);
      assert.equal(parts.length, 5);
      const actual = parts.slice(1).map(p => digest(Buffer.from(p.inlineData.data, "base64")));
      const expected = await Promise.all([mother, baby, product, scene].map(async a => digest(await sharp(a.bytes).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer())));
      assert.deepEqual(actual, expected, "each output preserves ordered distinct references");
    }
    const ownerKey = generateApiKey(), strangerKey = generateApiKey();
    await db.apiKey.createMany({ data: [
      { id: "owner_key", user_id: owner, key_prefix: ownerKey.prefix, key_hash: ownerKey.hash },
      { id: "stranger_key", user_id: stranger, key_prefix: strangerKey.prefix, key_hash: strangerKey.hash },
    ] });
    const apiBody = { reference_assets: refs, custom_prompt: "Family playing with the toy in a nursery",
      image_count: 1, platform_style: "brand_site", aspect_ratio: "1_1", image_model: "image_25" };
    const apiRequest = (url: string, key?: string, body?: unknown) => new NextRequest(url, {
      method: body === undefined ? "GET" : "POST", headers: { ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const anonymous = (await postImageJob(apiRequest("http://localhost/api/v1/image-jobs", undefined, apiBody)))!;
    assert.equal(anonymous.status, 401);
    const apiResponse = (await postImageJob(apiRequest("http://localhost/api/v1/image-jobs", ownerKey.secret, apiBody)))!;
    assert.equal(apiResponse.status, 202, await apiResponse.clone().text());
    const apiCreated = await apiResponse.json();
    assert.equal(apiCreated.status, "completed"); assert.equal(apiCreated.image_count, 1); assert.equal(apiCreated.reference_count, 4);
    assert.equal(calls.length, 3);
    const multipart = calls[2].body;
    assert.match(calls[2].url, /\/v1\/images\/edits$/);
    assert.ok(multipart instanceof FormData);
    assert.equal(multipart.get("model"), "gpt-image-2-c");
    assert.match(String(multipart.get("prompt")), /Image 1: role=character; label="mother"/);
    const multipartImages = multipart.getAll("image[]");
    assert.equal(multipartImages.length, 4);
    const gptDigests = await Promise.all(multipartImages.map(async entry => digest(Buffer.from(await (entry as Blob).arrayBuffer()))));
    const expectedDigests = await Promise.all([mother, baby, product, scene].map(async a => digest(await sharp(a.bytes).rotate()
      .resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer())));
    assert.deepEqual(gptDigests, expectedDigests);
    const ownerGet = (await getJob(apiRequest(`http://localhost/api/v1/jobs/${apiCreated.job_id}`, ownerKey.secret), { params: { id: apiCreated.job_id } }))!;
    assert.equal(ownerGet.status, 200);
    const detail = await ownerGet.json();
    assert.equal(detail.image_count, 1); assert.equal(detail.reference_count, 4); assert.equal(detail.outputs.length, 1);
    assert.deepEqual(detail.reference_assets, refs.map((ref, i) => ({ ...ref, sha256: [mother, baby, product, scene][i].sha })));
    assert.equal((await getJob(apiRequest(`http://localhost/api/v1/jobs/${apiCreated.job_id}`, strangerKey.secret),
      { params: { id: apiCreated.job_id } }))!.status, 404);
    assert.equal((await getJob(apiRequest(`http://localhost/api/v1/jobs/${apiCreated.job_id}`),
      { params: { id: apiCreated.job_id } }))!.status, 401);
    await rejectWithoutSideEffects("asset_not_found", [refs[0], { ...refs[1], asset_id: foreign.row.id }, refs[2], refs[3]]);
    await rejectWithoutSideEffects("asset_not_found", [refs[0], { ...refs[1], asset_id: "missing" }, refs[2], refs[3]]);
    await rejectWithoutSideEffects("duplicate_reference_asset", [refs[0], refs[0], refs[2], refs[3]]);
    await rejectWithoutSideEffects("duplicate_reference_image", [refs[0], { asset_id: duplicate.row.id, role: "character", label: "copy" }, refs[2], refs[3]]);
    await rejectWithoutSideEffects("character_image_mismatch", [{ ...refs[0], character_version_id: "version_baby" }, ...refs.slice(1)]);
    await rejectWithoutSideEffects("bad_image_count", refs, { imageCount: 0 });
    await rejectWithoutSideEffects("bad_reference_assets", [], { uploadedAssetId: mother.row.id });
    await rejectWithoutSideEffects("bad_reference_assets", Array.from({ length: 7 }, (_, i) => ({ ...refs[i % 4], asset_id: `extra_${i}` })));
    await rejectWithoutSideEffects("reference_scene_conflict", refs, { sceneKind: "template" });
    await writeFile(scene.file, Buffer.from("not an image"));
    await rejectWithoutSideEffects("invalid_image", refs);
    await writeFile(scene.file, scene.bytes);
    const alteredScene = await sharp({ create: { width: 9, height: 9, channels: 3, background: "#ffaadd" } }).png().toBuffer();
    await writeFile(scene.file, alteredScene);
    await rejectWithoutSideEffects("image_content_changed", refs);
    await writeFile(scene.file, scene.bytes);
    await rm(scene.file);
    await rejectWithoutSideEffects("reference_image_unavailable", refs);
    await writeFile(scene.file, scene.bytes);
    await db.imageContent.update({ where: { id: "content_scene" }, data: { sha256: "0".repeat(64) } });
    await rejectWithoutSideEffects("image_content_changed", refs);
    await db.imageContent.update({ where: { id: "content_scene" }, data: { sha256: scene.sha } });
    await db.characterProfile.update({ where: { id: "family" }, data: { archived: true } });
    await rejectWithoutSideEffects("character_archived", refs);
    await db.characterProfile.update({ where: { id: "family" }, data: { archived: false } });
    const secondVersion = await db.characterVersion.create({ data: { id: "version_latest", character_id: "family", version: 3,
      description: "Later library version", content_digest: "later" } });
    assert.equal(secondVersion.version, 3);
    assert.deepEqual((await db.generationJob.findUniqueOrThrow({ where: { id: success.jobId } })).metadata, meta,
      "later character library changes do not rewrite the job snapshot");
    const beforeFailure = await baseline();
    failProvider = true;
    const failure = await run(refs);
    assert.equal(failure.ok, true);
    if (!failure.ok) throw new Error(JSON.stringify(failure));
    const failedJob = await db.generationJob.findUniqueOrThrow({ where: { id: failure.jobId }, include: { outputs: true, credit_txs: true } });
    assert.equal(failedJob.status, "failed"); assert.equal(failedJob.outputs.length, 0);
    assert.deepEqual(failedJob.credit_txs.map(t => [t.type, t.amount]), [["consume", -2], ["refund", 2]]);
    const afterFailure = await baseline();
    assert.equal(afterFailure.balance, beforeFailure.balance); assert.equal(afterFailure.calls - beforeFailure.calls, 2);

    // Zero-balance internal test accounts use the real generation path without
    // manufacturing consume/refund ledger entries. Their usage remains durable.
    await db.user.update({ where: { id: owner }, data: { credit_balance: 0, credits_unlimited: true } });
    failProvider = false;
    const free = await run(refs);
    assert.equal(free.ok, true);
    if (!free.ok) throw new Error("free job rejected");
    const freeJob = await db.generationJob.findUniqueOrThrow({ where: { id: free.jobId }, include: { outputs: true, credit_txs: true } });
    assert.equal(freeJob.outputs.length, 2); assert.equal(freeJob.credit_txs.length, 0);
    assert.deepEqual((freeJob.metadata as any).billing, { mode: "internal_test", quoted_credits: 2, charged_credits: 0 });
    assert.equal((freeJob.metadata as any).usage.provider_attempts.length, 2);
    assert.equal((await baseline()).balance, 0);
    failProvider = true;
    const freeFailed = await run(refs);
    if (!freeFailed.ok) throw new Error("free failure job rejected");
    const freeFailedJob = await db.generationJob.findUniqueOrThrow({ where: { id: freeFailed.jobId }, include: { credit_txs: true } });
    assert.equal(freeFailedJob.status, "failed"); assert.equal(freeFailedJob.credit_txs.length, 0);
    assert.equal((await baseline()).balance, 0);

    const { refundCredits } = await import("../../lib/credits");
    // A real debit is refundable even after unlimited mode is enabled, once only.
    await Promise.all([1, 2].map(() => db.$transaction(tx => refundCredits(tx, owner, 2, firstJob.id))));
    assert.equal((await baseline()).balance, 2);
    await db.user.update({ where: { id: owner }, data: { credit_balance: 0, credits_unlimited: false } });
    await db.$transaction(tx => refundCredits(tx, owner, 2, free.jobId));
    assert.equal((await baseline()).balance, 0, "turning off unlimited cannot refund a free job");
    const beforeRejected = await baseline();
    assert.deepEqual(await run(refs), { ok: false, reason: "insufficient_credits" });
    assert.deepEqual(await baseline(), beforeRejected, "ordinary account is still blocked before a provider call");

    const { getAccountUsage } = await import("../../lib/billing/usage");
    for (const [id, user] of [["owner_video", owner], ["foreign_video", stranger]]) {
      await db.videoJob.create({ data: { id, user_id: user, source_asset_id: "source", product_asset_id: "product",
        title: "fixture", status: "draft", data: { generationMode: "six_references", segments: [{ index: 0, duration: 4 }] } } });
      await db.videoPermit.create({ data: { attempt_id: `${id}_attempt`, account_id: "fixture-provider", job_id: id,
        segment_index: 0, max_coins: 50, reserved_coins: 20, status: "released", released_at: new Date() } });
    }
    const ownerUsage = await getAccountUsage(owner, db), foreignUsage = await getAccountUsage(stranger, db);
    assert.equal(ownerUsage.totals.image_jobs, await db.generationJob.count({ where: { user_id: owner } }));
    assert.equal(ownerUsage.totals.delivered_images, await db.outputImage.count());
    assert.equal(ownerUsage.totals.video_attempts_reserved, 1); assert.equal(ownerUsage.totals.video_jobs, 1);
    assert.equal(ownerUsage.recent_videos[0].planned_duration_seconds, 4);
    assert.equal(ownerUsage.recent_videos[0].actual_video_coins, null);
    assert.equal(foreignUsage.totals.image_jobs, 0); assert.equal(foreignUsage.recent_images.length, 0);
    assert.ok(!JSON.stringify(foreignUsage).includes("owner_video"));
    assert.ok(ownerUsage.recent_images.find(job => job.id === free.jobId)?.billing.charged_credits === 0);
  } finally {
    globalThis.fetch = priorFetch;
    global.prismaGlobal = priorGlobal;
    if (priorKey === undefined) delete process.env.OPENLUX_API_KEY; else process.env.OPENLUX_API_KEY = priorKey;
    for (const [key, value] of Object.entries(priorR2)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    process.chdir(root);
    await db.$disconnect(); await cluster.cleanup();
    assert.equal(path.dirname(path.resolve(storage)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(storage).startsWith("lamp-image-references-"));
    await rm(storage, { recursive: true, force: true });
  }
});
