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

/**
 * 标准空间池。AI 推断时按"灯的风格气质"从这里挑 3 个空间（space_fit），
 * 生成时优先用 AI 判断；AI 没给才回退到 DEFAULT_SPACES_BY_TYPE 的灯型映射。
 * 每个空间配好：display（prompt 用的自然语言名）、furniture（场景主体家具）、lampTypes（哪些灯型适配，给回退用）。
 */
type SpaceDef = { display: string; furniture: string; lampTypes: LampType[] };

const SPACE_POOL: Record<string, SpaceDef> = {
  dining_room: {
    display: "dining room",
    furniture: "a 6-seater dining table with chairs",
    lampTypes: ["pendant", "ceiling"],
  },
  living_room: {
    display: "living room",
    furniture: "a 3-seater sofa, coffee table and area rug",
    lampTypes: ["pendant", "ceiling", "floor", "table"],
  },
  entryway: {
    display: "entryway",
    furniture: "an entryway console table with a mirror and a vase",
    lampTypes: ["pendant", "ceiling", "wall"],
  },
  staircase: {
    display: "staircase void",
    furniture: "a stairwell with a railing and a tall blank wall",
    lampTypes: ["pendant"],
  },
  kitchen_island: {
    display: "kitchen with an island",
    furniture: "a kitchen island with bar stools",
    lampTypes: ["pendant"],
  },
  bedroom: {
    display: "bedroom",
    furniture: "a queen bed with linen bedding and two nightstands",
    lampTypes: ["ceiling", "pendant", "wall", "table"],
  },
  bedside: {
    display: "bedroom bedside corner",
    furniture: "a bed with linen bedding, a nightstand, books and a cup",
    lampTypes: ["wall", "table", "pendant"],
  },
  study: {
    display: "study",
    furniture: "a desk with a chair and a bookshelf",
    lampTypes: ["pendant", "ceiling", "table", "floor"],
  },
  reading_nook: {
    display: "reading nook",
    furniture: "a lounge chair, side table, rug and a bright window corner",
    lampTypes: ["floor", "pendant", "wall"],
  },
  hallway: {
    display: "hallway corridor",
    furniture: "a hallway with a runner rug and a console table",
    lampTypes: ["wall", "ceiling", "pendant"],
  },
  breakfast_nook: {
    display: "breakfast nook",
    furniture: "a corner breakfast nook with a round table and two chairs near a window",
    lampTypes: ["pendant"],
  },
  living_side_table: {
    display: "living room side table",
    furniture: "a side table next to a sofa",
    lampTypes: ["table"],
  },
};

/** 回退：AI 没给 space_fit 时，按灯型给一组默认空间 */
const DEFAULT_SPACES_BY_TYPE: Record<LampType, string[]> = {
  pendant: ["dining_room", "living_room", "entryway"],
  ceiling: ["living_room", "bedroom", "study"],
  wall: ["bedside", "hallway", "living_room"],
  table: ["bedside", "study", "living_side_table"],
  floor: ["living_room", "reading_nook", "bedroom"],
  unknown: ["living_room", "dining_room", "bedroom"],
};

/** 这些空间的吊灯应居中对准桌面（餐厅/厨房中岛/早餐角），而不是偏置。 */
const TABLE_CENTRIC_SPACES = new Set(["dining_room", "kitchen_island", "breakfast_nook"]);

/** 每个空间的自然语言场景叙述（A/B 实测：连贯叙述比关键词堆叠更能"融入"灯具）。 */
const SPACE_SCENE: Record<string, string> = {
  dining_room: "A long wooden dining table with six chairs sits in the middle of the room, the table set with ceramic plates and a small vase, large windows along one side",
  living_room: "A comfortable three-seater sofa faces a low coffee table on a soft area rug, with a couple of cushions, a side table and a leafy plant in the corner",
  entryway: "A slim console table stands against the wall near the front door, a round mirror above it and a vase of dried branches on top",
  staircase: "An open staircase with a wooden railing rises against a tall blank wall in a bright stairwell",
  kitchen_island: "A kitchen island with a stone worktop and two bar stools stands in the centre of a bright modern kitchen",
  bedroom: "A neatly made queen bed with linen bedding sits against the wall between two matching nightstands, soft daylight from a nearby window",
  bedside: "A made bed with linen bedding sits beside a small nightstand holding a few books and a cup, in a calm bedroom corner",
  study: "A wooden desk with a chair faces the window, a bookshelf along the wall and a few books stacked on the desk",
  reading_nook: "A cosy lounge chair with a small side table sits in a bright corner by the window, on a soft rug",
  hallway: "A long hallway with a runner rug stretches past a narrow console table along one wall",
  breakfast_nook: "A round breakfast table with two chairs sits in a sunny corner beside a window",
  living_side_table: "A small side table stands next to a sofa in a calm living room, with a book and a cup resting on it",
};

function spaceScene(key: string): string {
  return SPACE_SCENE[key] ?? `A tastefully furnished ${spaceDisplay(key)} with appropriate furniture and soft natural light`;
}

function spaceDisplay(key: string): string {
  return SPACE_POOL[key]?.display ?? key.replace(/_/g, " ");
}

/**
 * 决定 3 个空间。优先用 AI 判断的 space_fit（风格气质驱动），
 * 不足 3 个用灯型默认空间补齐。pool 里没有的自定义空间也允许（自由发挥）。
 */
