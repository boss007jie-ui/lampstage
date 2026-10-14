import type { VideoJob } from "@prisma/client";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { getObjectBytes } from "@/lib/storage";
import { generateReference, videoDirection } from "./image-reference";
import { collectH3, inspectH3, recoverH3Submission, resumeH3Worker, runnerReadiness, submitH3 } from "./hypit-runner";
import { assembleVideo, inspectSource, prepareSegment, segmentTimeline, VideoPipelineError } from "./media";
import { heartbeatLease, LeaseLostError, patchJob, releaseJob } from "./repository";
import { privateDownloadTo, privateUploadFile, privateWrite } from "./storage";
import { segmentCoinQuote, videoData, type VideoJobData, type VideoSegment } from "./types";

/** A persisted intent without a receipt is ambiguous, even if the network call threw. */
export function segmentAction(segment: VideoSegment, reconcile: boolean): "reuse" | "inspect" | "submit" {
  if (segment.candidateKey) return "reuse";
  if (segment.buildId) return "inspect";
  if (segment.submissionIntentAt || reconcile) throw new VideoPipelineError("缺少生成回执，请人工核对；系统不会重复提交。");
  return "submit";
}

/** Reconciliation salvages existing work even when later segments have never been submitted. */
export function reconciliationPlan(segments: VideoSegment[]) {
  return { recoverable: segments.filter(s => s.buildId || s.candidateKey), missing: segments.filter(s => !s.buildId && !s.candidateKey) };
}

export function verifyRenderConsent(data: VideoJobData, currentQuote: number | null, submittingIndex?: number): void {
  const consent = data.renderConsent;
  const indices = consent?.segmentIndices;
  if (!consent || !Number.isFinite(Date.parse(consent.at)) || !Number.isInteger(consent.maxCoins) || consent.maxCoins <= 0 ||
      !Number.isInteger(consent.perSegmentCoins) || consent.perSegmentCoins <= 0 || currentQuote === null ||
      !Number.isInteger(currentQuote) || currentQuote <= 0 || currentQuote > consent.perSegmentCoins || !data.segments.length ||
      !Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
      indices.some(i => !Number.isInteger(i) || !data.segments.some(s => s.index === i)) ||
      data.segments.some(s => !s.candidateKey && !s.buildId && !s.submissionIntentAt && !indices.includes(s.index)) ||
      (submittingIndex !== undefined && !indices.includes(submittingIndex)) ||
      consent.estimatedCoins !== consent.perSegmentCoins * indices.length ||
      consent.estimatedCoins > consent.maxCoins || currentQuote * indices.length > consent.maxCoins) {
    throw new VideoPipelineError("缺少有效的费用确认，或当前上限超出已确认预算。请重新核对费用。");
  }
}

function verifySegments(data: VideoJobData): void {
  const expected = segmentTimeline(data.sourceDuration ?? NaN);
  if (expected.length !== data.segments.length || expected.some((s, i) => {
    const actual = data.segments[i];
    return s.index !== actual.index || s.duration !== actual.duration || Math.abs(s.start - actual.start) > 0.000001 || Math.abs(s.trimStart - actual.trimStart) > 0.000001;
  })) throw new VideoPipelineError("分段记录不完整，请人工核对。");
}

