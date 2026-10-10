import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";

loadEnvConfig(process.cwd());

async function main() {
  const [{ prisma }, { claimJob }, { processVideoJob }, { runnerReadiness }, { mediaReadiness }] = await Promise.all([
    import("../lib/db"), import("../lib/video/repository"), import("../lib/video/processor"), import("../lib/video/hypit-runner"), import("../lib/video/media"),
  ]);
  const id = `video-${randomUUID()}`;
  let stopping = false;
  let beatBusy = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  const beat = async () => {
    if (beatBusy) return;
    beatBusy = true;
    try {
      await prisma.videoJob.count();
      const media = await mediaReadiness();
      const runner = await runnerReadiness();
      const image = Boolean(process.env.YUNWU_IMAGE_KEY || process.env.YUNWU_API_KEY) && media;
      const video = media && runner.ready;
      const fields = { heartbeat_at: new Date(), image_ready: image, video_ready: video, detail: media ? (runner.ready ? null : "account01 视频环境未就绪") : "FFmpeg 未就绪" };
      await prisma.videoWorker.upsert({ where: { id }, create: { id, ...fields }, update: fields });
    } finally { beatBusy = false; }
  };
  await beat();
  console.info("Video worker started; paid work requires a queued job and persisted consent.");
  const timer = setInterval(() => { void beat().catch(() => console.error("Video worker heartbeat failed.")); }, 20_000);
  try {
    while (!stopping) {
      try {
        const job = await claimJob(id);
        if (job) await processVideoJob(job, id);
        else await new Promise(resolve => setTimeout(resolve, 2_000));
      } catch { console.error("Video worker queue check failed."); await new Promise(resolve => setTimeout(resolve, 5_000)); }
    }
  } finally {
    clearInterval(timer);
    await prisma.videoWorker.deleteMany({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch(() => { console.error("Video worker could not start. Check database and runtime configuration."); process.exitCode = 1; });
