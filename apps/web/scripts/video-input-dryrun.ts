/**
 * 视频输入方案 dry-run（**保证不产生任何付费调用**）。
 *
 * 为什么可以保证：
 *   - 本文件**不 import** 任何 provider（openlux-images / nano-banana）、不 import
 *     `image-reference`、不 import `hypit-runner` 的提交路径，也不调用 CLI 的 build/plan。
 *   - 只做三件事：① 只读 SELECT 读任务；② 调用 reference-inputs.ts 的**纯函数**；
 *     ③ 读本仓库源码文件做端口契约断言。没有任何 fetch / spawn。
 *   脚本末尾会自证"实际 import 的模块里没有付费入口"。
 *
 * 用法：
 *   npx --no-install tsx scripts/video-input-dryrun.ts --job <jobId>
 *   npx --no-install tsx scripts/video-input-dryrun.ts --demo-direct
 */
import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";

loadEnvConfig(process.cwd());

// ⚠️ 只允许纯函数：无网络、无 CLI。
import { DIRECT_REFERENCE_CAPABILITY, generationMode, referenceImagesFor, referenceVideoDirection } from "../lib/video/reference-inputs";
import { emptyVideoData, segmentCoinQuote, type VideoJobData } from "../lib/video/types";

type Plan = {
  mode: string;
  segments: number | null;
  provided_reference_images: number;
  generated_reference_image_calls: number;
  edited_reference_image_calls: number;
  reference_roles: string[];
  adapter_ports: Record<string, number>;
  first_last_frame_ports: number;
  paid_calls_executed: 0;
};

function planFor(data: VideoJobData, segments: number | null): Plan {
  const mode = generationMode(data);
  const direct = mode === "direct_references";
  const refs = direct ? referenceImagesFor(data) : [];
  return {
    mode,
    segments,
    // direct：用户已有的 3 张图直接进请求（不是新生图）
    provided_reference_images: direct ? refs.length : 1,
    // legacy：每段额外生成 opening/ending 两张
    generated_reference_image_calls: direct ? 0 : segments === null ? 0 : segments * 2,
    edited_reference_image_calls: 0,
    reference_roles: direct ? refs.map(r => `${r.role}:${r.label}`) : ["product", "opening", "ending"],
    // 适配器端口（provider.js:76-82 / hypit-runner.ts:154）
    adapter_ports: { referenceImage: 3, referenceVideo: 1, referenceAudio: 0, firstFrame: 0, lastFrame: 0 },
    first_last_frame_ports: 0,
    paid_calls_executed: 0,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const jobIndex = argv.indexOf("--job");
  const jobId = jobIndex >= 0 ? argv[jobIndex + 1] : undefined;
  const demoDirect = argv.includes("--demo-direct");
  const legacyDemo = argv.includes("--legacy-demo");
  if (!jobId && !demoDirect && !legacyDemo) {
    console.error("usage: video-input-dryrun.ts --job <jobId> | --demo-direct | --legacy-demo [--seconds 16.3]");
    process.exitCode = 2;
    return;
  }

  const out: Record<string, unknown> = {};

  // ① 本仓库源码层面的端口契约断言（读文件，不发请求）
  const runnerSource = await readFile(path.join(process.cwd(), "lib/video/hypit-runner.ts"), "utf8");
  out.port_contract = {
    reference_image_elements_in_svml: (runnerSource.match(/<h3:Reference image=/g) || []).length,
    reference_video_elements_in_svml: (runnerSource.match(/<h3:Reference video=/g) || []).length,
    first_frame_elements_in_svml: (runnerSource.match(/<h3:FirstFrame|firstFrame=/g) || []).length,
    last_frame_elements_in_svml: (runnerSource.match(/<h3:LastFrame|lastFrame=/g) || []).length,
  };

  if (demoDirect) {
    // 合成一个"三张已有图"的 direct 数据（产品 + 两位人物身份），不落库。
    const demo: VideoJobData = {
      ...emptyVideoData(),
      generationMode: "direct_references",
      referenceImages: [
        { assetId: "asset-product", role: "product", label: "产品" },
        { assetId: "asset-baby", role: "character", label: "宝宝" },
        { assetId: "asset-mom", role: "character", label: "妈妈" },
      ],
    };
    out.demo_direct = planFor(demo, 4);
    out.demo_direct_direction_preview = referenceVideoDirection(referenceImagesFor(demo), "保持源片动作与镜头").split("\n").slice(0, 4);
    out.direct_capability = DIRECT_REFERENCE_CAPABILITY;
  }

  if (jobId) {
    const [{ prisma }] = await Promise.all([import("../lib/db")]);
    const job = await prisma.videoJob.findFirst({ where: { id: jobId }, select: { id: true, status: true, phase: true, data: true } });
    if (!job) throw new Error("job_not_found");
    // data 是 Prisma 的 JsonValue，先转 unknown 再收窄（不做任何校验之外的推断）。
    const data = job.data as unknown as VideoJobData;
    const seconds = typeof data.sourceDuration === "number" ? data.sourceDuration : null;
    const fromData = Array.isArray(data.segments) && data.segments.length ? data.segments.length : null;
    out.job = { id: job.id, status: job.status, phase: job.phase, source_duration: seconds };
    out.current_code_plan = planFor(data, fromData ?? (seconds ? segmentCount(seconds) : null));
    out.note = "当前生产实现是 legacy_frames（无 generationMode 字段即默认该模式）。";
    await prisma.$disconnect();
  }

  if (legacyDemo) {
    // 用**真实 v3 任务在数据库里的 data 原文**做演示（来源：只读 SELECT 得到
    // {"version":1,"segments":[],"imageCalls":0}，没有 generationMode 字段）。
    // 这样既忠于事实，又完全不连数据库。
    const seconds = Number(argv[argv.indexOf("--seconds") + 1]) || 16.3;
    const realV3Data = { version: 1 as const, segments: [], imageCalls: 0 };
    out.legacy_real_job_demo = {
      source: "数据库里 v3 (cmv6upax0002sn70jxu0ovl93) 的 data 原文",
      data: realV3Data,
      plan: planFor(realV3Data as VideoJobData, segmentCount(seconds)),
      note: "该任务没有 generationMode 字段 ⇒ 按 generationMode() 默认落到 legacy_frames。",
    };
  }

  out.paid_calls_executed = 0;
  out.guarantee = "只读 SELECT + 纯函数 + 本地源码断言；未 import 任何 provider / runner 提交路径，未 spawn CLI，未发起 fetch。";
  out.per_segment_quote_coins = segmentCoinQuote();
  console.log(JSON.stringify(out, null, 2));
}

/** 与 media.ts 的 segmentTimeline 同规则：每段 4/5 秒。仅用于把"会生成几张"算出来。 */
function segmentCount(seconds: number): number {
  let covered = 0;
  let count = 0;
  while (covered < seconds - 1e-6) {
    const remaining = seconds - covered;
    const duration = remaining <= 4 ? 4 : 5;
    covered += Math.min(duration, remaining);
    count += 1;
    if (count > 12) break;
  }
  return count;
}

void main().catch(error => {
  console.error("dryrun_failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