/** Serial processing. Every paid request is preceded by a lease/revision-checked durable intent. */
export async function processVideoJob(initial: VideoJob, workerId: string): Promise<void> {
  let job = initial;
  let data = structuredClone(videoData(job.data));
  let leaseLost = false;
  let terminalSaved = false;
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void heartbeatLease(job.id, workerId).catch(() => { leaseLost = true; }).finally(() => { heartbeatBusy = false; });
  }, 20_000);
  const save = async (fields: { status?: string; phase?: string; stage?: string; error?: string | null } = {}) => {
    if (leaseLost) throw new LeaseLostError();
    job = await patchJob(job.id, workerId, { ...fields, expectedRevision: job.revision }, data);
    if (fields.status && ["review", "completed", "failed", "attention"].includes(fields.status)) terminalSaved = true;
  };
  const checkLease = async () => { if (leaseLost) throw new LeaseLostError(); await heartbeatLease(job.id, workerId); };
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) throw new VideoPipelineError("任务标识无效。");
    const workspace = path.resolve(process.env.VIDEO_WORK_ROOT || path.join(process.cwd(), ".video-work"), job.id);
    await mkdir(workspace, { recursive: true });
    const sourceAsset = await prisma.videoAsset.findFirst({ where: { id: job.source_asset_id, user_id: job.user_id, status: "ready" } });
    if (!sourceAsset) throw new VideoPipelineError("原视频不存在或不可用。");
    const source = path.join(workspace, "source.mp4");
    // 不只信上游的 Content-Length：用数据库记录的真实字节数核对落盘长度，不符即失败。
    await privateDownloadTo(sourceAsset.storage_key, source, { expectedBytes: sourceAsset.size_bytes });

    if (job.phase === "prepare") {
      // Resuming an interrupted image attempt could duplicate a charged request; never infer its failure.
      if (data.imageCalls > 0) throw new VideoPipelineError("已有参考图调用记录，请人工核对；不会自动重试生成。");
      if (!process.env.OPENLUX_API_KEY?.trim()) throw new VideoPipelineError("图像生成服务尚未配置。");
      const info = await inspectSource(source);
      const product = await prisma.uploadedAsset.findFirst({ where: { id: job.product_asset_id, user_id: job.user_id } });
      if (!product) throw new VideoPipelineError("产品图片不存在或无权访问。");
      const productData = await getObjectBytes(product.image_url);
      data = { ...data, sourceDuration: info.duration, sourceHasAudio: info.hasAudio, segments: segmentTimeline(info.duration) };
      await save({ stage: "正在提取分段和首尾画面" });
      for (const segment of data.segments) {
        await checkLease();
        const files = await prepareSegment(source, segment, workspace);
        segment.clipKey = `videos/${job.id}/segments/${segment.index}/source.mp4`;
        await privateUploadFile(segment.clipKey, files.clip, "video/mp4");
        await save();
        for (const endpoint of ["opening", "ending"] as const) {
          data.imageCalls += 1;
          await save({ stage: `正在生成第 ${segment.index + 1} 段${endpoint === "opening" ? "首" : "尾"}帧参考图` });
          const result = await generateReference({ product: productData, frame: await readFile(files[endpoint]), endpoint, instructions: job.instructions, jobId: job.id });
          const key = `videos/${job.id}/segments/${segment.index}/${endpoint}.png`;
          await privateWrite(key, result.bytes, result.mime);
          segment[endpoint === "opening" ? "openingKey" : "endingKey"] = key;
          await save();
        }
      }
      await save({ status: "review", stage: "参考图已就绪，请逐段检查首尾画面" });
      return;
    }

    const reconcile = job.phase === "reconcile";
    if (!reconcile && job.phase !== "render") throw new VideoPipelineError("任务阶段无效。");
    verifySegments(data);
    if (!reconcile) verifyRenderConsent(data, segmentCoinQuote());
    if (reconcile) {
      for (const segment of data.segments) {
        if (!segment.buildId && segment.submissionIntentAt) {
          const receipt = await recoverH3Submission(path.join(workspace, `segment-${segment.index}`));
          if (receipt) { segment.buildId = receipt.buildId; await save({ stage: "已恢复本地回执，正在核对原任务" }); }
        }
      }
    }
    // Reconcile only existing receipts; incomplete later segments cannot block recovery of earlier paid work.
    const plan = reconcile ? reconciliationPlan(data.segments) : { recoverable: data.segments, missing: [] };
    if (!reconcile) for (const segment of data.segments) segmentAction(segment, false);
    const needsRunner = plan.recoverable.some(s => !s.candidateKey);
    if (needsRunner && !(await runnerReadiness()).ready) throw new VideoPipelineError("Minimax H3 account01 工作环境尚未就绪。");
    let productPath = "";
    if (!reconcile && data.segments.some(s => segmentAction(s, false) === "submit")) {
      const product = await prisma.uploadedAsset.findFirst({ where: { id: job.product_asset_id, user_id: job.user_id } });
      if (!product) throw new VideoPipelineError("产品图片不存在或无权访问。");
      const productData = await getObjectBytes(product.image_url);
      productPath = path.join(workspace, "product-image.png");
      await writeFile(productPath, await sharp(productData.bytes).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer());
    }
    for (const segment of plan.recoverable) {
      const action = segmentAction(segment, reconcile);
      if (action === "reuse") continue;
      await checkLease();
      const segmentWorkspace = path.join(workspace, `segment-${segment.index}`);
      await mkdir(segmentWorkspace, { recursive: true });
      if (action === "submit") {
        verifyRenderConsent(data, segmentCoinQuote(), segment.index);
        if (!segment.clipKey || !segment.openingKey || !segment.endingKey) throw new VideoPipelineError("分段参考素材缺失，请先核对参考图。");
        const sourcePath = path.join(segmentWorkspace, "source.mp4");
        const openingPath = path.join(segmentWorkspace, "opening.png");
        const endingPath = path.join(segmentWorkspace, "ending.png");
        const segmentProductPath = path.join(segmentWorkspace, "product.png");
        await copyFile(productPath, segmentProductPath);
        await privateDownloadTo(segment.clipKey, sourcePath);
        await privateDownloadTo(segment.openingKey, openingPath);
        await privateDownloadTo(segment.endingKey, endingPath);
        segment.submissionIntentAt = new Date().toISOString();
        await save({ stage: `正在提交第 ${segment.index + 1} 段视频` });
        const receipt = await submitH3({ workspace: segmentWorkspace, sourcePath, productPath: segmentProductPath, openingPath, endingPath,
          duration: segment.duration, prompt: videoDirection(job.instructions),
          onBuildId: async buildId => { segment.buildId = buildId; await save({ stage: `第 ${segment.index + 1} 段已提交，等待生成` }); },
        });
        if (!segment.buildId && receipt.buildId) { segment.buildId = receipt.buildId; await save(); }
        if (!segment.buildId) throw new VideoPipelineError("提交结果不明确，请人工核对；不会重复提交。");
      }
      if (reconcile) {
        const resumed = await resumeH3Worker({ workspace: segmentWorkspace, buildId: segment.buildId! });
        if (!resumed.ready) throw new VideoPipelineError("原任务尚无法安全恢复，请由管理员核对；不会重复提交。");
        if (resumed.taskId && resumed.taskId !== segment.providerTaskId) { segment.providerTaskId = resumed.taskId; await save(); }
      }
      const deadline = Date.now() + 45 * 60_000;
      while (true) {
        await checkLease();
        const state = await inspectH3({ workspace: segmentWorkspace, buildId: segment.buildId! });
        if (state.taskId && state.taskId !== segment.providerTaskId) { segment.providerTaskId = state.taskId; await save(); }
        if (state.state === "failed") throw new VideoPipelineError("上游生成任务未成功；已保留回执，请人工核对。");
        if (state.state === "unknown") throw new VideoPipelineError("暂时无法确认上游任务状态；已保留回执，可稍后核对。");
        if (state.state === "completed") {
          // Unique export path also permits recovery after a previous collect succeeded but DB persistence failed.
          const target = path.join(segmentWorkspace, `candidate-${job.revision}.mp4`);
          await collectH3({ workspace: segmentWorkspace, buildId: segment.buildId!, to: target });
          const candidateKey = `videos/${job.id}/segments/${segment.index}/candidate.mp4`;
          await privateUploadFile(candidateKey, target, "video/mp4");
          segment.candidateKey = candidateKey;
          await save({ stage: `第 ${segment.index + 1} 段视频已保存` });
          break;
        }
        if (Date.now() > deadline) throw new VideoPipelineError("等待生成超时；已保留回执，可稍后核对，不会重复提交。");
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }
    }
    if (plan.missing.length) {
      if (plan.missing.some(s => s.submissionIntentAt)) throw new VideoPipelineError("原任务已核查，仍有提交缺少回执，请人工核对；系统未发起新生成。");
      await save({ status: "review", stage: "已恢复已生成片段，请确认剩余片段费用", error: null });
      return;
    }
    await save({ status: "assembling", stage: "正在合成并检查完整视频" });
    const candidates: string[] = [];
    for (const segment of data.segments) {
      if (!segment.candidateKey) throw new VideoPipelineError("视频片段缺失。");
      const file = path.join(workspace, `candidate-${segment.index}.mp4`);
      await privateDownloadTo(segment.candidateKey, file);
      candidates.push(file);
    }
    const output = await assembleVideo({ candidates, segments: data.segments, source, duration: data.sourceDuration!, preserveAudio: Boolean(job.preserve_audio && data.sourceHasAudio), workspace });
    await checkLease();
    data.outputKey = `videos/${job.id}/output.mp4`;
    await privateUploadFile(data.outputKey, output, "video/mp4");
    await save({ status: "completed", stage: "完整视频已生成，可预览并下载", error: null });
  } catch (error) {
    if (!(error instanceof LeaseLostError) && !leaseLost) {
      const message = error instanceof VideoPipelineError ? error.message : "视频处理暂未完成；已保留处理记录，请人工核对后继续。";
      try { await save({ status: data.imageCalls > 0 || data.segments.some(s => s.submissionIntentAt || s.buildId) ? "attention" : "failed", stage: "处理暂停，请核对任务", error: message }); } catch { /* A newer lease/revision owns the record. */ }
    }
  } finally {
    clearInterval(heartbeat);
    // If saving the terminal state failed, leave the lease to expire into attention.
    if (terminalSaved) await releaseJob(job.id, workerId).catch(() => undefined);
  }
}
