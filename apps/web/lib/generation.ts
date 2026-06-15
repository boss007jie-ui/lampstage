/**
 * 生成任务的核心业务逻辑。
 *
 * 流程（一次完整 run）：
 *   created
 *     -> [事务] 扣 4 额度 + 写 CreditTransaction(consume) + status=generating
 *     -> stage_hint = "analyzing" -> "matching" -> "generating"
 *     -> 并发调 nano banana ×4
 *     -> stage_hint = "lighting" -> "finalizing"
 *     -> 把 4 张图写到 public/generated/<job_id>/n.png
 *     -> 写 OutputImage ×4
 *     -> status=completed
 *
 *   失败任意一步：
 *     -> status=failed + failure_reason
 *     -> [事务] 退 4 额度 + 写 CreditTransaction(refund)
 *
 * 生成是 fire-and-forget：API 返回 { job_id, status: "generating" }，
 * 前端轮询 GET /api/generation/jobs/[id] 获取 stage_hint 和最终 outputs。
 */
import { prisma } from "@/lib/db";
import {
  InsufficientCreditsError,
  consumeCredits,
  refundCredits,
} from "@/lib/credits";
import { putGeneratedImage } from "@/lib/storage";
import { getProvider } from "@/lib/providers";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";
import type {
  ColorTemp,
  LampType,
  SizeClass,
  TargetAudience,
} from "@/lib/lamp-profile";

const OUTPUT_COUNT = 3;
const CREDIT_COST = 3;

const PLATFORM_STYLE_RULES: Record<PlatformStyle, string> = {
  domestic_ecommerce:
    "Marketplace style for Tmall/1688/Taobao: bright, clean, product is the visual hero, slightly punched colors but still photoreal.",
  brand_site:
    "Brand-site style for Shopify/DTC: natural light, lifestyle feel, premium magazine editorial mood, subtle composition.",
};

const ASPECT_LABEL: Record<AspectRatio, string> = {
  "1_1": "1:1 square aspect ratio",
  "4_5": "4:5 portrait aspect ratio",
  "16_9": "16:9 wide aspect ratio",
};

const STRICT_QUALITY = `
[Lamp identity preservation]
- Keep the original product structure, colors, materials and number of shades.
- Do NOT add extra heads, arms, wires or parts. Do NOT change the material.
- Warm lamps must NOT become RGB / neon / stage / disco lights.
- Product scale must match real interior proportion.

[Installation realism]
- Pendants need a visible cord/chain/rod (no floating).
- Wall lamps must mount flush against a wall.
- Table lamps rest on a desk/console/nightstand.
- Floor lamps stand on the floor with a believable base.

[Output]
- Photo-real interior, clean composition, magazine quality.
- No watermark, no caption, no UI overlay, no garbled text.
`.trim();

function buildPrompt(
  templatePrompt: string,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
): string {
  return `${templatePrompt}

${PLATFORM_STYLE_RULES[platformStyle]}

Render at ${ASPECT_LABEL[aspect]}.

${STRICT_QUALITY}`;
}

// ============================================================================
// 灯具档案驱动的智能 prompt 拼接（V1）
// 关联 spec: docs/superpowers/specs/2026-06-13-lamp-profile-design.md
// ============================================================================

/** 行业搭配规范——AI 出图自动遵守，用户不可见 */
const INDUSTRY_RULES: Record<LampType, string> = {
  pendant:
    "Pendant bottom hangs 70-90cm above the table or floor surface. Pendant diameter is approximately 1/2 to 1/3 of the dining table width.",
  wall:
    "Wall sconce mounted 1.4-1.6m above floor for bedside, 1.6-1.8m for hallways.",
  table:
    "Table lamp height equals nightstand/desk surface plus 35-50cm. Lamp shade bottom near eye level when seated.",
  floor:
    "Floor lamp total height 1.5-1.8m. Placed 30-50cm from sofa armrest.",
  ceiling:
    "Flush-mount ceiling fixture for rooms with 2.7m+ ceiling height.",
  unknown:
    "Place the lamp at a believable, in-scale position for the room.",
};

