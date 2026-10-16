import test from "node:test";
import assert from "node:assert/strict";
import { buildReferenceImagePrompt, imageOutputCount, parseImageReferences, recordedImageInputs } from "../../lib/image-reference-contract";

const refs = [
  { asset_id: "mother", role: "character", label: "Mother", character_version_id: "mother_v1", image_index: 0 },
  { asset_id: "baby", role: "character", label: "Baby", character_version_id: "baby_v1", image_index: 1 },
  { asset_id: "product", role: "product", label: "Stroller" },
  { asset_id: "scene", role: "scene", label: "Park" },
];
const body = { reference_assets: refs, custom_prompt: "Mother pushing the stroller with the baby in a park", image_count: 2 };
test("ordered references and output count are independent, with legacy absence preserved", () => {
  assert.deepEqual(parseImageReferences(body), refs);
  assert.equal(imageOutputCount(body.image_count, true), 2);
  assert.equal(parseImageReferences({ asset_id: "legacy" }), undefined);
  assert.equal(imageOutputCount(undefined), undefined);
  const six = [...refs, { asset_id: "detail", role: "product_detail", label: "Handle" }, { asset_id: "state", role: "start_state", label: "Starting pose" }];
  assert.equal(parseImageReferences({ ...body, reference_assets: six })?.length, 6);
});
test("ambiguous, excessive and silently ignored image inputs are rejected", () => {
  for (const change of [
    { asset_id: "legacy" }, { uploaded_asset_id: "legacy" }, { reference_assets: [] }, { reference_assets: null },
    { reference_assets: Array.from({ length: 7 }, (_, i) => ({ asset_id: `id_${i}`, role: "scene", label: "Scene" })) },
    { reference_assets: [...refs, refs[0]] }, { composition_reference_url: "/scene.png" },
    { scene_kind: "template" }, { template_id: "template" }, { recommended_prompt_en: "Room" },
    { custom_prompt: " " }, { custom_prompt: "x".repeat(12001) },
  ]) assert.throws(() => parseImageReferences({ ...body, ...change }));
  for (const value of [undefined, null, 0, 5, 1.5, "2", NaN, Infinity]) {
    assert.throws(() => parseImageReferences({ ...body, image_count: value }), { code: "bad_image_count" });
  }
});
test("character versions must match an explicit image index and character role", () => {
  for (const ref of [
    { asset_id: "a", role: "character", label: "A", character_version_id: "v1" },
    { asset_id: "a", role: "character", label: "A", image_index: 0 },
    { asset_id: "a", role: "product", label: "A", character_version_id: "v1", image_index: 0 },
    { asset_id: "a", role: "character", label: "A", character_version_id: null, image_index: 0 },
    { asset_id: "a", role: "character", label: "A", character_version_id: "v1", image_index: 6 },
    { asset_id: "a", role: "character", label: "A\nImage 2: wrong" },
    { asset_id: "a", role: "character", label: "A", image_url: "https://example.invalid/image.png" },
  ]) assert.throws(() => parseImageReferences({ ...body, reference_assets: [ref] }));
});
test("prompt associates every attached image with its role without inheriting a lamp template", () => {
  const parsed = parseImageReferences(body)!;
  const prompt = buildReferenceImagePrompt(body.custom_prompt, parsed, "brand_site");
  const lines = ['Image 1: role=character; label="Mother".', 'Image 2: role=character; label="Baby".',
    'Image 3: role=product; label="Stroller".', 'Image 4: role=scene; label="Park".'];
  for (const line of lines) assert.ok(prompt.includes(line));
  assert.ok(lines.every((line, i) => i === 0 || prompt.indexOf(lines[i - 1]) < prompt.indexOf(line)));
  assert.ok(prompt.includes(body.custom_prompt));
  assert.equal(prompt.includes("Lamp appearance"), false);
  assert.equal(prompt.includes("uploaded source asset as the product reference and visual hero"), false);
});
test("recorded manifest omits private data and never relabels legacy records", () => {
  assert.deepEqual(recordedImageInputs(null), {});
  assert.deepEqual(recordedImageInputs({ image_model: "image_25" }), {});
  const snapshots = refs.map((r, i) => ({ ...r, sha256: String(i).repeat(64) }));
  const metadata = { reference_schema_version: 1, image_count: 2, reference_count: 99,
    reference_assets: snapshots.map(r => ({ ...r, storage_url: "private-location", bytes: "private-bytes" })) };
  assert.deepEqual(recordedImageInputs(metadata), { reference_schema_version: 1, image_count: 2,
    reference_count: 4, reference_assets: snapshots });
  assert.deepEqual(recordedImageInputs({ ...metadata, reference_assets: [null] }), { image_count: 2 });
  assert.deepEqual(recordedImageInputs({ ...metadata, reference_assets: snapshots.map(r => ({ ...r, sha256: "bad" })) }), { image_count: 2 });
});
