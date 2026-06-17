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
import { getProviderForIndex } from "@/lib/providers";
import type { AspectRatio, PlatformStyle } from "@/lib/providers/types";
import type {
  ColorTemp,
  LampType,
  SizeClass,
  TargetAudience,
} from "@/lib/lamp-profile";
import {
  planImagePrompts,
  type PromptPlan,
} from "@/lib/prompt-planner";

const OUTPUT_COUNT = 3;
const CREDIT_COST = 3;

const PLATFORM_STYLE_RULES: Record<PlatformStyle, string> = {
  domestic_ecommerce:
    "Clean Chinese e-commerce lifestyle image: bright, tidy, realistic home scene, clear enough to understand the lamp, but the room atmosphere is the main selling point.",
  brand_site:
    "Premium DTC/Shopify lifestyle image: natural light, calm editorial mood, realistic home styling, subtle composition.",
};

const ASPECT_LABEL: Record<AspectRatio, string> = {
  "1_1": "1:1 square aspect ratio",
  "4_5": "4:5 portrait aspect ratio",
  "16_9": "16:9 wide aspect ratio",
};

const STRICT_QUALITY = `Photoreal interior photography. Lamp appearance (material, color, shade shape) matches the reference image. Correct ceiling perspective and ambient lighting. No text or watermark.`.trim();

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

/** 3 张图的房间组合（按灯具类型固定） */
const ROOM_SETS: Record<LampType, string[]> = {
  // pendant 的实际场景不能一刀切。
  // small/medium 装饰吊灯如果放 dining/living/entryway，会触发模型“主吊灯居中”的强先验。
  // 所以默认表仍保留 large/通用主灯场景；具体小/中号会在 getRoomsForProfile() 里改成 accent 场景。
  pendant: ["dining room", "living room", "entryway"],
  ceiling: ["living room", "bedroom", "study"],
  wall: ["bedside in a bedroom", "hallway corridor", "living room accent wall"],
  table: ["nightstand in a bedroom", "study desk", "living room side table"],
  floor: ["living room corner", "reading nook", "bedroom corner"],
  unknown: ["living room", "bedroom", "dining room"],
};

function getRoomsForProfile(profile: LampProfileInput): string[] {
  if (profile.lamp_type === "pendant" && profile.size_class !== "large") {
    return ["bedside pendant", "reading nook pendant", "breakfast nook pendant"];
  }
  return ROOM_SETS[profile.lamp_type];
}

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
  material_keywords: string[];
};

/**
 * 为单张图拼装一个完整的 prompt。
 *
 * 核心策略（基于多轮 nano-banana 实测调整）：
 *   1. 灯具尺寸 prompt 全部失效——nano-banana 默认就要画大吊灯
 *   2. 改用"人物锚点"：画面里加一个不显眼的人体（侧影/局部），
 *      AI 对人体大小理解非常准，会自动校准灯具比例
 *   3. 人物用"半身被家具遮挡"或"远景剪影"，不破坏电商专业感
 *   4. 显式定义画面构图三层：天花板/中段/地面
 */
function buildShotPrompt(
  profile: LampProfileInput,
  room: string,
  lit: boolean,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
): string {
  const audience = AUDIENCE_KEYWORDS[profile.target_audience];
  const sceneFurniture = ROOM_FURNITURE[profile.lamp_type]?.[room] || "appropriate furniture";
  const litLine = lit
    ? `Soft ${COLOR_TEMP_DESC[profile.color_temp]} evening ambiance.`
    : "Daytime, natural window light, lamp switched off.";
  const sizePhrase =
    profile.size_class === "small"
      ? `small (~${profile.size_hint_cm}cm)`
      : profile.size_class === "large"
        ? `large (~${profile.size_hint_cm}cm)`
        : `medium (~${profile.size_hint_cm}cm)`;

  const materialDesc = profile.material_keywords.length > 0
    ? profile.material_keywords.join(", ")
    : profile.lamp_type;

  // 位置 + 安装方式：吊灯/吸顶强调"贴天花板 + 短吊杆 + 偏离画面中心"，
  // 这是线下实测让灯"融入而非居中放大"的关键。
  const placement =
    profile.lamp_type === "pendant" || profile.lamp_type === "ceiling"
      ? "hanging from a SHORT drop very close to the ceiling, positioned off-center toward an upper corner of the frame (never dead-center)"
      : profile.lamp_type === "wall"
        ? "wall-mounted with a visible backplate, off to one side of the frame"
        : profile.lamp_type === "table"
          ? "sitting on the furniture surface to one side of the frame"
          : "standing on the floor against a side wall";

  // 尺寸用画面占比表达（实测比 cm 有效），整体压小，强化"配饰非主角"。
  const frameShare =
    profile.size_class === "small" ? "only the top ~10% of the frame"
    : profile.size_class === "large" ? "about the top ~18% of the frame"
    : "only the top ~13% of the frame";

  // V2 策略（线下实测有效）：
  // 1. "wide-angle real estate photograph" + "camera pulled back" → 房间占主导，灯变配饰
  // 2. off-center + short drop → 灯不再居中、不再吊到半空
  // 3. frameShare → 尺寸压下来
  const body = [
    `Wide-angle real estate interior photograph of a ${ROOM_DISPLAY[room] ?? room}, ${audience}: ${sceneFurniture}.`,
    `The camera is pulled back to show the whole room; the room and furniture are the main subject and fill most of the frame.`,
    `${litLine}`,
    `A single ${materialDesc} ${profile.lamp_type} (${sizePhrase}, matching the reference image) is ${placement}.`,
    `It occupies ${frameShare}, clearly smaller than the furniture below, blending naturally into the room as one architectural detail — not the focal subject.`,
  ].join(" ");

  return `${body}

${PLATFORM_STYLE_RULES[platformStyle]}

Render at ${ASPECT_LABEL[aspect]}.

${STRICT_QUALITY}`;
}