function getRoomsForProfile(profile: LampProfileInput): string[] {
  const fallback = DEFAULT_SPACES_BY_TYPE[profile.lamp_type] ?? DEFAULT_SPACES_BY_TYPE.unknown;
  const aiSpaces = (profile.space_fit ?? []).filter((s) => s && s.trim().length > 0);
  if (aiSpaces.length === 0) return fallback;
  const merged = [...aiSpaces];
  for (const f of fallback) {
    if (merged.length >= 3) break;
    if (!merged.includes(f)) merged.push(f);
  }
  return merged.slice(0, 3);
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
  /** AI 判断的适合空间（SPACE_POOL 的 key，按适合度排序）。空数组则回退灯型默认。 */
  space_fit: string[];
};

/**
 * 为单张图拼装一个完整的 prompt。
 *
 * 策略（线下 A/B 实测，自然语言叙述完胜堆约束）：
 *   用一段连贯的"真实室内摄影"叙述，把房间、家具、灯具位置、灯光状态自然串起来，
 *   灯具作为场景里的一个装饰细节融入，而不是用"占画面 X%""off-center"这类指令硬压。
 */
function buildShotPrompt(
  profile: LampProfileInput,
  room: string,
  lit: boolean,
  platformStyle: PlatformStyle,
  aspect: AspectRatio,
): string {
  const audience = AUDIENCE_KEYWORDS[profile.target_audience];
  const scene = spaceScene(room);
  const materialDesc =
    profile.material_keywords.length > 0
      ? profile.material_keywords.join(", ")
      : profile.lamp_type;
  const lampNoun = `${materialDesc} ${profile.lamp_type} lamp`;
  const lampRef =
    "(the same lamp as in the reference image — keep its exact shape, material and colour)";

  const isPendantType =
    profile.lamp_type === "pendant" || profile.lamp_type === "ceiling";
  const tableCentric = isPendantType && TABLE_CENTRIC_SPACES.has(room);

  // 相对尺寸锚点（方案A：不写死具体参照物，让模型自己在场景里找主家具做参照）。
  // flash 模型忽略"约25cm"这类绝对数字，但会遵守"明显小于画面里的主要家具、像个小点缀"
  // 这种画面内相对比较。size_class 只决定"小到什么程度"。
  // everyday-object 比喻给模型一个直觉尺度，但不锁定到某件特定家具。
  const sizeFraction =
    profile.size_class === "small"
      ? "much smaller than"
      : profile.size_class === "large"
        ? "noticeably smaller than"
        : "clearly smaller than";
  const everydayHint =
    profile.size_class === "small"
      ? " — its shade is only about the size of a dinner plate"
      : profile.size_class === "large"
        ? ""
        : " — its shade is only about the size of a serving tray";
  const scaleLine = isPendantType
    ? `IMPORTANT SCALE: the lamp is a small, modest accent, ${sizeFraction} the main furniture below it${everydayHint}. It hangs high on its cord near the ceiling and reads as one small detail in the room, NOT an oversized hero piece — compare it to whatever furniture sits beneath it and keep it clearly smaller.`
    : `IMPORTANT SCALE: the lamp is ${sizeFraction} the main furniture next to it${everydayHint}, reading as one small modest accent in the room, not an oversized hero object — compare it to the nearby furniture and keep it clearly smaller.`;

  // 位置：用自然语序把灯具"摆进"场景——居中对桌 / 家具区上方 / 靠墙 / 台面 / 落地。
  let placement: string;
  if (tableCentric) {
    placement = `Directly above the centre of the table, hanging high on its cord, is a single ${lampNoun} ${lampRef}`;
  } else if (isPendantType) {
    placement = `From the ceiling above the seating area, hanging high on its cord, is a single ${lampNoun} ${lampRef}`;
  } else if (profile.lamp_type === "wall") {
    placement = `On the wall beside the furniture, at roughly eye level with its backplate flat against the wall, is mounted a single ${lampNoun} ${lampRef}`;
  } else if (profile.lamp_type === "table") {
    placement = `On a surface to one side of the frame sits a single ${lampNoun} ${lampRef}`;
  } else {
    placement = `On the floor beside the seating stands a single ${lampNoun} ${lampRef}`;
  }

  // 灯光状态：自然语序（关灯=白天自然光、灯泡暗；开灯=夜晚柔和色温光）。
  const litLine = lit
    ? `It is evening and the lamp is switched on, giving off a soft ${COLOR_TEMP_DESC[profile.color_temp]}, while the rest of the room stays calm and natural.`
    : "It is a bright morning and the lamp is switched OFF: the bulb is completely dark and unlit, with no glow, no warm light and no pink light at all — the whole room is lit only by soft natural daylight coming through the windows.";

  const body = [
    `A real interior photograph of a ${spaceDisplay(room)} on a bright day, styled as ${audience}.`,
    `${scene}.`,
    `${placement}.`,
    scaleLine,
    litLine,
    "Shot with a wide lens showing the whole room, the room and its furniture filling most of the frame; the small lamp blends in as one natural piece of the décor, not an oversized centred product.",
  ].join(" ");

  return `${body}

${PLATFORM_STYLE_RULES[platformStyle]}

Render at ${ASPECT_LABEL[aspect]}.

${STRICT_QUALITY}`;
}

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
  return rooms.map((room, i) => ({
    prompt: buildShotPrompt(profile, room, litPattern[i], platformStyle, aspect),
    room,
    lit: litPattern[i],
    // 单图图生图不再用房间参考图，保留字段兼容上层（始终空串）
    compositionReferenceUrl: "",
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
          space_fit: (asset.space_fit ?? "").split(",").filter(Boolean),
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
        jobId,
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
