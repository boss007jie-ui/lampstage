import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { inspectOriginalImage } from "../../lib/assets/image-content";
import { extractCharacterBindings } from "../../lib/characters/bindings";
import { parseVideoReferenceInput } from "../../lib/video/reference-inputs";
import { readImageUploadForm, MAX_IMAGE_MULTIPART_BYTES } from "../../lib/assets/image-upload-http";
import { canonicalCharacterRecipe, requireTemplateBindingSelections } from "../../lib/characters/bindings";

test("image registry hashes original bytes and detects actual format regardless of MIME alias", async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  const a = await inspectOriginalImage(bytes);
  assert.equal(a.mime, "image/png"); assert.equal(a.width, 8); assert.equal(a.sha256.length, 64);
  await assert.rejects(inspectOriginalImage(Buffer.from("not an image")));
});
const ref = { asset_id: "asset", role: "character", label: "Person", character_version_id: "version", image_index: 0 };
const startState = { asset_id: "state", role: "start_state", label: "Complete starting scene" };
test("binding extraction preserves inherited slots and explicit detach without polluting runtime refs", () => {
  const body = { generation_mode: "six_references", reference_assets: [startState, ref], segment_plan: [{ start: 0,
    source_duration: 5, duration: 5, instructions: "Move", before_state: "Before", after_state: "After" }] };
  const pins = extractCharacterBindings(body);
  assert.equal(pins.length, 2); assert.equal(pins[0].segment_index, -1); assert.equal(pins[0].reference_index, 1);
  assert.equal(pins[1].segment_index, 0); assert.equal(pins[1].reference_index, 1);
  const data = parseVideoReferenceInput(body, "asset");
  assert.deepEqual(Object.keys(data.referenceImages![1]).sort(), ["assetId", "label", "role"]);
  for (const invalid of [{ ...ref, image_index: 7 }, { ...ref, role: "scene" }, { ...ref, unknown: true },
    { ...ref, character_version_id: null }, { asset_id: "asset", role: "character", label: "Person", image_index: 0 }]) {
    assert.throws(() => parseVideoReferenceInput({ ...body, reference_assets: [startState, invalid] }, "asset"));
  }
  assert.throws(() => parseVideoReferenceInput({ generation_mode: "direct_references", reference_assets: [ref, { asset_id: "scene", role: "scene", label: "Scene" }] }, "product"));
  assert.equal(extractCharacterBindings({ ...body, reference_assets: [{ asset_id: "asset", role: "character", label: "Person", character_version_id: null }] })[0].character_version_id, null);
});

test("schema 2 omits pinned asset IDs and requires an explicit binding or null replacement", () => {
  const recipe = { source_asset_id: "source", product_asset_id: "product", title: "Move", instructions: "Move",
    preserve_audio: true, reference_assets: [{ asset_id: "asset", role: "character", label: "Person" }], segment_plan: [] } as any;
  const pin = { segment_index: -1, reference_index: 0, character_version_id: "version", image_index: 0 };
  const canonical = canonicalCharacterRecipe(recipe, [pin]);
  assert.equal((canonical.reference_assets[0] as any).asset_id, undefined);
  assert.equal(canonical.reference_assets[0].character_version_id, "version");
  assert.equal(canonical.reference_assets[0].image_index, 0);
  assert.equal(recipe.reference_assets[0].asset_id, "asset", "canonicalization leaves the source recipe intact");
  assert.throws(() => requireTemplateBindingSelections([pin], []), { code: "character_binding_required", status: 409 });
  assert.doesNotThrow(() => requireTemplateBindingSelections([pin], [{ segment_index: -1, reference_index: 0,
    asset_id: "asset", character_version_id: null }]));
});

function multipartRequest(fileBytes: number, extraBytes = 0, claimedLength?: string) {
  const boundary = "character-test-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`);
  const extra = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n${"x".repeat(extraBytes)}`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, Buffer.alloc(fileBytes, 1), extra, tail]);
  const headers: Record<string, string> = { "content-type": `multipart/form-data; boundary=${boundary}` };
  if (claimedLength !== undefined) headers["content-length"] = claimedLength;
  return new Request("http://localhost/upload", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

test("multipart limit measures actual stream bytes with absent or false Content-Length and huge extra fields", async () => {
  for (const claimed of [undefined, "1"]) {
    await assert.rejects(readImageUploadForm(multipartRequest(MAX_IMAGE_MULTIPART_BYTES + 1, 0, claimed)),
      { code: "file_too_large", status: 413 });
  }
  await assert.rejects(readImageUploadForm(multipartRequest(16, MAX_IMAGE_MULTIPART_BYTES, "1")),
    { code: "file_too_large", status: 413 });
  await assert.rejects(readImageUploadForm(multipartRequest(16, MAX_IMAGE_MULTIPART_BYTES, String(MAX_IMAGE_MULTIPART_BYTES + 100))),
    { code: "file_too_large", status: 413 });
});