/** 3 张图的房间组合（按灯具类型固定） */
const ROOM_SETS: Record<LampType, [string, string, string]> = {
  pendant: ["dining room", "living room", "entryway"],
  ceiling: ["living room", "bedroom", "study"],
  wall: ["bedside in a bedroom", "hallway corridor", "living room accent wall"],
  table: ["nightstand in a bedroom", "study desk", "living room side table"],
  floor: ["living room corner", "reading nook", "bedroom corner"],
  unknown: ["living room", "bedroom", "dining room"],
};

/**
 * 开关灯模式（行业惯例）：
 * 吊灯/吸顶灯：1 关展示造型 + 2 开氛围
 * 壁灯/台灯/落地灯：2 开氛围 + 1 关展示
 */
const LIT_PATTERN: Record<LampType, [boolean, boolean, boolean]> = {
  pendant: [false, true, true],
  ceiling: [false, true, true],
  wall: [true, true, false],
  table: [true, true, false],
  floor: [true, true, false],
  unknown: [false, true, true],
};

/** 6 个目标客群对应的视觉关键词（注入 prompt） */
const AUDIENCE_KEYWORDS: Record<TargetAudience, string> = {
  modern_luxury:
    "modern luxury interior, black metal accents, marble surfaces, leather and velvet upholstery, brass details, deep neutrals with gold trim",
  nordic:
    "nordic minimalist interior, light oak wood floors, soft white walls, linen and wool textures, abundant natural light, restrained palette",
  wabi_sabi:
    "wabi-sabi japanese interior, raw wood, paper screens, gray and off-white tones, hand-crafted ceramics, deliberate emptiness",
  industrial:
    "industrial loft interior, exposed black iron beams, polished concrete floor, vintage brass fixtures, leather and dark wood, factory-converted feel",
  new_chinese:
    "new chinese interior, solid dark wood frames, ink-wash artwork, indoor plants, restrained ornamentation, cultural minimalism",
  french:
    "french elegant interior, ivory walls with arches, gold-trimmed mirrors, soft florals, draped curtains, parquet flooring",
};

const COLOR_TEMP_DESC: Record<ColorTemp, string> = {
  warm_3000k:
    "warm 3000K bulb glow (golden-yellow, cozy)",
  neutral_4000k:
    "neutral 4000K bulb glow (clean natural white)",
  cool_5000k:
    "cool 5500K bulb glow (crisp daylight white)",
  tunable:
    "warm 2700K bulb glow (this is a tunable lamp; show the warm setting here)",
};

export type LampProfileInput = {
  lamp_type: LampType;
  size_class: SizeClass;
  size_hint_cm: number;
  color_temp: ColorTemp;
  target_audience: TargetAudience;
};

/**
 * 为单张图拼装一个完整的 prompt：
 *   灯具描述（含人体参照）+ 客群风格 + 房间 + 开关灯 + 行业规范 + 平台风格 + 质量约束
 *
 * 关键：让 nano-banana 把灯当作"室内场景里一件正常尺寸的家具"，
 * 而不是占满画面的主角——所以避免 "visual hero" / "hero shot" 这种短语。
 */
function buildShotPrompt(
  profile: LampProfileInput,
  room: string,
  lit: boolean,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
  shotIndex: number,
): string {
  // 用人体参照锁定相对尺寸——比抽象的 "compact" / "oversized" 强得多
  const humanRef = humanReference(profile.lamp_type, profile.size_hint_cm);
  const lamp = `a ${profile.lamp_type} lamp measuring approximately ${profile.size_hint_cm}cm (${humanRef})`;
  const audience = AUDIENCE_KEYWORDS[profile.target_audience];
  const litDesc = lit
    ? `the lamp's bulb is turned on, emitting ${COLOR_TEMP_DESC[profile.color_temp]}, evening or dusk ambient mood`
    : `the lamp's bulb is off, showing the product in clean natural daylight`;
  const angles = [
    "wide eye-level interior shot showing the full room context",
    "medium 3/4 angle showing furniture and the lamp in proper proportion",
    "natural lifestyle composition, the lamp naturally integrated into the room",
  ];
  const angle = angles[shotIndex % angles.length];

  const body = `Editorial e-commerce interior photo of a ${room}. The room contains ${lamp}, integrated naturally with the furniture and architecture.

Interior style: ${audience}.

Lighting: ${litDesc}.

Composition: ${angle}. Show the room as a whole; the lamp must occupy a realistic, in-scale position — NOT dominate the frame, NOT exceed its real-world size.

${INDUSTRY_RULES[profile.lamp_type]}

[Critical scale rule]
The lamp must be rendered at its real-world size relative to surrounding furniture (sofa, table, person standing nearby). Do not enlarge the lamp for visual impact. A pendant smaller than 30cm must NOT span the width of a dining table.`;

  return `${body}

${PLATFORM_STYLE_RULES[platformStyle]}

Render at ${ASPECT_LABEL[aspect]}.

${STRICT_QUALITY}`;
}

