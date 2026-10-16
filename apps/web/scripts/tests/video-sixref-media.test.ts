import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { probeMedia } from "../../lib/video/media";
import { prepareSixMotionSegment, extractSixCandidateTail, assembleSixVideo } from "../../lib/video/sixref-media";
import type { VideoSegment } from "../../lib/video/types";

const enabled = process.env.RUN_VIDEO_MEDIA_TESTS === "1";
const ffmpeg = process.env.VIDEO_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.VIDEO_FFPROBE_PATH || "ffprobe";
const exec = promisify(execFile);

async function ff(args: string[]) {
  await exec(ffmpeg, ["-nostdin", "-y", "-v", "error", ...args], { windowsHide: true, timeout: 180_000 });
}

async function withWorkspace(callback: (workspace: string) => Promise<void>) {
  const base = path.resolve(os.tmpdir());
  const workspace = await mkdtemp(path.join(base, "lamp-sixref-test-"));
  try { await callback(workspace); }
  finally {
    const resolved = path.resolve(workspace);
    assert.equal(path.dirname(resolved), base);
    assert.ok(path.basename(resolved).startsWith("lamp-sixref-test-"));
    await rm(resolved, { recursive: true, force: true });
  }
}

function segment(window: number): VideoSegment {
  return { index: 0, start: 0, duration: 5, trimStart: 0, sourceWindowDuration: window };
}

async function centerRgb(image: string) {
  const { data } = await sharp(image).resize(1, 1).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data];
}

test("six-reference motion guide covers the source action and supplies a 48 kHz mono AAC silence track", { skip: !enabled }, async () => {
  await withWorkspace(async workspace => {
    const source = path.join(workspace, "silent-source.mp4");
    await ff(["-f", "lavfi", "-i", "testsrc2=size=180x320:rate=30", "-t", "5.166667",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source]);
    const guide = await prepareSixMotionSegment(source, segment(5.166667), workspace);
    const info = await probeMedia(guide);
    assert.ok(Math.abs(info.duration - 5) <= 0.12);
    assert.equal(info.width, 720);
    assert.equal(info.height, 1280);
    assert.equal(info.hasAudio, true);
    assert.ok((await stat(guide)).size <= 30 * 1024 * 1024);
    const { stdout } = await exec(ffprobe, ["-v", "error", "-select_streams", "a:0", "-show_entries",
      "stream=sample_rate,channels,codec_name", "-of", "json", guide], { windowsHide: true });
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(stream.sample_rate, "48000");
    assert.equal(stream.channels, 1);
    assert.equal(stream.codec_name, "aac");
    await assert.rejects(prepareSixMotionSegment(source, segment(5.3), workspace));
  });
});

test("actual last frame and whole 5.1667 second candidate survive a five second retime", { skip: !enabled }, async () => {
  await withWorkspace(async workspace => {
    const candidate = path.join(workspace, "candidate.mp4");
    await ff(["-f", "lavfi", "-t", "4.5", "-i", "color=c=blue:size=180x320:rate=30",
      "-f", "lavfi", "-t", "0.666667", "-i", "color=c=red:size=180x320:rate=30",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", candidate]);
    const tailFile = path.join(workspace, "tail.png");
    const tail = await extractSixCandidateTail(candidate, tailFile);
    assert.equal(tail.file, tailFile);
    assert.ok((tail.frameCount ?? 0) >= 154);
    assert.ok(Math.abs(tail.media.duration - 5.166667) <= 0.05);
    const tailRgb = await centerRgb(tailFile);
    assert.ok(tailRgb[0] > 190 && tailRgb[2] < 70, `tail is red: ${tailRgb}`);

    const source = path.join(workspace, "source-with-audio.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=black:size=180x320:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    const output = await assembleSixVideo({ candidates: [candidate], segments: [segment(5)], source,
      duration: 5, preserveAudio: true, workspace });
    const info = await probeMedia(output);
    assert.ok(Math.abs(info.duration - 5) <= 0.12);
    assert.equal(info.width, 720);
    assert.equal(info.height, 1280);
    assert.equal(info.hasAudio, true);
    const lastOutput = path.join(workspace, "output-last.png");
    await extractSixCandidateTail(output, lastOutput);
    const outputRgb = await centerRgb(lastOutput);
    assert.ok(outputRgb[0] > 190 && outputRgb[2] < 70, `final action tail is retained: ${outputRgb}`);

    const tooShort = path.join(workspace, "short.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=green:size=180x320:rate=30", "-t", "4",
      "-c:v", "libx264", "-preset", "ultrafast", tooShort]);
    await assert.rejects(assembleSixVideo({ candidates: [tooShort], segments: [segment(5)], source,
      duration: 5, preserveAudio: false, workspace }));
  });
});

