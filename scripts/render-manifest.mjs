import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveMotionIndex } from "./motion-index.mjs";
import {
  computeDesignLanguageFingerprint,
  isPathInside,
  readJson,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from "./workflow-utils.mjs";

export const CHUNK_SECONDS = Object.freeze({ minimum: 8, target: 12, maximum: 18 });
const overlaps = (start, end, window) => start < window.endFrame && end > window.startFrame;
const boundaryIsSafe = (frame, intervals) => !intervals.some((interval) => interval.startFrame < frame && frame < interval.endFrame);
const uniqueSorted = (values) => [...new Set(values)].sort((left, right) => left - right);

export const quantizeRenderInterval = (start, end, fps, totalFrames) => ({
  startFrame: Math.max(0, Math.min(totalFrames, Math.floor(Number(start) * fps))),
  endFrame: Math.max(0, Math.min(totalFrames, Math.ceil(Number(end) * fps)))
});

const mergeIntervals = (intervals) => {
  const sorted = intervals
    .filter((interval) => interval.endFrame > interval.startFrame)
    .sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startFrame < previous.endFrame) {
      previous.endFrame = Math.max(previous.endFrame, interval.endFrame);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
};

const continuousBeatIntervals = (beatMap, fps, totalFrames) => {
  const beats = [...(beatMap.beats ?? [])].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  const intervals = [];
  let group = [];
  const flush = () => {
    if (group.length < 2) {
      group = [];
      return;
    }
    intervals.push(quantizeRenderInterval(group[0].start, group.at(-1).end, fps, totalFrames));
    group = [];
  };
  for (const beat of beats) {
    const previous = group.at(-1);
    const sharesContinuousState = previous && (
      (beat.axis === "B" && previous.axis === "B" && beat.start <= previous.end + 1 / fps)
      || (beat.reuseGroup && beat.reuseGroup === previous.reuseGroup)
    );
    if (!sharesContinuousState) flush();
    group.push(beat);
  }
  flush();
  return intervals;
};

export const unsafeRenderIntervals = (beatMap, motionIndex) => {
  const fps = Number(beatMap.fps);
  const totalFrames = Math.ceil(Number(beatMap.duration) * fps);
  const intervals = [];
  for (const beat of motionIndex.beats ?? []) {
    if (beat.modulePath) intervals.push(quantizeRenderInterval(beat.window.start, beat.window.end, fps, totalFrames));
  }
  for (const cue of motionIndex.captions ?? []) {
    intervals.push(quantizeRenderInterval(cue.window.start, cue.window.end, fps, totalFrames));
  }
  intervals.push(...continuousBeatIntervals(beatMap, fps, totalFrames));
  return mergeIntervals(intervals);
};

const nearestSafeBoundary = (anchor, intervals, lower, upper) => {
  const candidates = [anchor, lower, upper];
  for (const interval of intervals) candidates.push(interval.startFrame, interval.endFrame);
  return uniqueSorted(candidates)
    .filter((frame) => frame >= lower && frame <= upper && boundaryIsSafe(frame, intervals))
    .sort((left, right) => Math.abs(left - anchor) - Math.abs(right - anchor) || left - right)[0] ?? null;
};

export const planStableChunkBoundaries = ({
  totalFrames,
  fps,
  unsafeIntervals,
  baselineBoundaries = [],
  minimumSeconds = CHUNK_SECONDS.minimum,
  targetSeconds = CHUNK_SECONDS.target,
  maximumSeconds = CHUNK_SECONDS.maximum
}) => {
  const minimumFrames = Math.max(1, Math.ceil(minimumSeconds * fps));
  const targetFrames = Math.max(minimumFrames, Math.round(targetSeconds * fps));
  const maximumFrames = Math.max(targetFrames, Math.floor(maximumSeconds * fps));
  const baseline = uniqueSorted(baselineBoundaries)
    .filter((frame) => frame > 0 && frame < totalFrames && boundaryIsSafe(frame, unsafeIntervals));
  const candidates = new Set([0, totalFrames, ...baseline]);
  const absoluteAnchors = [];
  for (let anchor = targetFrames; anchor < totalFrames; anchor += targetFrames) absoluteAnchors.push(anchor);
  for (const anchor of absoluteAnchors) {
    if ([...candidates].some((frame) => Math.abs(frame - anchor) < minimumFrames / 2)) continue;
    const boundary = nearestSafeBoundary(
      anchor,
      unsafeIntervals,
      Math.max(1, anchor - (targetFrames - minimumFrames)),
      Math.min(totalFrames - 1, anchor + (maximumFrames - targetFrames))
    );
    if (boundary != null) candidates.add(boundary);
  }

  let boundaries = uniqueSorted([...candidates]);
  const protectedBaseline = new Set(baseline);
  const removeCrowdedBoundary = () => {
    if (boundaries.length <= 2) return false;
    for (let index = 1; index < boundaries.length; index += 1) {
      if (boundaries[index] - boundaries[index - 1] >= minimumFrames) continue;
      if (index === 1) boundaries.splice(index, 1);
      else if (index === boundaries.length - 1) boundaries.splice(index - 1, 1);
      else if (protectedBaseline.has(boundaries[index - 1]) && !protectedBaseline.has(boundaries[index])) boundaries.splice(index, 1);
      else boundaries.splice(index - 1, 1);
      return true;
    }
    return false;
  };
  while (removeCrowdedBoundary()) {}

  const fillOversizedGap = () => {
    for (let index = 1; index < boundaries.length; index += 1) {
      const left = boundaries[index - 1];
      const right = boundaries[index];
      if (right - left <= maximumFrames) continue;
      const firstAbsoluteAnchor = Math.ceil((left + minimumFrames) / targetFrames) * targetFrames;
      const anchor = Math.min(right - minimumFrames, Math.max(left + minimumFrames, firstAbsoluteAnchor));
      const boundary = nearestSafeBoundary(anchor, unsafeIntervals, left + minimumFrames, right - minimumFrames);
      if (boundary == null) continue;
      boundaries.push(boundary);
      boundaries = uniqueSorted(boundaries);
      return true;
    }
    return false;
  };
  while (fillOversizedGap()) {}

  if (boundaries[0] !== 0 || boundaries.at(-1) !== totalFrames) throw new Error("Chunk boundaries do not cover the full timeline");
  for (const boundary of boundaries.slice(1, -1)) {
    if (!boundaryIsSafe(boundary, unsafeIntervals)) throw new Error(`Chunk boundary ${boundary} falls inside an active interval`);
  }
  return boundaries;
};

const baselineBoundariesFrom = (baselineManifest) => baselineManifest?.chunks?.slice(0, -1).map((chunk) => chunk.endFrame) ?? [];
const contentEntry = (chunk) => ({
  id: chunk.id,
  startFrame: chunk.startFrame,
  endFrame: chunk.endFrame,
  beatIds: chunk.beatIds,
  captionCueIds: chunk.captionCueIds,
  dependencySha256: chunk.dependencySha256
});

export const deriveRenderManifest = (jobRootInput, options = {}) => {
  const jobRoot = path.resolve(jobRootInput);
  const beatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
  const designSystem = readJson(path.join(jobRoot, "state", "design-system.json"));
  const packageJson = readJson(path.join(jobRoot, "hyperframes", "package.json"));
  const motionIndex = deriveMotionIndex(jobRoot);
  const authoritativeMediaPath = path.join(jobRoot, workflow.authoritativeMediaPath ?? "");
  if (!workflow.authoritativeMediaPath
    || !isPathInside(jobRoot, authoritativeMediaPath)
    || !fs.existsSync(authoritativeMediaPath)
    || sha256File(authoritativeMediaPath) !== workflow.authoritativeMediaSha256) {
    throw new Error("Render Manifest authoritative media binding is stale");
  }
  const fps = Number(beatMap.fps);
  const duration = Number(beatMap.duration);
  if (!(fps > 0 && duration > 0)) throw new Error("Render Manifest requires positive fps and duration");
  const totalFrames = Math.ceil(duration * fps);
  const baselineManifest = options.baselineManifest ?? null;
  const intervals = unsafeRenderIntervals(beatMap, motionIndex);
  const boundaries = planStableChunkBoundaries({
    totalFrames,
    fps,
    unsafeIntervals: intervals,
    baselineBoundaries: baselineBoundariesFrom(baselineManifest)
  });
  const beatById = new Map((beatMap.beats ?? []).map((beat) => [beat.id, beat]));
  const designLanguageFingerprint = options.designLanguageFingerprint
    ?? computeDesignLanguageFingerprint(jobRoot, workflow.captionMode);
  const shared = {
    authoritativeMediaSha256: workflow.authoritativeMediaSha256,
    designLanguageFingerprint,
    sharedDependencySha256: motionIndex.sharedDependencySha256,
    canvas: designSystem.canvas,
    fps,
    hyperframes: packageJson.devDependencies?.hyperframes,
    gsap: packageJson.devDependencies?.gsap
  };
  const chunks = boundaries.slice(0, -1).map((startFrame, index) => {
    const endFrame = boundaries[index + 1];
    const beats = (motionIndex.beats ?? []).filter((entry) => {
      const window = quantizeRenderInterval(entry.window.start, entry.window.end, fps, totalFrames);
      return overlaps(startFrame, endFrame, window);
    });
    const captions = (motionIndex.captions ?? []).filter((entry) => {
      const window = quantizeRenderInterval(entry.window.start, entry.window.end, fps, totalFrames);
      return overlaps(startFrame, endFrame, window);
    });
    const beatPlan = beats.map((entry) => {
      const beat = beatById.get(entry.beatId);
      return {
        motion: entry,
        plan: beat ? {
          id: beat.id,
          sceneId: beat.sceneId,
          start: beat.start,
          end: beat.end,
          axis: beat.axis,
          reuseGroup: beat.reuseGroup ?? null
        } : null
      };
    });
    const dependencySha256 = sha256Text(JSON.stringify({ shared, startFrame, endFrame, beats: beatPlan, captions }));
    const id = `f${String(startFrame).padStart(6, "0")}-f${String(endFrame).padStart(6, "0")}`;
    return {
      id,
      startFrame,
      endFrame,
      beatIds: beats.map((entry) => entry.beatId),
      captionCueIds: captions.map((entry) => entry.cueId),
      dependencySha256,
      standardKey: sha256Text(JSON.stringify({ dependencySha256, quality: "standard" })),
      highKey: sha256Text(JSON.stringify({ dependencySha256, quality: "high" }))
    };
  });
  const content = {
    schemaVersion: "1.0.0",
    fps,
    width: Number(designSystem.canvas.width),
    height: Number(designSystem.canvas.height),
    totalFrames,
    duration: totalFrames / fps,
    audio: { sourcePath: workflow.authoritativeMediaPath, sourceSha256: workflow.authoritativeMediaSha256 },
    chunks: chunks.map(contentEntry)
  };
  return {
    ...content,
    contentManifestSha256: sha256Text(JSON.stringify(content)),
    chunks
  };
};

export const writeRenderManifest = (jobRootInput, options = {}) => {
  const jobRoot = path.resolve(jobRootInput);
  const manifest = deriveRenderManifest(jobRoot, options);
  const outputPath = path.join(jobRoot, "state", "render-manifest.json");
  writeJsonAtomic(outputPath, manifest);
  return { outputPath, manifest };
};

export const snapshotRenderManifest = (jobRootInput, manifest, revisionId) => {
  const jobRoot = path.resolve(jobRootInput);
  const relativePath = `checkpoints/baselines/revision-${revisionId}-render-manifest.json`;
  const outputPath = path.join(jobRoot, relativePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeJsonAtomic(outputPath, manifest);
  return {
    renderManifestPath: relativePath,
    renderManifestSha256: sha256File(outputPath),
    contentManifestSha256: manifest.contentManifestSha256
  };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, jobRoot] = process.argv.slice(2);
  if (!["generate", "check"].includes(command) || !jobRoot) {
    console.error("Usage: node render-manifest.mjs <generate|check> <job-directory>");
    process.exit(64);
  }
  const outputPath = path.join(path.resolve(jobRoot), "state", "render-manifest.json");
  const expected = deriveRenderManifest(jobRoot);
  if (command === "generate") writeJsonAtomic(outputPath, expected);
  else if (!fs.existsSync(outputPath) || JSON.stringify(readJson(outputPath)) !== JSON.stringify(expected)) {
    throw new Error("Render Manifest is missing or stale");
  }
  console.log(`${command === "generate" ? "Generated" : "Verified"} ${outputPath}`);
}
