import path from "node:path";
import { spawnSync } from "node:child_process";
import { isPathInside, readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [planArgument, mediaArgument] = process.argv.slice(2);
if (!planArgument || !mediaArgument) {
  console.error("Usage: node audit-roughcut-seams.mjs <trim-plan.json> <roughcut-media>");
  process.exit(64);
}

const planPath = path.resolve(planArgument);
const mediaPath = path.resolve(mediaArgument);
const plan = readJson(planPath);
const fps = Number(plan.fps);
const thresholds = [-30, -35, -40];
const minimumSilenceSeconds = 0.02;
const removableClassifications = new Set(["reading-reset", "false-start", "restart", "body-reset", "reset-removed", "duplicate-take"]);
const naturalClassifications = new Set(["natural-pause"]);

const run = (command, argumentsList) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const probe = JSON.parse(run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration",
  "-show_entries", "stream=codec_type",
  "-of", "json",
  mediaPath
]));
const duration = Number(probe.format?.duration);
if (!Number.isFinite(duration) || duration <= 0) throw new Error("Rough cut has no readable duration");
if (!(probe.streams ?? []).some((stream) => stream.codec_type === "audio")) throw new Error("Rough cut has no audio stream");
if (!Number.isFinite(fps) || fps <= 0) throw new Error("Trim plan requires a positive fps");

const detectIntervals = (threshold) => {
  const output = run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", mediaPath,
    "-vn", "-af", `silencedetect=noise=${threshold}dB:d=${minimumSilenceSeconds}`,
    "-f", "null", "-"
  ]);
  const events = [...output.matchAll(/silence_(start|end):\s*([0-9.]+)/g)]
    .map((match) => ({ type: match[1], time: Number(match[2]) }));
  const intervals = [];
  let start = null;
  for (const event of events) {
    if (event.type === "start") {
      start = event.time;
    } else {
      intervals.push({ start: start ?? 0, end: event.time });
      start = null;
    }
  }
  if (start !== null) intervals.push({ start, end: duration });
  return intervals;
};

const intervalsByThreshold = new Map(thresholds.map((threshold) => [threshold, detectIntervals(threshold)]));
const removedBefore = (rangeIndex) => (plan.remove ?? [])
  .slice(0, rangeIndex)
  .reduce((sum, range) => sum + range.end - range.start, 0);
const residualAt = (time, intervals) => {
  const tolerance = 0.5 / fps;
  const interval = intervals.find((candidate) => candidate.start <= time + tolerance && candidate.end >= time - tolerance);
  return interval ? Math.max(0, interval.end - interval.start) : 0;
};
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

const errors = [];
if ((plan.seams ?? []).length !== (plan.remove ?? []).length) {
  errors.push("seams must contain exactly one entry for every removed range");
}
for (const [index, seam] of (plan.seams ?? []).entries()) {
  const range = plan.remove?.[index];
  const outputTime = range ? range.start - removedBefore(index) : NaN;
  const terminalTolerance = 1 / fps;
  const terminalRounding = index === (plan.seams?.length ?? 0) - 1
    && outputTime > duration
    && outputTime <= duration + terminalTolerance;
  if (!Number.isFinite(outputTime) || outputTime < 0 || outputTime > duration && !terminalRounding) {
    errors.push(`${seam.id ?? `seam-${index + 1}`}: outputTime cannot be resolved`);
    continue;
  }
  if (!removableClassifications.has(seam.classification) && !naturalClassifications.has(seam.classification)) {
    errors.push(`${seam.id ?? `seam-${index + 1}`}: unknown seam classification ${seam.classification}`);
    continue;
  }
  const auditedOutputTime = terminalRounding ? duration : outputTime;
  const residualSeconds = thresholds.map((threshold) => residualAt(auditedOutputTime, intervalsByThreshold.get(threshold)));
  const measuredResidualSilenceMs = Number((median(residualSeconds) * 1000).toFixed(3));
  const maximumResidualSilenceMs = removableClassifications.has(seam.classification)
    ? Number(plan.trimProfile?.maximumResidualSilenceMs ?? 80)
    : null;
  const quantizedMaximumMs = maximumResidualSilenceMs === null
    ? null
    : Math.floor(maximumResidualSilenceMs * fps / 1000) / fps * 1000;
  seam.outputTime = Number(auditedOutputTime.toFixed(6));
  seam.measuredResidualSilenceMs = measuredResidualSilenceMs;
  seam.residualSilenceByThresholdMs = Object.fromEntries(
    thresholds.map((threshold, thresholdIndex) => [String(threshold), Number((residualSeconds[thresholdIndex] * 1000).toFixed(3))])
  );
  delete seam.maximumResidualSilenceMs;
  delete seam.automatedAudioPass;
  if (quantizedMaximumMs !== null && measuredResidualSilenceMs > quantizedMaximumMs + 1) {
    errors.push(`${seam.id}: residual silence ${measuredResidualSilenceMs.toFixed(1)}ms exceeds ${quantizedMaximumMs.toFixed(1)}ms`);
  }
}

const jobRoot = path.dirname(path.dirname(planPath));
const mediaRelativePath = isPathInside(jobRoot, mediaPath) ? path.relative(jobRoot, mediaPath) : path.basename(mediaPath);
plan.verification ??= {};
plan.verification.mediaAudit = {
  path: mediaRelativePath,
  sha256: sha256File(mediaPath),
  duration: Number(duration.toFixed(6)),
  thresholdsDb: thresholds,
  minimumSilenceMs: minimumSilenceSeconds * 1000,
  checkedAt: new Date().toISOString()
};
writeJsonAtomic(planPath, plan);

if (errors.length > 0) {
  for (const error of errors) console.error(`Error: ${error}`);
  process.exit(1);
}
console.log(`Rough-cut seam audit passed: ${(plan.seams ?? []).length} seam(s)`);
