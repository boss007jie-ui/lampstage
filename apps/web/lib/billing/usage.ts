import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { recordedImageModel, type ImageModelId } from "../image-models";

type BillingSnapshot = {
  mode: "standard" | "internal_test" | null;
  quoted_credits: number | null;
  charged_credits: number | null;
};

export type ProviderAttemptView = {
  index: number;
  status: "intent" | "not_submitted" | "response_received" | "unknown";
  http_status: number | null;
  image_ready: boolean | null;
  duration_ms: number | null;
  tokens: { source: "provider_reported"; input_tokens: number | null; output_tokens: number | null;
    total_tokens: number | null; cached_tokens: number | null } | null;
};

export type AccountUsageView = {
  totals: {
    image_jobs: number;
    delivered_images: number;
    /** Sum of immutable GenerationJob.credit_cost quotes, including failed jobs. */
    quoted_platform_tokens: number;
    video_jobs: number;
    /** Permits are durable reservations/intent, not confirmed paid provider calls. */
    video_attempts_reserved: number;
  };
  recent_images: Array<{
    id: string;
    status: string;
    model: ImageModelId | null;
    requested_images: number | null;
    delivered_images: number;
    quoted_platform_tokens: number;
    billing: BillingSnapshot;
    provider_attempts: ProviderAttemptView[];
    created_at: string;
  }>;
  recent_videos: Array<{
    id: string;
    status: string;
    generation_mode: "legacy_frames" | "direct_references" | "six_references" | null;
    planned_duration_seconds: number | null;
    candidate_durations_seconds: Array<{ segment_index: number; duration_seconds: number }>;
    output_duration_seconds: number | null;
    quoted_video_coins: number | null;
    actual_video_coins: null;
    attempts_reserved: number;
    created_at: string;
  }>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function duration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86400 ? value : null;
}

/** Project only known numeric/enum usage fields. Metadata can include private references and prompts. */
export function imageUsageMetadata(metadata: unknown): {
  requested_images: number | null; billing: BillingSnapshot; provider_attempts: ProviderAttemptView[];
} {
  const top = record(metadata);
  const usage = record(top?.usage);
  const billing = record(top?.billing);
  const rawAttempts = Array.isArray(usage?.provider_attempts) ? usage.provider_attempts.slice(0, 100) : [];
  return {
    requested_images: nonnegativeInteger(usage?.requested_images) ?? nonnegativeInteger(top?.image_count),
    billing: {
      mode: billing?.mode === "standard" || billing?.mode === "internal_test" ? billing.mode : null,
      quoted_credits: nonnegativeInteger(billing?.quoted_credits),
      charged_credits: nonnegativeInteger(billing?.charged_credits),
    },
    provider_attempts: rawAttempts.flatMap((raw, position) => {
      const attempt = record(raw);
      if (!attempt) return [];
      const rawTokens = record(attempt.tokens);
      const status = attempt.status;
      return [{
        index: nonnegativeInteger(attempt.index) ?? position,
        status: status === "intent" || status === "not_submitted" || status === "response_received" ? status : "unknown" as const,
        http_status: typeof attempt.http_status === "number" && Number.isInteger(attempt.http_status) && attempt.http_status >= 100 && attempt.http_status <= 599 ? attempt.http_status : null,
        image_ready: typeof attempt.image_ready === "boolean" ? attempt.image_ready : null,
        duration_ms: nonnegativeInteger(attempt.duration_ms),
        tokens: rawTokens?.source === "provider_reported" ? {
          source: "provider_reported",
          input_tokens: nonnegativeInteger(rawTokens.input_tokens),
          output_tokens: nonnegativeInteger(rawTokens.output_tokens),
          total_tokens: nonnegativeInteger(rawTokens.total_tokens),
          cached_tokens: nonnegativeInteger(rawTokens.cached_tokens),
        } : null,
      }];
    }),
  };
}

export function videoUsageData(data: unknown): Pick<AccountUsageView["recent_videos"][number],
  "generation_mode" | "planned_duration_seconds" | "candidate_durations_seconds" | "output_duration_seconds" | "quoted_video_coins" | "actual_video_coins"> {
  const top = record(data);
  const mode = top === null ? null : top.generationMode === undefined ? "legacy_frames" : top.generationMode;
  const segments = Array.isArray(top?.segments) ? top.segments.slice(0, 100) : null;
  const durations = segments?.map(item => duration(record(item)?.duration));
  // Segments describe upstream requested renders; a draft with no segments has no request yet.
  const requestedDuration = durations && durations.length > 0 && (top?.segments as unknown[]).length <= 100 && durations.every(value => value !== null)
    ? durations.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const candidateDurations = segments?.flatMap((item, index) => {
    const segment = record(item);
    const measured = duration(record(segment?.candidateMedia)?.duration);
    return measured === null ? [] : [{ segment_index: nonnegativeInteger(segment?.index) ?? index, duration_seconds: measured }];
  }) ?? [];
  const consent = record(top?.renderConsent);
  return {
    generation_mode: mode === "legacy_frames" || mode === "direct_references" || mode === "six_references" ? mode : null,
    planned_duration_seconds: requestedDuration,
    candidate_durations_seconds: candidateDurations,
    output_duration_seconds: duration(record(top?.outputMedia)?.duration),
    quoted_video_coins: consent?.pricingBasis === "configured_quote" ? nonnegativeInteger(consent.estimatedCoins) : null,
    actual_video_coins: null,
  };
}

/** All aggregates are owner-scoped and all history totals are computed before bounding recent rows. */
export async function getAccountUsage(userId: string, db: PrismaClient = prisma): Promise<AccountUsageView> {
  const owner = { user_id: userId };
  const [imageJobs, imageQuote, deliveredImages, videoJobs, permitCount, recentImages, recentVideos] = await Promise.all([
    db.generationJob.count({ where: owner }),
    db.generationJob.aggregate({ where: owner, _sum: { credit_cost: true } }),
    db.outputImage.count({ where: { job: owner } }),
    db.videoJob.count({ where: owner }),
    db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "VideoPermit" p JOIN "VideoJob" j ON j.id = p.job_id WHERE j.user_id = ${userId}`),
    db.generationJob.findMany({ where: owner, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, status: true, created_at: true, credit_cost: true, metadata: true, _count: { select: { outputs: true } } } }),
    db.videoJob.findMany({ where: owner, orderBy: [{ created_at: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, status: true, created_at: true, data: true } }),
  ]);
  const recentPermitCounts = recentVideos.length ? await db.videoPermit.groupBy({
    by: ["job_id"], where: { job_id: { in: recentVideos.map(job => job.id) } }, _count: { _all: true },
  }) : [];
  const permitsByJob = new Map(recentPermitCounts.map(row => [row.job_id, row._count._all]));
  return {
    totals: {
      image_jobs: imageJobs,
      delivered_images: deliveredImages,
      quoted_platform_tokens: imageQuote._sum.credit_cost ?? 0,
      video_jobs: videoJobs,
      video_attempts_reserved: Number(permitCount[0]?.count ?? 0),
    },
    recent_images: recentImages.map(job => ({
      id: job.id, status: job.status, model: recordedImageModel(job.metadata),
      ...imageUsageMetadata(job.metadata), delivered_images: job._count.outputs,
      quoted_platform_tokens: job.credit_cost, created_at: job.created_at.toISOString(),
    })),
    recent_videos: recentVideos.map(job => ({
      id: job.id, status: job.status, ...videoUsageData(job.data),
      attempts_reserved: permitsByJob.get(job.id) ?? 0, created_at: job.created_at.toISOString(),
    })),
  };
}