/** 内部房间 key → 自然语言房间描述（用于 prompt 文字，避免 "bedside pendant" 这类不自然措辞） */
const ROOM_DISPLAY: Record<string, string> = {
  "bedside pendant": "bedroom bedside corner",
  "reading nook pendant": "reading nook",
  "breakfast nook pendant": "breakfast nook",
};

/** 每种灯具类型对应房间里的"场景主体家具"——AI 会把摄影焦点放在这上面 */
const ROOM_FURNITURE: Record<LampType, Record<string, string>> = {
  pendant: {
    "dining room": "a 6-seater dining table with chairs",
    "living room": "a 3-seater sofa with coffee table",
    entryway: "an entryway console table with a mirror",
    "bedside pendant": "a bed, nightstand, books and linen bedding",
    "reading nook pendant": "a lounge chair, side table, rug and window corner",
    "breakfast nook pendant": "a small corner breakfast nook with a 2-person round table, two compact chairs, and nearby window",
  },
  ceiling: {
    "living room": "a 3-seater sofa with coffee table",
    bedroom: "a queen bed with two nightstands",
    study: "a desk with bookshelf",
  },
  wall: {
    "bedside in a bedroom": "a queen bed with linen bedding",
    "hallway corridor": "a hallway with a runner rug",
    "living room accent wall": "a sofa against the wall",
  },
  table: {
    "nightstand in a bedroom": "a nightstand beside a queen bed",
    "study desk": "a desk with a chair and laptop",
    "living room side table": "a side table next to a sofa",
  },
  floor: {
    "living room corner": "a 3-seater sofa, area rug, coffee table",
    "reading nook": "a lounge chair, side table, throw blanket",
    "bedroom corner": "a queen bed and a wardrobe",
  },
  unknown: {
    "living room": "a sofa, coffee table, area rug",
    bedroom: "a bed and nightstand",
    "dining room": "a dining table",
  },
};

/**
 * 第二张参考图：负责房间构图、家具比例、相机角度。
 * 先复用现有 templates，后续可替换成“无灯/弱灯”的专用参考图。
 */
const ROOM_REFERENCE_URLS: Record<LampType, Record<string, string>> = {
  pendant: {
    "dining room": "/scene-refs-v2/dining_offcenter_no_lamp.jpg",
    "living room": "/scene-refs-v2/living_offcenter_no_lamp.jpg",
    entryway: "/scene-refs-v2/entryway_offcenter_no_lamp.jpg",
    "bedside pendant": "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
    "reading nook pendant": "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
    "breakfast nook pendant": "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
  },
  ceiling: {
    "living room": "/scene-refs-v2/living_offcenter_no_lamp.jpg",
    bedroom: "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
    study: "/scene-refs-v2/study_offcenter_no_lamp.jpg",
  },
  wall: {
    "bedside in a bedroom": "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
    "hallway corridor": "/scene-refs-v2/entryway_offcenter_no_lamp.jpg",
    "living room accent wall": "/scene-refs-v2/living_offcenter_no_lamp.jpg",
  },
  table: {
    "nightstand in a bedroom": "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
    "study desk": "/scene-refs-v2/study_offcenter_no_lamp.jpg",
    "living room side table": "/scene-refs-v2/living_offcenter_no_lamp.jpg",
  },
  floor: {
    "living room corner": "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
    "reading nook": "/scene-refs-v2/corner_offcenter_no_lamp.jpg",
    "bedroom corner": "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
  },
  unknown: {
    "living room": "/scene-refs-v2/living_offcenter_no_lamp.jpg",
    bedroom: "/scene-refs-v2/bedroom_offcenter_no_lamp.jpg",
    "dining room": "/scene-refs-v2/dining_offcenter_no_lamp.jpg",
  },
};

/**
 * 给定档案，决定 3 张图各自的 prompt。
 * 不依赖任何外部状态，可以单独测试。
 */
