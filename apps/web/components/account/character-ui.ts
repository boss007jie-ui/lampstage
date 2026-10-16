import type { CharacterAsset, CharacterDetail, CharacterReference, CharacterSaveResponse, CharacterSummary, CharacterVersionDetail } from "@/lib/characters/contracts";

const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number) => Number.isSafeInteger(value) && Number(value) >= min;
export const singleLineControls = /[\u0000-\u001f\u007f]/;
export const descriptionControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const isCursor = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length <= 512);

export function isCharacterSummary(value: unknown): value is CharacterSummary {
  const v = value as CharacterSummary | null;
  return Boolean(v && id(v.id) && typeof v.code === "string" && typeof v.name === "string" &&
    typeof v.category === "string" && typeof v.archived === "boolean" && id(v.latest_version_id) &&
    integer(v.version_count, 1) && integer(v.reference_count, 1) && v.reference_count <= 6 &&
    (v.cover_url === null || typeof v.cover_url === "string") && typeof v.created_at === "string" && typeof v.updated_at === "string");
}
export function isCharacterReference(value: unknown): value is CharacterReference {
  const v = value as CharacterReference | null;
  return Boolean(v && id(v.asset_id) && typeof v.label === "string" && typeof v.image_url === "string" &&
    (v.sha256 === null || hash(v.sha256)) && (v.character_id === undefined || id(v.character_id)) &&
    (v.character_version_id === undefined || id(v.character_version_id)) &&
    (v.image_index === undefined || (integer(v.image_index, 0) && v.image_index <= 5)));
}
export function isCharacterAsset(value: unknown): value is CharacterAsset {
  const v = value as CharacterAsset | null;
  return Boolean(v && id(v.asset_id) && typeof v.image_url === "string" && (v.sha256 === null || hash(v.sha256)) &&
    integer(v.width, 0) && integer(v.height, 0) && typeof v.created_at === "string");
}
export function isCharacterVersion(value: unknown): value is CharacterVersionDetail {
  const v = value as CharacterVersionDetail | null;
  return Boolean(v && id(v.id) && integer(v.version, 1) && typeof v.description === "string" && hash(v.content_digest) &&
    typeof v.created_at === "string" && Array.isArray(v.reference_assets) && v.reference_assets.length >= 1 && v.reference_assets.length <= 6 &&
    v.reference_assets.every((r, index) => isCharacterReference(r) && r.index === index && hash(r.sha256) &&
      integer(r.size_bytes, 1) && integer(r.width, 1) && integer(r.height, 1)) &&
    new Set(v.reference_assets.map(r => r.asset_id)).size === v.reference_assets.length &&
    new Set(v.reference_assets.map(r => r.sha256)).size === v.reference_assets.length);
}
export function isCharacterDetail(value: unknown): value is CharacterDetail {
  const v = value as CharacterDetail | null;
  return Boolean(v && isCharacterSummary(v.character) && isCharacterVersion(v.selected_version) && Array.isArray(v.versions) &&
    v.versions.every(r => r && id(r.id) && integer(r.version, 1) && typeof r.created_at === "string") &&
    v.versions.some(r => r.id === v.selected_version.id && r.version === v.selected_version.version));
}
export function isCharacterSave(value: unknown): value is CharacterSaveResponse {
  const v = value as CharacterSaveResponse | null;
  return Boolean(v && isCharacterSummary(v.character) && isCharacterVersion(v.selected_version) && typeof v.reused === "boolean");
}
export function characterSavedMessage(result: CharacterSaveResponse, zh: boolean) {
  const label = `${result.character.code} · ${result.character.name} · ${zh ? "版本" : "Version"} ${result.selected_version.version}`;
  return (result.reused ? (zh ? `已复用已有的人物版本：${label}。` : `Reused existing character version: ${label}.`)
    : (zh ? `人物已保存：${label}。` : `Character saved: ${label}.`)) +
    (result.character.archived ? (zh ? "该人物已归档，可在人物库恢复后用于新选择。" : " This character is archived. Restore it in the library before a new selection.") : "");
}
