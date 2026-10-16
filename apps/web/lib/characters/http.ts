import { readImageUploadForm } from "../assets/image-upload-http";
import { apiJson } from "../public-api";
import { ImageContentError, MAX_IMAGE_BYTES, uploadImageContent } from "../assets/image-content";
import { CharacterError, getCharacter, listCharacterAssets, listCharacters, saveCharacter, saveCharacterVersion, updateCharacter } from "./service";

export async function characterHttp(action: () => Promise<Response>) {
  try { return await action(); }
  catch (e) { return e instanceof CharacterError || e instanceof ImageContentError
    ? apiJson({ error: e.code }, { status: e.status }) : apiJson({ error: "character_service_unavailable" }, { status: 503 }); }
}
export async function characterBody(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new CharacterError("invalid_character_request");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024) { await reader.cancel(); throw new CharacterError("invalid_character_request"); } chunks.push(chunk.value); }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    return raw;
  } catch { throw new CharacterError("invalid_character_request"); } finally { reader.releaseLock(); }
}
function query(request: Request, allowed: string[]) {
  const params = new URL(request.url).searchParams, out: Record<string, string> = {};
  for (const [key, value] of params) { if (!allowed.includes(key) || key in out) throw new CharacterError("invalid_character_query"); out[key] = value; }
  return out;
}
export async function charactersListResponse(userId: string, request: Request) {
  return apiJson(await listCharacters(userId, query(request, ["status", "q", "limit", "cursor"])));
}
export async function characterDetailResponse(userId: string, id: string, request: Request) {
  return apiJson(await getCharacter(userId, id, query(request, ["version_id"]).version_id));
}
export async function characterSaveResponse(userId: string, request: Request, id?: string) {
  const body = await characterBody(request);
  const result = id ? await saveCharacterVersion(userId, id, body) : await saveCharacter(userId, body);
  return apiJson(result, { status: result.reused ? 200 : 201 });
}
export async function characterPatchResponse(userId: string, id: string, request: Request) {
  return apiJson(await updateCharacter(userId, id, await characterBody(request)));
}
export async function characterAssetsListResponse(userId: string, request: Request) {
  return apiJson(await listCharacterAssets(userId, query(request, ["limit", "cursor"])));
}
export async function characterAssetsUploadResponse(userId: string, request: Request) {
  const form = await readImageUploadForm(request), file = form.get("file");
  if (!(file instanceof File)) throw new ImageContentError("missing_file");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageContentError("file_too_large");
  const result = await uploadImageContent(userId, Buffer.from(await file.arrayBuffer()), { reuseAsset: true });
  const a = result.asset;
  return apiJson({ asset_id: a.id, id: a.id, image_url: a.image_url, width: a.width, height: a.height,
    sha256: result.content.sha256, reused_content: result.reused_content }, { status: result.reused_content ? 200 : 201 });
}
