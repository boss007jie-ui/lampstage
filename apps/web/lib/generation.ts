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

/**
 * 创建生成任务并立即开始执行（不等待完成）。
 *
 * 三路 prompt 来源：
 *   - sceneKind="template" + templateId（旧的快捷模板）
 *   - sceneKind="recommended" + recommendedPromptEn（系统推荐方案的英文 prompt）
 *   - sceneKind="custom" + customPrompt（用户自由描述，中/英文都可）
 */
export async function createAndRunGenerationJob(args: {
  userId: string;
  uploadedAssetId: string;
  sceneKind: "template" | "recommended" | "custom";
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
        | "missing_prompt";
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

      // 三路 prompt 拼接
      let finalPrompt = "";
      let templateId: string | null = null;

      if (args.sceneKind === "template") {
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
          scene_kind: args.sceneKind,
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

  // Step B: 同步 await 整个生成（serverless 不能用 fire-and-forget）
  // 等所有图生成完才返回，前端轮询 GET /api/generation/jobs/[id] 看进度
  await runGenerationPipeline({
    jobId: result.job.id,
    userId: args.userId,
    referenceImageUrl: result.asset.image_url,
    prompt: buildPrompt(result.finalPrompt, args.platformStyle, args.aspectRatio),
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
  prompt: string;
  aspectRatio: AspectRatio;
}) {
  const { jobId, userId, referenceImageUrl, prompt, aspectRatio } = args;
  try {
    // 阶段 1
    await setStage(jobId, "analyzing");
    await sleep(800);

    // 阶段 2
    await setStage(jobId, "matching");
    await sleep(600);

    // 阶段 3：实际并发调用 provider 4 次
    await setStage(jobId, "generating");
    const provider = getProvider();
    const calls = Array.from({ length: OUTPUT_COUNT }, () =>
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
