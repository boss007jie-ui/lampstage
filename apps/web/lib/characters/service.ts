import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { registerExistingImage } from "../assets/image-content";
import type { CharacterSummary, CharacterVersionDetail, CharacterDetail, CharacterSaveResponse } from "./contracts";

export class CharacterError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export const characterId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const bad = (code = "invalid_character_request", status = 400): never => { throw new CharacterError(code, status); };
function text(v: unknown, max: number, required = false, multiline = false): string {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()) ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v)) return bad();
  return v.trim();
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return bad();
  return v as Record<string, unknown>;
}
function versionInput(raw: Record<string, unknown>) {
  const description = text(raw.description ?? "", 2000, false, true);
  if (!Array.isArray(raw.reference_assets) || raw.reference_assets.length < 1 || raw.reference_assets.length > 6) return bad();
  const reference_assets = raw.reference_assets.map(v => {
    const r = object(v, ["asset_id", "label"]);
    if (!characterId(r.asset_id)) return bad();
    return { asset_id: r.asset_id, label: text(r.label, 80, true) };
  });
  if (new Set(reference_assets.map(r => r.asset_id)).size !== reference_assets.length) return bad("duplicate_character_image");
  return { description, reference_assets };
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const versionInclude = { images: { orderBy: { position: "asc" as const }, include: { asset: true, image_content: true } } };
type VersionRow = Prisma.CharacterVersionGetPayload<{ include: typeof versionInclude }>;
const summaryInclude = { versions: { orderBy: { version: "desc" as const }, take: 1, include: versionInclude } };
type ProfileRow = Prisma.CharacterProfileGetPayload<{ include: typeof summaryInclude }>;
function summary(row: ProfileRow): CharacterSummary {
  return { id: row.id, code: row.code, name: row.name, category: row.category, archived: row.archived,
    latest_version_id: row.latest_version_id ?? "", version_count: row.version_count,
    reference_count: row.versions[0]?.images.length ?? 0, cover_url: row.versions[0]?.images[0]?.asset.image_url ?? null,
    created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() };
}
function detail(row: VersionRow): CharacterVersionDetail {
  return { id: row.id, version: row.version, description: row.description, content_digest: row.content_digest,
    created_at: row.created_at.toISOString(), reference_assets: row.images.map(i => ({ index: i.position, asset_id: i.asset_id,
      label: i.label, image_url: i.asset.image_url, sha256: i.image_content.sha256, size_bytes: i.image_content.size_bytes,
      width: i.image_content.width, height: i.image_content.height })) };
}
export function pageQuery(query: Record<string, string | undefined>, allowed: string[]) {
  if (Object.keys(query).some(k => !allowed.includes(k))) return bad("invalid_character_query");
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (query.limit !== undefined && !/^\d+$/.test(query.limit))) return bad("invalid_character_query");
  let cursor: { id: string; created_at: Date } | undefined;
  if (query.cursor !== undefined) {
    try {
      if (query.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      const c = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (c.v !== 1 || !characterId(c.id) || typeof c.created_at !== "string" || new Date(c.created_at).toISOString() !== c.created_at) throw new Error();
      cursor = { id: c.id, created_at: new Date(c.created_at) };
    } catch { return bad("invalid_character_cursor"); }
  }
  return { limit, cursorWhere: cursor ? { OR: [{ created_at: { lt: cursor.created_at } }, { created_at: cursor.created_at, id: { lt: cursor.id } }] } : {} };
}
export function nextCursor(rows: { id: string; created_at: Date }[], limit: number) {
  const last = rows[limit - 1];
  return rows.length > limit && last ? Buffer.from(JSON.stringify({ v: 1, id: last.id, created_at: last.created_at.toISOString() })).toString("base64url") : null;
}
export async function listCharacters(userId: string, query: Record<string, string | undefined>, db: PrismaClient = prisma) {
  const { limit, cursorWhere } = pageQuery(query, ["limit", "cursor", "status", "q"]);
  const status = query.status ?? "active";
  if (!["active", "archived", "all"].includes(status)) return bad("invalid_character_query");
  const q = query.q === undefined ? "" : text(query.q, 80);
  const rows = await db.characterProfile.findMany({ where: { user_id: userId, ...(status === "all" ? {} : { archived: status === "archived" }),
    AND: [cursorWhere, ...(q ? [{ OR: [{ code: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] }] : [])] },
    orderBy: [{ created_at: "desc" }, { id: "desc" }], take: limit + 1, include: summaryInclude });
  return { characters: rows.slice(0, limit).map(summary), next_cursor: nextCursor(rows, limit) };
}
export async function getCharacter(userId: string, id: string, versionId?: string, db: PrismaClient = prisma): Promise<CharacterDetail> {
  if (!characterId(id) || (versionId !== undefined && !characterId(versionId))) return bad("not_found", 404);
  const row = await db.characterProfile.findFirst({ where: { id, user_id: userId }, include: {
    versions: { orderBy: { version: "desc" }, include: versionInclude } } });
  if (!row) return bad("not_found", 404);
  const selected = versionId ? row.versions.find(v => v.id === versionId) : row.versions[0];
  if (!selected) return bad("not_found", 404);
  return { character: summary(row), versions: row.versions.map(v => ({ id: v.id, version: v.version, created_at: v.created_at.toISOString() })), selected_version: detail(selected) };
}
async function imagesUnderLock(tx: Prisma.TransactionClient, userId: string, input: ReturnType<typeof versionInput>) {
  const rows = await tx.uploadedAsset.findMany({ where: { id: { in: input.reference_assets.map(r => r.asset_id) }, user_id: userId }, include: { image_content: true } });
  const images = input.reference_assets.map((r, position) => {
    const asset = rows.find(a => a.id === r.asset_id);
    if (!asset?.image_content || asset.image_content.user_id !== userId) return bad("asset_not_found", 404);
    return { position, asset_id: asset.id, image_content_id: asset.image_content.id, label: r.label, sha256: asset.image_content.sha256 };
  });
  if (new Set(images.map(i => i.sha256)).size !== images.length) return bad("duplicate_character_image");
  return { images, content_digest: digest({ description: input.description, images: images.map(i => ({ sha256: i.sha256, label: i.label })) }) };
}
async function saved(tx: Prisma.TransactionClient, id: string, versionId: string, reused: boolean): Promise<CharacterSaveResponse> {
  const row = await tx.characterProfile.findUniqueOrThrow({ where: { id }, include: summaryInclude });
  const version = await tx.characterVersion.findUniqueOrThrow({ where: { id: versionId }, include: versionInclude });
  return { character: summary(row), selected_version: detail(version), reused };
}
async function registerInputs(userId: string, input: ReturnType<typeof versionInput>, db: PrismaClient) {
  // Read and hash before taking the save lock; all ownership/content links are checked again inside it.
  for (const r of input.reference_assets) await registerExistingImage(userId, r.asset_id, { db });
}
export async function saveCharacter(userId: string, value: unknown, db: PrismaClient = prisma): Promise<CharacterSaveResponse> {
  const raw = object(value, ["idempotency_key", "name", "category", "description", "reference_assets"]);
  if (!characterId(raw.idempotency_key)) return bad();
  const key = raw.idempotency_key, name = text(raw.name, 80, true), category = text(raw.category ?? "", 40), input = versionInput(raw);
  const requestDigest = digest({ name, category, ...input });
  // An already completed retry must not depend on the original's continued reachability.
  const prior = await db.characterSaveReceipt.findUnique({ where: { user_id_idempotency_key: { user_id: userId, idempotency_key: key } } });
  if (prior) {
    if (prior.request_digest !== requestDigest) return bad("character_idempotency_conflict", 409);
    return db.$transaction(tx => saved(tx, prior.character_id, prior.version_id, true));
  }
  await registerInputs(userId, input, db);
  return db.$transaction(async tx => {
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!users.length) return bad("not_found", 404);
    const receipt = await tx.characterSaveReceipt.findUnique({ where: { user_id_idempotency_key: { user_id: userId, idempotency_key: key } } });
    if (receipt) {
      if (receipt.request_digest !== requestDigest) return bad("character_idempotency_conflict", 409);
      return saved(tx, receipt.character_id, receipt.version_id, true);
    }
    const { images, content_digest } = await imagesUnderLock(tx, userId, input);
    let version = await tx.characterVersion.findFirst({ where: { content_digest, character: { user_id: userId } }, orderBy: [{ created_at: "asc" }, { id: "asc" }] });
    const reused = Boolean(version);
    if (!version) {
      const [counter] = await tx.$queryRaw<{ next_code: bigint }[]>`SELECT COALESCE(MAX(substring(code from 2)::bigint), 0) + 1 AS next_code FROM "CharacterProfile" WHERE user_id = ${userId}`;
      const number = Number(counter.next_code); if (!Number.isSafeInteger(number)) return bad("character_code_exhausted", 409);
      const profile = await tx.characterProfile.create({ data: { user_id: userId, code: `C${String(number).padStart(3, "0")}`, name, category } });
      version = await tx.characterVersion.create({ data: { character_id: profile.id, version: 1, description: input.description, content_digest,
        images: { create: images.map(({ position, asset_id, image_content_id, label }) => ({ position, asset_id, image_content_id, label })) } } });
      await tx.characterProfile.update({ where: { id: profile.id }, data: { latest_version_id: version.id, version_count: 1 } });
    }
    await tx.characterSaveReceipt.create({ data: { user_id: userId, idempotency_key: key, request_digest: requestDigest, character_id: version.character_id, version_id: version.id } });
    return saved(tx, version.character_id, version.id, reused);
  }, { maxWait: 15_000, timeout: 15_000 });
}
export async function saveCharacterVersion(userId: string, id: string, value: unknown, db: PrismaClient = prisma): Promise<CharacterSaveResponse> {
  const raw = object(value, ["expected_latest_version_id", "description", "reference_assets"]);
  if (!characterId(id) || !characterId(raw.expected_latest_version_id)) return bad();
  const expected = raw.expected_latest_version_id, input = versionInput(raw);
  const owned = await db.characterProfile.findFirst({ where: { id, user_id: userId } });
  if (!owned) return bad("not_found", 404);
  await registerInputs(userId, input, db);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const profile = await tx.characterProfile.findFirst({ where: { id, user_id: userId } });
    if (!profile) return bad("not_found", 404);
    const { images, content_digest } = await imagesUnderLock(tx, userId, input);
    const prior = await tx.characterVersion.findUnique({ where: { character_id_content_digest: { character_id: id, content_digest } } });
    if (prior) return saved(tx, id, prior.id, true);
    if (profile.archived) return bad("character_archived", 409);
    if (profile.latest_version_id !== expected) return bad("character_version_changed", 409);
    const version = await tx.characterVersion.create({ data: { character_id: id, version: profile.version_count + 1,
      description: input.description, content_digest, images: { create: images.map(({ position, asset_id, image_content_id, label }) => ({ position, asset_id, image_content_id, label })) } } });
    await tx.characterProfile.update({ where: { id }, data: { latest_version_id: version.id, version_count: { increment: 1 } } });
    return saved(tx, id, version.id, false);
  }, { maxWait: 15_000, timeout: 15_000 });
}
export async function updateCharacter(userId: string, id: string, value: unknown, db: PrismaClient = prisma) {
  const raw = object(value, ["name", "category", "archived"]);
  if (!characterId(id) || !Object.keys(raw).length || (raw.archived !== undefined && typeof raw.archived !== "boolean")) return bad();
  const data = { ...(raw.name === undefined ? {} : { name: text(raw.name, 80, true) }),
    ...(raw.category === undefined ? {} : { category: text(raw.category, 40) }), ...(raw.archived === undefined ? {} : { archived: raw.archived as boolean }) };
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (!(await tx.characterProfile.updateMany({ where: { id, user_id: userId }, data })).count) return bad("not_found", 404);
    return { character: summary(await tx.characterProfile.findUniqueOrThrow({ where: { id }, include: summaryInclude })) };
  });
}
export async function listCharacterAssets(userId: string, query: Record<string, string | undefined>, db: PrismaClient = prisma) {
  const { limit, cursorWhere } = pageQuery(query, ["limit", "cursor"]);
  const rows = await db.uploadedAsset.findMany({ where: { user_id: userId, ...cursorWhere }, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: limit + 1, include: { image_content: true } });
  return { assets: rows.slice(0, limit).map(a => ({ asset_id: a.id, image_url: a.image_url, width: a.width,
    height: a.height, sha256: a.image_content?.sha256 ?? null, created_at: a.created_at.toISOString() })), next_cursor: nextCursor(rows, limit) };
}