test("a 16.3 second three-window assembly applies reviewed leading trim and keeps the final 5.3 second action window", { skip: !enabled }, async () => {
  await withWorkspace(async workspace => {
    const candidateLengths = [5.166667, 6.583333, 5.166667];
    const colors = ["blue", "green", "red"];
    const candidates: string[] = [];
    for (let i = 0; i < candidateLengths.length; i++) {
      const file = path.join(workspace, `candidate-${i}.mp4`);
      await ff(["-f", "lavfi", "-i", `color=c=${colors[i]}:size=180x320:rate=30`,
        "-t", String(candidateLengths[i]), "-c:v", "libx264", "-preset", "ultrafast", file]);
      candidates.push(file);
    }
    const source = path.join(workspace, "source.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=black:size=180x320:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "16.3",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", source]);
    const segments: VideoSegment[] = [
      { index: 0, start: 0, duration: 5, trimStart: 0, sourceWindowDuration: 5 },
      { index: 1, start: 5, duration: 6, trimStart: 0, sourceWindowDuration: 6, candidateTrimStart: 0.8 },
      { index: 2, start: 11, duration: 5, trimStart: 0, sourceWindowDuration: 5.3 },
    ];
    const output = await assembleSixVideo({ candidates, segments, source, duration: 16.3,
      preserveAudio: true, workspace });
    const info = await probeMedia(output);
    assert.ok(Math.abs(info.duration - 16.3) <= 0.12, `final duration ${info.duration}`);
    const tail = path.join(workspace, "last-frame.png");
    await extractSixCandidateTail(output, tail);
    const rgb = await centerRgb(tail);
    assert.ok(rgb[0] > 190 && rgb[2] < 70, `final segment remains red: ${rgb}`);
  });
});

