import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyMediaImageSettings, loadMediaImageProfile } from "../media-image-profile";
import { extractGeminiImage } from "../../lib/providers/gemini-response";

const fakeKey = "openlux-test-key";
const openLux = "https://api.openlux.ai";
const imageEnvKeys = [
  "OPENLUX_API_KEY", "YUNWU_IMAGE_KEY", "GPT_IMAGE_KEY",
  "NANO_BANANA_ENDPOINT", "NANO_BANANA_MODEL",
  "NANO_BANANA_RESPONSE_FORMAT", "GPT_IMAGE_ENDPOINT", "GPT_IMAGE_MODEL",
];
const originalTextSettings = {
  YUNWU_API_KEY: "existing-yunwu-text-test-key",
  SCENE_SUGGEST_ENDPOINT: "https://existing-text.invalid/scenes",
  LAMP_PROFILE_ENDPOINT: "https://existing-text.invalid/profile",
  PROMPT_PLANNER_ENDPOINT: "https://existing-text.invalid/planner",
  DEEPSEEK_API_KEY: "existing-deepseek-test-key",
  DEEPSEEK_BASE_URL: "https://existing-deepseek.invalid",
};

test("image settings bind only image adapters to OpenLux and preserve text and vision recommendation accounts", () => {
  const env: NodeJS.Dict<string> = { ...originalTextSettings };
  applyMediaImageSettings({ OPENLUX_API_KEY: fakeKey }, env);

  assert.equal(env.OPENLUX_API_KEY, fakeKey);
  assert.equal(env.YUNWU_IMAGE_KEY, fakeKey);
  assert.equal(env.GPT_IMAGE_KEY, fakeKey);
  assert.equal(env.NANO_BANANA_MODEL, "gemini-nano-banana-2.1");
  assert.equal(env.GPT_IMAGE_MODEL, "gpt-image-2-c");
  assert.equal(env.NANO_BANANA_RESPONSE_FORMAT, "inline");
  assert.equal(env.NANO_BANANA_ENDPOINT, `${openLux}/v1beta/models/{model}:generateContent`);
  assert.equal(env.GPT_IMAGE_ENDPOINT, `${openLux}/v1/images/edits`);
  for (const [name, value] of Object.entries(originalTextSettings)) assert.equal(env[name], value);
  assert.deepEqual(Object.keys(env).sort(), [...imageEnvKeys, ...Object.keys(originalTextSettings)].sort());
});

test("profile loader imports only image settings from the media tools file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lamp-image-profile-test-"));
  const file = path.join(dir, ".env");
  const ignored = ["RUNNINGHUB_API_KEY", "RUNNINGHUB_API_KEY_02", "VIDEO_R2_BUCKET", "DATABASE_URL", "MEDIA_OUTPUT_DIR"];
  const tracked = [...imageEnvKeys, ...ignored, ...Object.keys(originalTextSettings)];
  const previous = new Map(tracked.map(name => [name, process.env[name]]));
  try {
    await writeFile(file, [
      `OPENLUX_API_KEY=${fakeKey}`,
      "RUNNINGHUB_API_KEY=ignored-runninghub-test-key",
      "RUNNINGHUB_API_KEY_02=ignored-runninghub-2-test-key",
      "VIDEO_R2_BUCKET=ignored-bucket",
      "DATABASE_URL=ignored-database-url",
      "MEDIA_OUTPUT_DIR=ignored-output-dir",
      "YUNWU_API_KEY=ignored-text-test-key",
      "SCENE_SUGGEST_ENDPOINT=https://ignored.invalid/scenes",
      "LAMP_PROFILE_ENDPOINT=https://ignored.invalid/profile",
      "PROMPT_PLANNER_ENDPOINT=https://ignored.invalid/planner",
    ].join("\n"));
    for (const name of ignored) delete process.env[name];
    for (const [name, value] of Object.entries(originalTextSettings)) process.env[name] = value;

    await loadMediaImageProfile(file);

    assert.equal(process.env.OPENLUX_API_KEY, fakeKey);
    for (const name of ignored) assert.equal(process.env[name], undefined, `${name} must stay outside the web process`);
    for (const [name, value] of Object.entries(originalTextSettings)) assert.equal(process.env[name], value);
    assert.equal(process.env.NANO_BANANA_ENDPOINT, `${openLux}/v1beta/models/{model}:generateContent`);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing image key or a non-OpenLux service address is rejected before changing settings", () => {
  for (const settings of [
    {},
    { OPENLUX_API_KEY: "  " },
    { OPENLUX_API_KEY: fakeKey, OPENLUX_BASE_URL: "https://other.example" },
    { OPENLUX_API_KEY: fakeKey, OPENLUX_BASE_URL: "http://api.openlux.ai" },
    { OPENLUX_API_KEY: fakeKey, OPENLUX_BASE_URL: "https://api.openlux.ai.evil.example" },
  ]) {
    const env: NodeJS.Dict<string> = { DEEPSEEK_API_KEY: "existing-deepseek-test-key" };
    assert.throws(() => applyMediaImageSettings(settings, env), /OPENLUX_API_KEY|Invalid OpenLux/);
    assert.deepEqual(env, { DEEPSEEK_API_KEY: "existing-deepseek-test-key" });
  }
});

test("Gemini image parsing accepts OpenLux URL and legacy inline image shapes", () => {
  const url = "https://image.example.invalid/generated.png";
  assert.deepEqual(extractGeminiImage({ candidates: [{ content: { parts: [
    { text: "done" }, { fileData: { fileUri: url, mimeType: "image/png" } },
  ] } }] }), { mime: "image/png", url });
  assert.deepEqual(extractGeminiImage({ candidates: [{ content: { parts: [
    { inlineData: { data: "ZmFrZQ==", mimeType: "image/jpeg" } },
  ] } }] }), { mime: "image/jpeg", b64: "ZmFrZQ==" });
  assert.deepEqual(extractGeminiImage({ candidates: [{ content: { parts: [
    { file_data: { file_uri: url, mime_type: "image/webp" } },
  ] } }] }), { mime: "image/webp", url });
  assert.equal(extractGeminiImage({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }), null);
  assert.equal(extractGeminiImage({ candidates: [] }), null);
});
