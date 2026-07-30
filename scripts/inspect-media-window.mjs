import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DIAGNOSTIC_SCHEMA_VERSION } from "./diagnostic-contract.mjs";
import {
  assertRegularContainedFile,
  isPathInside,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [jobArgument, mediaArgument, startArgument, endArgument, ...rawOptions] = process.argv.slice(2);
if (!jobArgument || !mediaArgument || startArgument == null || endArgument == null) {
  console.error("Usage: node inspect-media-window.mjs <job> <job-relative-media> <start> <end> [--frames 4-12] [--label name]");
  process.exit(64);
}

const options = {};
for (let index = 0; index < rawOptions.length; index += 2) {
  options[rawOptions[index]?.replace(/^--/, "")] = rawOptions[index + 1];
}

const run = (command, argumentsList, label) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
};

const jobRoot = fs.realpathSync(path.resolve(jobArgument));
const jobStat = fs.lstatSync(jobRoot);
if (!jobStat.isDirectory() || jobStat.isSymbolicLink()) throw new Error("Job must be a non-symlink directory");
if (path.isAbsolute(mediaArgument)) throw new Error("Media path must be job-relative");
const mediaPath = path.resolve(jobRoot, mediaArgument);
assertRegularContainedFile(jobRoot, mediaPath, "Diagnostic media");

const probe = JSON.parse(run(
  "ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type", "-of", "json", mediaPath],
  "Media probe failed"
) || "{}");
const mediaDuration = Number(probe.format?.duration);
const streamTypes = new Set((probe.streams ?? []).map((stream) => stream.codec_type));
if (!(mediaDuration > 0) || !streamTypes.has("video") || !streamTypes.has("audio")) {
  throw new Error("Diagnostic media requires readable video and audio streams");
}

const start = Number(startArgument);
const end = Number(endArgument);
const windowDuration = end - start;
const frameCount = Number(options.frames ?? 8);
if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > mediaDuration + 0.01) {
  throw new Error("Diagnostic window must stay inside the media duration");
}
if (windowDuration < 0.25 || windowDuration > 8) throw new Error("Diagnostic window must be 0.25–8 seconds");
if (!Number.isInteger(frameCount) || frameCount < 4 || frameCount > 12) throw new Error("--frames must be an integer from 4 to 12");

const checkpointRoot = path.join(jobRoot, "checkpoints");
const checkpointStat = fs.lstatSync(checkpointRoot);
if (!checkpointStat.isDirectory() || checkpointStat.isSymbolicLink()) throw new Error("Job checkpoints must be a non-symlink directory");
const outputDirectory = path.join(checkpointRoot, "diagnostics");
fs.mkdirSync(outputDirectory, { recursive: true });
if (!isPathInside(checkpointRoot, fs.realpathSync(outputDirectory))) throw new Error("Diagnostic output escapes checkpoints/");

const mediaName = path.basename(mediaArgument, path.extname(mediaArgument)).replace(/[^a-zA-Z0-9_-]+/g, "-");
const label = String(options.label ?? "window").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "window";
const outputName = `${mediaName}-${label}-${start.toFixed(3)}-${end.toFixed(3)}.png`;
const outputPath = path.join(outputDirectory, outputName);
const manifestPath = outputPath.replace(/\.png$/i, ".json");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-diagnostic-"));
const frameWidth = 240;
const frameHeight = 180;
const compositeWidth = frameWidth * frameCount;

try {
  const frameTimes = [];
  for (let index = 0; index < frameCount; index += 1) {
    const fraction = frameCount === 1 ? 0.5 : index / (frameCount - 1);
    const time = Math.min(end - 0.001, start + windowDuration * fraction);
    frameTimes.push(time);
    run(
      "ffmpeg",
      [
        "-loglevel", "error", "-y", "-ss", time.toFixed(6), "-i", mediaPath,
        "-frames:v", "1",
        "-vf", `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2:color=0x121216`,
        path.join(temporaryRoot, `frame-${String(index).padStart(3, "0")}.png`)
      ],
      `Frame extraction failed at ${time.toFixed(3)}s`
    );
  }

  const filmstripPath = path.join(temporaryRoot, "filmstrip.png");
  run(
    "ffmpeg",
    [
      "-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(temporaryRoot, "frame-%03d.png"),
      "-vf", `tile=${frameCount}x1`, "-frames:v", "1", filmstripPath
    ],
    "Filmstrip assembly failed"
  );

  const waveformPath = path.join(temporaryRoot, "waveform.png");
  run(
    "ffmpeg",
    [
      "-loglevel", "error", "-y", "-ss", start.toFixed(6), "-t", windowDuration.toFixed(6), "-i", mediaPath,
      "-filter_complex", `[0:a]aformat=channel_layouts=mono,showwavespic=s=${compositeWidth}x220:colors=0x8CB4FF[wave]`,
      "-map", "[wave]", "-frames:v", "1", waveformPath
    ],
    "Waveform rendering failed"
  );

  run(
    "ffmpeg",
    [
      "-loglevel", "error", "-y", "-i", filmstripPath, "-i", waveformPath,
      "-filter_complex", "[0:v][1:v]vstack=inputs=2,format=rgb24[out]",
      "-map", "[out]", "-frames:v", "1", outputPath
    ],
    "Diagnostic composition failed"
  );

  writeJsonAtomic(manifestPath, {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    kind: "filmstrip-waveform",
    generator: "inspect-media-window.mjs",
    media: {
      path: path.relative(jobRoot, mediaPath),
      sha256: sha256File(mediaPath)
    },
    window: { start, end },
    frameTimes,
    image: {
      path: path.relative(jobRoot, outputPath),
      sha256: sha256File(outputPath)
    }
  });
  console.log(path.relative(jobRoot, manifestPath));
  console.error(`Frame times: ${frameTimes.map((time) => time.toFixed(3)).join(", ")}`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