/**
 * 给灯具尺寸一个人体可感知的参照说明。
 * AI 看到 "30cm" 是个抽象数字；看到 "smaller than a basketball" 才会真的画小。
 */
function humanReference(lampType: LampType, cm: number): string {
  if (lampType === "pendant" || lampType === "ceiling") {
    if (cm <= 25) return "smaller than a basketball, fits comfortably in one hand";
    if (cm <= 40) return "about the size of a basketball";
    if (cm <= 60) return "about the size of a large pizza tray";
    return "as wide as an adult's outstretched arm — large statement piece";
  }
  if (lampType === "table") {
    if (cm <= 35) return "shorter than a wine bottle";
    if (cm <= 50) return "roughly the height of a tall water bottle";
    return "taller than a typical cookbook stand";
  }
  if (lampType === "floor") {
    if (cm <= 140) return "shorter than an average adult, around shoulder height when seated";
    if (cm <= 170) return "about the height of an average adult";
    return "taller than a typical doorway lintel";
  }
  if (lampType === "wall") {
    if (cm <= 25) return "projects from the wall less than a hand's length";
    if (cm <= 40) return "projects about a forearm's length";
    return "projects nearly an arm's length";
  }
  return "in human-realistic proportion to the room";
}

/**
 * 给定档案，决定 3 张图各自的 prompt。
 * 不依赖任何外部状态，可以单独测试。
 */
export function decideThreeShots(
  profile: LampProfileInput,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
): { prompt: string; room: string; lit: boolean }[] {
  const rooms = ROOM_SETS[profile.lamp_type];
  const litPattern = LIT_PATTERN[profile.lamp_type];
  return rooms.map((room, i) => ({
    prompt: buildShotPrompt(profile, room, litPattern[i], platformStyle, aspect, i),
    room,
    lit: litPattern[i],
  }));
}

/**
 * 创建生成任务并立即开始执行（不等待完成）。
 *
 * 四路 prompt 来源：
 *   - sceneKind=undefined（新流程）→ 从 asset 读档案 → decideThreeShots → 3 张图 3 个 prompt
 *   - sceneKind="template" + templateId（旧的快捷模板）
 *   - sceneKind="recommended" + recommendedPromptEn（系统推荐方案的英文 prompt）
 *   - sceneKind="custom" + customPrompt（用户自由描述，中/英文都可）
 */
export async function createAndRunGenerationJob(args: {
  userId: string;
  uploadedAssetId: string;
  /** 不传则走新档案流程；传了走对应旧路径以保持兼容 */
  sceneKind?: "template" | "recommended" | "custom";
  templateId?: string;
  recommendedPromptEn?: string;
  customPrompt?: string;
  platformStyle: PlatformStyle;
  aspectRatio: AspectRatio;
}): Promise<
  | { ok: true; jobId: string; creditBalance: number }
  | {
      ok: false;
      reason:
        | "insufficient_credits"
        | "asset_not_found"
        | "template_not_found"
        | "missing_prompt"
        | "profile_not_ready";
    }