export function decideThreeShots(
  profile: LampProfileInput,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
): { prompt: string; room: string; lit: boolean; compositionReferenceUrl: string }[] {
  const rooms = getRoomsForProfile(profile);
  const litPattern =
    profile.lamp_type === "pendant" && profile.size_class !== "large"
      ? [false, false, false]
      : LIT_PATTERN[profile.lamp_type];
  const refs = ROOM_REFERENCE_URLS[profile.lamp_type];
  return rooms.map((room, i) => ({
    prompt: buildShotPrompt(profile, room, litPattern[i], platformStyle, aspect),
    room,
    lit: litPattern[i],
    compositionReferenceUrl: refs?.[room] || "/templates/tpl_living_room_main_light.jpg",
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
  let plannedPromptPlan: PromptPlan | null = null;

  // PROMPT_PLANNER_ENABLED=true 时才走 LLM planner；默认关闭，用线下验证过的本地规则
  // （buildShotPrompt：wide-angle real estate + 贴天花板 + off-center + 小尺寸占比）。
  if (!args.sceneKind && process.env.PROMPT_PLANNER_ENABLED === "true") {
    const assetForPlanning = await prisma.uploadedAsset.findUnique({
      where: { id: args.uploadedAssetId },
      select: {
        user_id: true,
        detected_lamp_type: true,
        size_class: true,
        size_hint_cm: true,
        color_temp: true,
        target_audience: true,
        material_keywords: true,
      },
    });
    if (!assetForPlanning || assetForPlanning.user_id !== args.userId) {
      return { ok: false, reason: "asset_not_found" };
    }
    if (
      !assetForPlanning.detected_lamp_type ||
      !assetForPlanning.size_class ||
      !assetForPlanning.color_temp ||
      !assetForPlanning.target_audience
    ) {
      return { ok: false, reason: "profile_not_ready" };
    }

    plannedPromptPlan = await planImagePrompts({
      profile: {
        lamp_type: assetForPlanning.detected_lamp_type as LampType,
        size_class: assetForPlanning.size_class as SizeClass,
        size_hint_cm: assetForPlanning.size_hint_cm ?? 40,
        color_temp: assetForPlanning.color_temp as ColorTemp,
        target_audience: assetForPlanning.target_audience as TargetAudience,
        material_keywords: (assetForPlanning.material_keywords ?? "").split(",").filter(Boolean),
      },
      platformStyle: args.platformStyle,
      aspectRatio: args.aspectRatio,
    });
  }

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
      let compositionReferenceList: string[] | null = null; // 新流程用：每张图对应一张房间参考图
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
          material_keywords: (asset.material_keywords ?? "").split(",").filter(Boolean),
        };
        const fallbackShots = decideThreeShots(profile, args.platformStyle, args.aspectRatio);
        const plannedShots = plannedPromptPlan?.shots;
        const shots = plannedShots
          ? plannedShots.map((shot) => ({
              prompt: `${shot.prompt}\n\n${PLATFORM_STYLE_RULES[args.platformStyle]}\n\nRender at ${ASPECT_LABEL[args.aspectRatio]}.\n\n${STRICT_QUALITY}`,
              room: shot.scene_type,
              lit: shot.light_state === "on",
              compositionReferenceUrl: shot.room_reference,
              plannerMeta: shot,
            }))
          : fallbackShots.map((shot) => ({ ...shot, plannerMeta: null }));
        promptList = shots.map((s) => s.prompt);
        compositionReferenceList = shots.map((s) => s.compositionReferenceUrl);
        // 存完整 prompts + room reference，便于排查“模型到底吃到了什么”。
        finalPrompt = [
          plannedPromptPlan
            ? `prompt_planner=used\nusage_role=${plannedPromptPlan.usage_role}\nreasoning=${plannedPromptPlan.reasoning}`
            : "prompt_planner=fallback_local_rules",
          ...shots.map(
            (s, i) =>
              `--- shot ${i + 1}: ${s.room} (${s.lit ? "lit" : "off"}) ---\nroom_reference=${s.compositionReferenceUrl}\nplanner_meta=${JSON.stringify(s.plannerMeta)}\n${s.prompt}`,
          ),
        ].join("\n\n");
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
        compositionReferenceList,
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
    compositionReferenceUrls: result.compositionReferenceList ?? undefined,
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
  /** 每张图对应的房间/构图参考图。长度可少于 OUTPUT_COUNT，缺失则该张只用灯具图。 */
  compositionReferenceUrls?: string[];
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

    // 阶段 3：实时生成保持稳定：3 张都走默认 provider（nano-banana）
    // gpt-image-2 能用，但较慢，后续作为"高质量重绘"单独按钮异步调用，避免拖垮 60s 同步接口。
    await setStage(jobId, "generating");
    const calls = prompts.map((prompt, idx) => {
      const provider = getProviderForIndex(idx);
      const compositionReferenceUrl = args.compositionReferenceUrls?.[idx];
      console.log(
        `[gen] output ${idx + 1}/${OUTPUT_COUNT} via ${provider.name}` +
          (compositionReferenceUrl ? ` + roomRef=${compositionReferenceUrl}` : ""),
      );
      return provider.generate({
        prompt,
        referenceImageUrl,
        compositionReferenceUrl,
        aspectRatio,
        platformStyle: "domestic_ecommerce", // 已经拼进 prompt 里了，这里塞个占位值
        outputCount: 1,
      });
    });
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
