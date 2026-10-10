import { loadEnvConfig } from "@next/env";
import { randomBytes, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { H3_PROVIDER, H3_CAPABILITY, H3_ENDPOINT } from "../lib/video/hypit-runner";
import { loadMediaImageProfile, loadMediaVideoAccount01Profile } from "./media-image-profile";

export const WEB_ROOT = path.resolve(__dirname, "..");
export const LOCAL_ROOT = path.join(WEB_ROOT, ".local-runtime");
// Windows Postgres uses ANSI paths during initialization; its own files must use an ASCII path.
export const LOCAL_DATA_ROOT = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "LampstageLocal", createHash("sha256").update(WEB_ROOT).digest("hex").slice(0, 12));
export const LOCAL_DB_PORT = 55432;
export const LOCAL_CONTROL_PORT = 55433;
export const LOCAL_WEB_PORT = 3000;
export type LocalConfig = { version: 1; dbPassword: string; email: string; password: string };
const PROVIDER_KEYS = ["RUNNINGHUB_API_KEY_01", "VIDEO_H3_SEGMENT_QUOTE_COINS", "YUNWU_IMAGE_KEY", "YUNWU_API_KEY", "LOCAL_HTTPS_PROXY", "AI_MEDIA_TOOLS_ENV_FILE", "AI_MEDIA_TOOLS_VIDEO_ENV_FILE"] as const;

export async function loadLocalProfile(): Promise<LocalConfig> {
  // Load the original image tool's credentials, then explicitly isolate database and storage.
  loadEnvConfig(WEB_ROOT, true);
  await mkdir(LOCAL_ROOT, { recursive: true });
  const configPath = path.join(LOCAL_ROOT, "config.json");
  let config: LocalConfig;
  try { config = JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid local configuration.");
    config = { version: 1, dbPassword: randomBytes(24).toString("hex"), email: "owner@lampstage.local", password: randomBytes(12).toString("base64url") };
    await writeFile(configPath, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
  }
  if (config.version !== 1 || !/^[a-f0-9]{48}$/.test(config.dbPassword) || config.email !== "owner@lampstage.local" || typeof config.password !== "string" || config.password.length < 12) throw new Error("Invalid local configuration.");
  const providerPath = path.join(LOCAL_ROOT, "providers.json");
  try {
    const settings = JSON.parse(await readFile(providerPath, "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Invalid provider settings.");
    for (const key of PROVIDER_KEYS) {
      if (settings[key] !== undefined && typeof settings[key] !== "string") throw new Error("Invalid provider setting.");
      if (settings[key]?.trim()) process.env[key] = settings[key].trim();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid local provider settings.");
    await writeFile(providerPath, JSON.stringify({ RUNNINGHUB_API_KEY_01: "", VIDEO_H3_SEGMENT_QUOTE_COINS: "", LOCAL_HTTPS_PROXY: "" }, null, 2), { flag: "wx", mode: 0o600 });
  }
  if (process.env.AI_MEDIA_TOOLS_ENV_FILE) await loadMediaImageProfile(process.env.AI_MEDIA_TOOLS_ENV_FILE);
  if (process.env.AI_MEDIA_TOOLS_VIDEO_ENV_FILE) await loadMediaVideoAccount01Profile(process.env.AI_MEDIA_TOOLS_VIDEO_ENV_FILE);
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.LAMP_LOCAL_PROFILE = "1";
  const dbUrl = `postgresql://lampstage:${config.dbPassword}@127.0.0.1:${LOCAL_DB_PORT}/lampstage_local?schema=public`;
  process.env.DATABASE_URL = dbUrl;
  process.env.DIRECT_URL = dbUrl;
  // Empty strings remain defined, so Next's env loader cannot reload the cloud storage keys.
  for (const key of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "VIDEO_R2_BUCKET"]) process.env[key] = "";
  process.env.ADMIN_EMAILS = config.email;
  process.env.VIDEO_BETA_EMAILS = config.email;
  process.env.NEXT_PUBLIC_SITE_URL = `http://127.0.0.1:${LOCAL_WEB_PORT}`;
  process.env.VIDEO_STORAGE_DIR = path.join(LOCAL_ROOT, "private-media");
  process.env.VIDEO_WORK_ROOT = path.join(LOCAL_ROOT, "video-work");
  // A supported, isolated runtime with exactly one account 01 endpoint.
  const runtimePath = path.join(LOCAL_ROOT, "account01.runtime.json");
  const packageRoot = path.join(WEB_ROOT, "vendor", "hypit");
  const endpoint = H3_ENDPOINT;
  const provider = H3_PROVIDER;
  const credential = { store: "env", key: "RUNNINGHUB_API_KEY_01" };
  const runtime = { format: "hypit.runtime-local@1", dataRoot: "./hypit-state", credentials: { env: { use: "@hypit/credential-store-env" } },
    endpoints: { [endpoint]: { use: provider, pool: endpoint, config: { baseUrl: "https://www.runninghub.cn", apiKey: credential, instanceType: "ultra", pollIntervalMs: 5000, timeoutMs: 1800000 } } },
    bindings: { [H3_CAPABILITY]: endpoint } };
  await writeFile(runtimePath, JSON.stringify(runtime, null, 2));
  await writeFile(`${runtimePath}.account.json`, JSON.stringify({ account: "01", endpoint, credential, packageRoot }, null, 2));
  process.env.VIDEO_HYPIT_RUNTIME = runtimePath;
  process.env.VIDEO_HYPIT_PACKAGE_ROOT = packageRoot;
  const instructions = `灯境本地测试账号\r\n\r\n网址：http://127.0.0.1:${LOCAL_WEB_PORT}\r\n邮箱：${config.email}\r\n密码：${config.password}\r\n\r\n使用网页右上角登录，输入以上邮箱和密码。\r\n账号仅属于本机独立测试数据库。请勿分享此文件。\r\nRunningHub 01 配置文件：${providerPath}\r\n把 01 的 API key 填入 RUNNINGHUB_API_KEY_01 的引号内，再重新启动。不要填 02。\r\nVIDEO_H3_SEGMENT_QUOTE_COINS 需填写已核实的单段预估 RH 币（正整数），未知时留空，视频生成保持禁用。\r\n图片模型已更新为 nano banana 2.1 / image 2.5，在工作台选择；保存素材不会调用生成服务。\r\n`;
  await writeFile(path.join(LOCAL_ROOT, "本地登录与配置.txt"), instructions, { mode: 0o600 });
  return config;
}