> {
  // Step A: 验证资源 + 扣额度 + 创建 job（一个事务）
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const asset = await tx.uploadedAsset.findUnique({
        where: { id: args.uploadedAssetId },
      });
      if (!asset || asset.user_id !== args.userId) {
        return { kind: "asset_missing" as const };
      }

      // 四路 prompt 拼接
      let finalPrompt = "";
      let promptList: string[] | null = null; // 新流程用：3 张图各自的 prompt
      let templateId: string | null = null;

      if (!args.sceneKind) {
        // 新流程：档案驱动
        if (!asset.detected_lamp_type || !asset.size_class || !asset.color_temp || !asset.target_audience) {
          return { kind: "profile_missing" as const };
        }
        const profile: LampProfileInput = {
          lamp_type: asset.detected_lamp_type as LampType,
          size_class: asset.size_class as SizeClass,
          size_hint_cm: asset.size_hint_cm ?? 40,
          color_temp: asset.color_temp as ColorTemp,
          target_audience: asset.target_audience as TargetAudience,
        };
        const shots = decideThreeShots(profile, args.platformStyle, args.aspectRatio);
        promptList = shots.map((s) => s.prompt);
        // 在 job.prompt_text 里只存第一张的 prompt 摘要 + 房间清单（用于 admin 排查）
        finalPrompt = `[profile-driven] type=${profile.lamp_type} size=${profile.size_class}/${profile.size_hint_cm}cm temp=${profile.color_temp} audience=${profile.target_audience}\nrooms: ${shots.map((s) => `${s.room}(${s.lit ? "lit" : "off"})`).join(", ")}`;
      } else if (args.sceneKind === "template") {
        if (!args.templateId) {
          return { kind: "missing_prompt" as const };
        }
        const tpl = await tx.template.findUnique({
          where: { id: args.templateId },
        });
        if (!tpl || !tpl.is_active) {
          return { kind: "template_missing" as const };
        }
        templateId = tpl.id;
        finalPrompt = tpl.prompt_template;
      } else if (args.sceneKind === "recommended") {
        if (!args.recommendedPromptEn?.trim()) {
          return { kind: "missing_prompt" as const };
        }
        finalPrompt = args.recommendedPromptEn.trim();
      } else if (args.sceneKind === "custom") {
        if (!args.customPrompt?.trim()) {
          return { kind: "missing_prompt" as const };
        }
        finalPrompt = expandCustomPrompt(args.customPrompt.trim());
      }

      const job = await tx.generationJob.create({
        data: {
          user_id: args.userId,
          uploaded_asset_id: asset.id,
          template_id: templateId,
          scene_kind: args.sceneKind ?? "profile",
          prompt_text: finalPrompt,
          platform_style: args.platformStyle,
          aspect_ratio:
            args.aspectRatio === "1_1"
              ? "ratio_1_1"
              : args.aspectRatio === "4_5"
                ? "ratio_4_5"
                : "ratio_16_9",
          credit_cost: CREDIT_COST,
          status: "generating",
          stage_hint: "analyzing",
        },
      });

      // 在同一事务里扣额度
      const { balanceAfter } = await consumeCredits(
        tx,
        args.userId,
        CREDIT_COST,
        job.id,
      );

      return {
        kind: "ok" as const,
        job,
        asset,
        finalPrompt,
        promptList,
        balanceAfter,
      };
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return { ok: false, reason: "insufficient_credits" };
    }
    throw e;
  }

  if (result.kind === "asset_missing") {
    return { ok: false, reason: "asset_not_found" };
  }
  if (result.kind === "template_missing") {
    return { ok: false, reason: "template_not_found" };
  }
  if (result.kind === "missing_prompt") {
    return { ok: false, reason: "missing_prompt" };
  }
  if (result.kind === "profile_missing") {
    return { ok: false, reason: "profile_not_ready" };
  }

  // Step B: 同步 await 整个生成（serverless 不能用 fire-and-forget）
  // 等所有图生成完才返回，前端轮询 GET /api/generation/jobs/[id] 看进度
  // 新流程：promptList 里已经是 3 个完整 prompt（含规范+平台+质量约束），不再走 buildPrompt
  // 旧流程：finalPrompt 是模板/推荐/自定义的 prompt，走 buildPrompt 套上标准框架，复制 3 次
  const prompts: string[] = result.promptList
    ? result.promptList
    : Array.from({ length: OUTPUT_COUNT }, () =>
        buildPrompt(result.finalPrompt, args.platformStyle, args.aspectRatio),
      );
  await runGenerationPipeline({
    jobId: result.job.id,
    userId: args.userId,
    referenceImageUrl: result.asset.image_url,
    prompts,
    aspectRatio: args.aspectRatio,
  }).catch((err) => {
    console.error("[gen] uncaught error", err);
  });

  return { ok: true, jobId: result.job.id, creditBalance: result.balanceAfter };
}