test("24fps candidates keep a contiguous 489-frame delivery across fractional action windows", { skip: !enabled }, async () => {
  await withWorkspace(async workspace => {
    const candidates: string[] = [];
    for (const [index, frames] of [124, 158, 124].entries()) {
      const candidate = path.join(workspace, `candidate-${index}.mp4`);
      // A red ending makes a lost action tail visible, including when a segment is sped up.
      await ff(["-f", "lavfi", "-i", `color=c=blue:size=180x320:rate=24,drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='eq(n,${frames - 1})'`,
        "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=32000", "-t", String(frames / 24),
        "-frames:v", String(frames), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", candidate]);
      candidates.push(candidate);
    }
    const source = path.join(workspace, "source.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=black:size=180x320:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "16.3",
      "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", source]);
    const pcm = async (file: string) => (await exec(ffmpeg, ["-nostdin", "-v", "error", "-i", file,
      "-map", "0:a:0", "-t", "16.3", "-ac", "1", "-ar", "44100", "-f", "f32le", "pipe:1"],
    { windowsHide: true, encoding: "buffer", maxBuffer: 4 * 1024 * 1024 })).stdout;
    const sourceAudio = await pcm(source);

    // First case is the production failure on FFmpeg 5.1 (rounded MP4 duration at concat).
    // Second case catches independent rounding of window lengths losing a delivery frame.
    for (const windows of [[4.8, 6.166667, 5.333333], [4.816, 6.183, 5.301]]) {
      let cursor = 0;
      const segments = windows.map((window, index): VideoSegment => {
        const result = { index, start: cursor, duration: index === 1 ? 6 as const : 5 as const,
          trimStart: 0, sourceWindowDuration: window };
        cursor += window;
        return result;
      });
      const output = await assembleSixVideo({ candidates, segments, source, duration: 16.3,
        preserveAudio: true, workspace });
      const final = await extractSixCandidateTail(output, path.join(workspace, "final-tail.png"));
      assert.equal(final.fps, 30, `constant delivery fps for ${windows}`);
      assert.equal(final.frameCount, 489, `complete delivery frame budget for ${windows}`);
      assert.ok(Math.abs(final.media.duration - 16.3) < 1 / 30000);
      assert.equal(final.media.hasAudio, true);
      const outputAudio = await pcm(output);
      assert.equal(outputAudio.length, sourceAudio.length, "source audio covers the complete delivery duration");
      let cross = 0, sourceEnergy = 0, outputEnergy = 0;
      for (let offset = 0; offset < sourceAudio.length; offset += 4) {
        const original = sourceAudio.readFloatLE(offset), delivered = outputAudio.readFloatLE(offset);
        cross += original * delivered; sourceEnergy += original ** 2; outputEnergy += delivered ** 2;
      }
      assert.ok(cross / Math.sqrt(sourceEnergy * outputEnergy) > 0.995,
        "delivered audio matches the original 440Hz track in time, not the generated 880Hz tracks");

      const { stdout } = await exec(ffprobe, ["-v", "error", "-select_streams", "v:0",
        "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", output], { windowsHide: true });
      const timestamps = JSON.parse(stdout).frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time));
      for (const [index, timestamp] of timestamps.entries()) {
        assert.ok(Math.abs(timestamp - index / 30) < 1 / 30000, `frame ${index} is on the delivery timeline: ${timestamp}`);
      }
      for (let index = 0; index < segments.length; index++) {
        const tail = path.join(workspace, `normalized-tail-${index}.png`);
        await extractSixCandidateTail(path.join(workspace, `six-normalized-${index}.mp4`), tail);
        const rgb = await centerRgb(tail);
        assert.ok(rgb[0] > 190 && rgb[2] < 70, `segment ${index} retains its action ending: ${rgb}`);
      }
    }
  });
});

test("107帧24fps候选拒绝未审阅剪辑，显式0.21秒剪辑可交付111帧并保留实际末帧", { skip: !enabled }, async () => {
  await withWorkspace(async workspace => {
    const candidate = path.join(workspace, "candidate-107.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=blue:size=180x320:rate=24,drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='eq(n,106)'",
      "-frames:v", "107", "-c:v", "libx264", "-preset", "ultrafast", candidate]);
    const source = path.join(workspace, "source.mp4");
    await ff(["-f", "lavfi", "-i", "color=c=black:size=180x320:rate=30", "-t", "3.734",
      "-c:v", "libx264", "-preset", "ultrafast", source]);
    const reviewed: VideoSegment = { index: 0, start: 0, duration: 4, trimStart: 0, sourceWindowDuration: 3.711 };
    const input = { candidates: [candidate], segments: [reviewed], source, duration: 3.711, preserveAudio: false, workspace };
    await assert.rejects(assembleSixVideo(input), /15%/);
    reviewed.candidateTrimStart = 0.21;
    const output = await assembleSixVideo(input);
    const tail = await extractSixCandidateTail(output, path.join(workspace, "output-tail.png"));
    assert.equal(tail.frameCount, 111);
    assert.equal(tail.fps, 30);
    assert.ok(Math.abs(tail.media.duration - 3.7) < 1 / 30000);
    assert.equal(reviewed.candidateTrimStart, 0.21);
    const rgb = await centerRgb(tail.file);
    assert.ok(rgb[0] > 190 && rgb[2] < 70, `实际末帧保留: ${rgb}`);
  });
});
