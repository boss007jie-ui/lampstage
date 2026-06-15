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
    "Clean Chinese e-commerce lifestyle image: bright, tidy, realistic home scene, clear enough to understand the lamp, but the room atmosphere is the main selling point.",
  brand_site:
    "Premium DTC/Shopify lifestyle image: natural light, calm editorial mood, realistic home styling, subtle composition.",
};

const ASPECT_LABEL: Record<AspectRatio, string> = {
  "1_1": "1:1 square aspect ratio",
  "4_5": "4:5 portrait aspect ratio",
  "16_9": "16:9 wide aspect ratio",
};

const STRICT_QUALITY = `
Keep the uploaded lamp's structure, material, color and shade count. Install it as a real fixture with visible ceiling/wall/table/floor connection. Match the room perspective, shadows, reflections and ambient light. Photoreal interior magazine quality, clean composition, no text or watermark.
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
  shotIndex: number,
): string {
  const audience = AUDIENCE_KEYWORDS[profile.target_audience];
  const sceneFurniture = ROOM_FURNITURE[profile.lamp_type]?.[room] || "appropriate furniture";
  const lampSizeRule = lampSizeConstraint(profile.lamp_type, profile.size_class, profile.size_hint_cm);
  const litDesc = lit
    ? `${COLOR_TEMP_DESC[profile.color_temp]} from the installed fixture`
    : `soft daylight from the windows, fixture visible but not emphasized`;

  const compositions = [
    `wide room photograph showing ceiling, window, full ${sceneFurniture}, floor and surrounding decor`,
    `architectural 3/4 view centered on the ${sceneFurniture} and room layout`,
    `home-decor editorial view focused on atmosphere, material texture and spatial depth`,
  ];
  const composition = compositions[shotIndex % compositions.length];

  // Keep this prompt short. Nano-banana/Gemini-image listens best to ~80-150 words.
  // The room is the grammatical subject; lamp is one installed fixture inside it.
  const body = `Image 1 is the lamp product reference. Image 2 is the room and composition reference. Keep the room layout, furniture scale, camera angle, ceiling height, window light and atmosphere from image 2, refined into ${audience} styling. Replace the existing fixture in image 2 with the lamp from image 1, installed naturally as real hardware. The main subject is the finished ${room}: ${sceneFurniture}, walls, ceiling, floor, rug and decor. Camera: ${composition}. ${litDesc}. Match perspective, shadows, reflections and ambient light. Scale: ${lampSizeRule} ${INDUSTRY_RULES[profile.lamp_type]}`;

  return `${body}

${PLATFORM_STYLE_RULES[platformStyle]}

Render at ${ASPECT_LABEL[aspect]}.

${STRICT_QUALITY}`;
}

/**
 * 把灯具尺寸翻译成相对周围家具的几何约束。
 * nano-banana 听几何比例（"1/8 of table width"）远比听形容词（"compact"）有效。
 */
function lampSizeConstraint(
  lampType: LampType,
  sizeClass: SizeClass,
  cm: number,
): string {
  if (lampType === "pendant") {
    // 关键修复：优先尊重 UI 里的 size_class。
    // 之前只看 cm：55cm 会被写成 large pendant，导致 AI 一直画大。
    if (sizeClass === "small") {
      return `a small pendant fixture, about ${cm}cm diameter, visually around 1/10 to 1/8 of the main furniture width. It should read as a modest ceiling accent, smaller than a dining chair back, not a chandelier.`;
    }
    if (sizeClass === "medium") {
      return `a medium pendant fixture, about ${cm}cm diameter, visually around 1/7 to 1/5 of the main furniture width. It should feel like a normal household pendant, clearly smaller than the coffee table or sofa width.`;
    }
    return `a large pendant fixture, about ${cm}cm diameter, visually around 1/4 to 1/3 of the main furniture width. Still proportional to the room, not oversized.`;
  }
  if (lampType === "ceiling") {
    if (sizeClass === "small") return `a small ceiling fixture, about ${cm}cm diameter — around the size of a dinner plate.`;
    if (sizeClass === "medium") return `a medium ceiling fixture, about ${cm}cm diameter — around the size of a serving tray.`;
    return `a large ceiling fixture, about ${cm}cm diameter — broad but still within normal ceiling-light scale.`;
  }
  if (lampType === "table") {
    if (sizeClass === "small") return `a small table lamp about ${cm}cm tall, visually secondary to the nightstand/desk.`;
    if (sizeClass === "medium") return `a medium table lamp about ${cm}cm tall, normal household scale on a table surface.`;
    return `a large table lamp about ${cm}cm tall, still proportional to the furniture surface.`;
  }
  if (lampType === "floor") {
    if (sizeClass === "small") return `a compact floor lamp about ${cm}cm tall, lower than standing adult shoulder height.`;
    if (sizeClass === "medium") return `a medium floor lamp about ${cm}cm tall, roughly adult height, placed near sofa.`;
    return `a tall floor lamp about ${cm}cm tall, proportionate to sofa and ceiling height.`;
  }
  if (lampType === "wall") {
    if (sizeClass === "small") return `a small wall sconce projecting about ${cm}cm from the wall, visually similar to a small wall clock.`;
    if (sizeClass === "medium") return `a medium wall sconce projecting about ${cm}cm from the wall, normal bedside scale.`;
    return `a large wall sconce projecting about ${cm}cm from the wall, still proportional to wall and furniture.`;
  }
  return `a ${sizeClass} lamp of approximately ${cm}cm in its primary dimension`;
}

/** 每种灯具类型对应房间里的"场景主体家具"——AI 会把摄影焦点放在这上面 */
const ROOM_FURNITURE: Record<LampType, Record<string, string>> = {
  pendant: {
    "dining room": "a 6-seater dining table with chairs",
    "living room": "a 3-seater sofa with coffee table",
    entryway: "an entryway console table with a mirror",
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
  const rooms = ROOM_SETS[profile.lamp_type];
  const litPattern = LIT_PATTERN[profile.lamp_type];
  const refs = ROOM_REFERENCE_URLS[profile.lamp_type];
  return rooms.map((room, i) => ({
    prompt: buildShotPrompt(profile, room, litPattern[i], platformStyle, aspect, i),
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
        };
        const shots = decideThreeShots(profile, args.platformStyle, args.aspectRatio);
        promptList = shots.map((s) => s.prompt);
        compositionReferenceList = shots.map((s) => s.compositionReferenceUrl);
        // 存完整 prompts + room reference，便于排查“模型到底吃到了什么”。
        finalPrompt = shots
          .map(
            (s, i) =>
              `--- shot ${i + 1}: ${s.room} (${s.lit ? "lit" : "off"}) ---\nroom_reference=${s.compositionReferenceUrl}\n${s.prompt}`,
          )
          .join("\n\n");
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
    const provider = getProvider();
    const calls = prompts.map((prompt, idx) => {
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