/**
 * 把用户的自由描述变成更完整的 prompt。
 * 用户可能只写一句"温馨客厅"，我们补上空间细节、灯光描述、电商风格、负向约束。
 */
function expandCustomPrompt(userText: string): string {
  return `Interior photo of a residential room described as: ${userText}.
Real interior photography style with the user-uploaded lamp as the visual hero.
Compose the scene around the lamp with appropriate furniture, materials, daylight or ambient bulbs, depth of field.`;
}

async function setStage(
  jobId: string,
  stage: "analyzing" | "matching" | "generating" | "lighting" | "finalizing",
) {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: { stage_hint: stage },
  });
}

async function runGenerationPipeline(args: {
  jobId: string;
  userId: string;
  referenceImageUrl: string;
  /** 每张图独立 prompt（长度应等于 OUTPUT_COUNT）。如果传单字符串则自动复制 OUTPUT_COUNT 次。 */
  prompts: string[] | string;
  aspectRatio: AspectRatio;
}) {
  const { jobId, userId, referenceImageUrl, aspectRatio } = args;
  const prompts: string[] = Array.isArray(args.prompts)
    ? args.prompts
    : Array.from({ length: OUTPUT_COUNT }, () => args.prompts as string);
  if (prompts.length !== OUTPUT_COUNT) {
    throw new Error(
      `runGenerationPipeline: expected ${OUTPUT_COUNT} prompts, got ${prompts.length}`,
    );
  }
  try {
    // 阶段 1
    await setStage(jobId, "analyzing");
    await sleep(800);

    // 阶段 2
    await setStage(jobId, "matching");
    await sleep(600);

    // 阶段 3：实际并发调用 provider OUTPUT_COUNT 次（每张图独立 prompt）
    await setStage(jobId, "generating");
    const provider = getProvider();
    const calls = prompts.map((prompt) =>
      provider.generate({
        prompt,
        referenceImageUrl,
        aspectRatio,
        platformStyle: "domestic_ecommerce", // 已经拼进 prompt 里了，这里塞个占位值
        outputCount: 1,
      }),
    );
    const settled = await Promise.allSettled(calls);
    const successes = settled
      .map((r) =>
        r.status === "fulfilled" && r.value.ok && r.value.bytes && r.value.mime
          ? { bytes: r.value.bytes, mime: r.value.mime }
          : null,
      )
      .filter((x): x is { bytes: Buffer; mime: string } => x !== null);

    if (successes.length === 0) {
      const firstError = settled.find(
        (r) =>
          (r.status === "fulfilled" && !r.value.ok) || r.status === "rejected",
      );
      const reason =
        firstError?.status === "fulfilled" && !firstError.value.ok
          ? firstError.value.error || "unknown provider error"
          : firstError?.status === "rejected"
            ? String(firstError.reason).slice(0, 240)
            : "all 4 generations failed";
      throw new Error(`all generations failed: ${reason}`);
    }

    // 阶段 4
    await setStage(jobId, "lighting");
    await sleep(400);

    // 阶段 5：写存储 + DB
    await setStage(jobId, "finalizing");
    const outputs: { image_url: string; thumbnail_url: string }[] = [];
    for (let i = 0; i < successes.length; i++) {
      const img = successes[i];
      const url = await putGeneratedImage(`${jobId}/${i + 1}`, img.bytes, img.mime);
      outputs.push({ image_url: url, thumbnail_url: url });
    }
    await prisma.outputImage.createMany({
      data: outputs.map((o) => ({
        job_id: jobId,
        image_url: o.image_url,
        thumbnail_url: o.thumbnail_url,
      })),
    });

    await prisma.generationJob.update({
      where: { id: jobId },
      data: { status: "completed", stage_hint: null },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[gen] failed", reason);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.generationJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            failure_reason: reason.slice(0, 480),
            stage_hint: null,
          },
        });
        await refundCredits(tx, userId, CREDIT_COST, jobId);
      });
    } catch (e) {
      console.error("[gen] failure-handling error", e);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
