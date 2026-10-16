import { NextRequest } from "next/server";
import { requireVideoUser, requireVideoWorker, videoRoute } from "@/lib/video/http";
import { apiJson } from "@/lib/public-api";
import { prepareVideoDraft } from "@/lib/video/job-quota";
import { ownedVideoJob, viewVideoJob } from "@/lib/video/projects";
import { generationMode } from "@/lib/video/reference-inputs";
import { videoData } from "@/lib/video/types";
import { assertSixStartStatePlan, SixReferencePlanError } from "@/lib/video/six-reference-plan";
export async function POST(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser(request);
  const job = await ownedVideoJob(params.id, user.id);
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
  const result = await prepareVideoDraft(user.id, job.id, { admissionError });
  if (!result.ok) return apiJson(result.body, { status: result.status });
  return apiJson({ project: await viewVideoJob(job.id, user.id) }, { status: result.value.queued ? 202 : 200 });
}); }
