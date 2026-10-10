import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMediaVideoAccount01Settings } from "../media-image-profile";

test("explicit video configuration imports only documented account 01 credential", () => {
  const env: NodeJS.Dict<string> = { OPENLUX_API_KEY: "existing-image-key", RUNNINGHUB_API_KEY_02: "existing-account02-key", VIDEO_H3_SEGMENT_QUOTE_COINS: "700", DATABASE_URL: "existing-db" };
  applyMediaVideoAccount01Settings({ RUNNINGHUB_API_KEY: " source-account01-test-key ", RUNNINGHUB_API_KEY_02: "must-never-copy", OPENLUX_API_KEY: "must-not-replace", DATABASE_URL: "must-not-replace", VIDEO_H3_SEGMENT_QUOTE_COINS: "99999" }, env);
  assert.deepEqual(env, { OPENLUX_API_KEY: "existing-image-key", RUNNINGHUB_API_KEY_02: "existing-account02-key", VIDEO_H3_SEGMENT_QUOTE_COINS: "700", DATABASE_URL: "existing-db", RUNNINGHUB_API_KEY_01: "source-account01-test-key" });
});

test("account 02 can never substitute for a missing account 01", () => {
  for (const settings of [{}, { RUNNINGHUB_API_KEY: " " }, { RUNNINGHUB_API_KEY_02: "account02-test-key" }]) {
    const env: NodeJS.Dict<string> = { OPENLUX_API_KEY: "existing-image-key" };
    assert.throws(() => applyMediaVideoAccount01Settings(settings, env), /account 01/);
    assert.deepEqual(env, { OPENLUX_API_KEY: "existing-image-key" });
  }
});
