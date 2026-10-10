import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";

/** Read only the requested image account. Other media-tool credentials stay in their source file. */
export function applyMediaImageSettings(settings: NodeJS.Dict<string>, env: NodeJS.Dict<string>): void {
  const key = settings.OPENLUX_API_KEY?.trim();
  if (!key) throw new Error("The media-tools image configuration is missing OPENLUX_API_KEY.");
  const base = new URL(settings.OPENLUX_BASE_URL || "https://api.openlux.ai");
  if (base.protocol !== "https:" || base.hostname !== "api.openlux.ai" || base.username || base.password || base.search || base.hash) {
    throw new Error("Invalid OpenLux image service address.");
  }
  const root = base.origin;
  // Server-only image credentials. Model IDs match the two verified media-tools adapters.
  Object.assign(env, {
    OPENLUX_API_KEY: key,
    YUNWU_IMAGE_KEY: key,
    GPT_IMAGE_KEY: key,
    NANO_BANANA_ENDPOINT: `${root}/v1beta/models/{model}:generateContent`,
    NANO_BANANA_MODEL: "gemini-nano-banana-2.1",
    NANO_BANANA_RESPONSE_FORMAT: "inline",
    GPT_IMAGE_ENDPOINT: `${root}/v1/images/edits`,
    GPT_IMAGE_MODEL: "gpt-image-2-c",
  });
}

async function readMediaSettings(filePath: string): Promise<NodeJS.Dict<string>> {
  if (!path.isAbsolute(filePath)) throw new Error("The media-tools configuration path must be absolute.");
  let settings: NodeJS.Dict<string>;
  try { settings = parseEnv((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")); }
  catch { throw new Error("Could not read the media-tools image configuration file."); }
  return settings;
}

export async function loadMediaImageProfile(filePath: string): Promise<void> {
  applyMediaImageSettings(await readMediaSettings(filePath), process.env);
}

/** Explicit opt-in for video tests: source README assigns this key to RunningHub account 01. */
export function applyMediaVideoAccount01Settings(settings: NodeJS.Dict<string>, env: NodeJS.Dict<string>): void {
  const key = settings.RUNNINGHUB_API_KEY?.trim();
  if (!key) throw new Error("The media-tools account 01 configuration is missing RUNNINGHUB_API_KEY.");
  env.RUNNINGHUB_API_KEY_01 = key;
}

export async function loadMediaVideoAccount01Profile(filePath: string): Promise<void> {
  applyMediaVideoAccount01Settings(await readMediaSettings(filePath), process.env);
}
