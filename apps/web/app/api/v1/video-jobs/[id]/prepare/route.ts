import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { requireVideoWorker } from "@/lib/video/http";
import { generationMode } from "@/lib/video/reference-inputs";
import { videoData } from "@/lib/video/types";
import { prepareVideoDraft } from "@/lib/video/job-quota";
import { lifecycleHttp } from "@/lib/video/job-management-http";
import { assertSixStartStatePlan, SixReferencePlanError } from "@/lib/video/six-reference-plan";

export const runtime = "nodejs";

/** Queue preparation using the immutable mode recorded when this job was created. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.auth.user.id } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  let admissionError: string | undefined;
  if (job.status === "draft") {
    const mode = generationMode(videoData(job.data));
    if (mode === "six_references") {
      try { assertSixStartStatePlan(videoData(job.data)); }
      catch (error) {
        if (error instanceof SixReferencePlanError) return apiJson({ error: "invalid_video_references", message: error.message }, { status: 400 });
        throw error;
      }
    }
    const direct = mode !== "legacy_frames";
    try { await requireVideoWorker(direct, !direct, mode); }
    catch { admissionError = "视频处理服务尚未就绪或已暂停，请稍后查看现有任务。"; }
  }
  const result = await prepareVideoDraft(auth.auth.user.id, job.id, { admissionError });
  if (!result.ok) return apiJson(result.body, { status: result.status });
  return apiJson({ id: job.id, job_id: job.id, status: result.value.job.status, ...(result.value.queued ? { phase: "prepare" } : {}) }, { status: result.value.queued ? 202 : 200 });
}); }
