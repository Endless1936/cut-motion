import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import { deriveMotionIndex, writeMotionIndex } from "./motion-index.mjs";
import { isPathInside, readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const padWindow = (window, duration) => ({
  start: Math.max(0, Number((window.start - 0.5).toFixed(6))),
  end: Math.min(duration, Number((window.end + 0.5).toFixed(6)))
});

const mergeWindows = (windows, duration) => {
  const sorted = windows.map((window) => padWindow(window, duration))
    .sort((left, right) => left.start - right.start);
  if (!sorted.length) return [];
  const merged = [{ ...sorted[0] }];
  for (const window of sorted.slice(1)) {
    const previous = merged.at(-1);
    if (window.start <= previous.end + 1e-6) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
};

const assertBoundFile = (jobRoot, relativePath, expectedSha256, label) => {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`${label} must be job-relative`);
  const absolutePath = path.resolve(jobRoot, relativePath);
  if (!isPathInside(jobRoot, absolutePath) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`${label} is missing or outside the job`);
  }
  if (sha256File(absolutePath) !== expectedSha256) throw new Error(`${label} SHA-256 is stale`);
  return absolutePath;
};

export const verifyDeltaBindings = (jobRootInput, delta, baseline, options = {}) => {
  const jobRoot = path.resolve(jobRootInput);
  if (!delta || !baseline) throw new Error("Delta bindings require pending delta and preview baseline state");
  if (delta.baselineMotionIndexPath !== baseline.motionIndexPath
    || delta.baselineMotionIndexSha256 !== baseline.motionIndexSha256
    || delta.baselinePreviewPath !== baseline.previewPath
    || delta.baselinePreviewSha256 !== baseline.previewSha256) {
    throw new Error("Delta baseline binding no longer matches workflow.previewBaseline");
  }
  assertBoundFile(jobRoot, delta.baselineMotionIndexPath, delta.baselineMotionIndexSha256, "Delta baseline Motion Index");
  assertBoundFile(jobRoot, delta.baselinePreviewPath, delta.baselinePreviewSha256, "Delta baseline preview");
  if (options.rebuildProduction === true) buildComposition(path.join(jobRoot, "hyperframes"));
  const currentIndexPath = assertBoundFile(
    jobRoot,
    delta.currentMotionIndexPath,
    delta.currentMotionIndexSha256,
    "Delta current Motion Index"
  );
  if (JSON.stringify(readJson(currentIndexPath)) !== JSON.stringify(deriveMotionIndex(jobRoot))) {
    throw new Error("Delta current Motion Index no longer matches its source files");
  }
  assertBoundFile(
    jobRoot,
    delta.productionCompositionPath,
    delta.productionCompositionSha256,
    "Delta production composition"
  );
  return true;
};

export const compareMotionIndexes = (baseline, current) => {
  if (baseline.sharedDependencySha256 !== current.sharedDependencySha256) {
    return { kind: "full", reason: "shared-dependency-changed", windows: [], changedBeatIds: [], changedCaptionCueIds: [] };
  }
  const duration = Math.max(baseline.duration, current.duration);
  const changedBeatIds = [];
  const changedCaptionCueIds = [];
  const affectedWindows = [];
  const compareEntries = (oldEntries, newEntries, idField, changedIds) => {
    const oldById = new Map(oldEntries.map((entry) => [entry[idField], entry]));
    const newById = new Map(newEntries.map((entry) => [entry[idField], entry]));
    for (const id of [...new Set([...oldById.keys(), ...newById.keys()])].sort()) {
      const oldEntry = oldById.get(id);
      const newEntry = newById.get(id);
      if (equal(oldEntry, newEntry)) continue;
      changedIds.push(id);
      if (oldEntry?.window) affectedWindows.push(oldEntry.window);
      if (newEntry?.window) affectedWindows.push(newEntry.window);
    }
  };
  compareEntries(baseline.beats, current.beats, "beatId", changedBeatIds);
  compareEntries(baseline.captions, current.captions, "cueId", changedCaptionCueIds);
  if (!affectedWindows.length) {
    return { kind: "none", reason: "no-rendered-input-change", windows: [], changedBeatIds, changedCaptionCueIds };
  }
  return {
    kind: "delta",
    reason: "localized-rendered-input-change",
    windows: mergeWindows(affectedWindows, duration),
    changedBeatIds,
    changedCaptionCueIds
  };
};

export const createPreviewBaseline = (jobRootInput, revisionId, previewRelativePath) => {
  const jobRoot = path.resolve(jobRootInput);
  const { index } = writeMotionIndex(jobRoot);
  const relativePath = `checkpoints/baselines/revision-${revisionId}-motion-index.json`;
  const snapshotPath = path.join(jobRoot, relativePath);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  writeJsonAtomic(snapshotPath, index);
  const previewPath = path.join(jobRoot, previewRelativePath);
  return {
    previewPath: previewRelativePath,
    previewSha256: sha256File(previewPath),
    motionIndexPath: relativePath,
    motionIndexSha256: sha256File(snapshotPath),
    revisionId
  };
};

export const planDeltaPreview = (jobRootInput, baselineRelativePath) => {
  const jobRoot = path.resolve(jobRootInput);
  const baselinePath = path.join(jobRoot, baselineRelativePath);
  if (!fs.existsSync(baselinePath)) return { kind: "full", reason: "baseline-index-missing", windows: [], changedBeatIds: [], changedCaptionCueIds: [] };
  const baseline = readJson(baselinePath);
  const current = deriveMotionIndex(jobRoot);
  return compareMotionIndexes(baseline, current);
};

export const buildDeltaCompositions = (jobRootInput, plan) => {
  const jobRoot = path.resolve(jobRootInput);
  if (plan.kind !== "delta") throw new Error(`Cannot build delta composition for ${plan.kind}`);
  const directory = path.join(jobRoot, "hyperframes", "delta");
  fs.mkdirSync(directory, { recursive: true });
  return plan.windows.map((window, index) => {
    const outputPath = path.join(
      directory,
      `window-${String(index + 1).padStart(2, "0")}`,
      "index.html"
    );
    return buildComposition(path.join(jobRoot, "hyperframes"), {
      windowStart: window.start,
      windowEnd: window.end,
      localizeResources: true,
      outputPath
    });
  });
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, jobRoot, value] = process.argv.slice(2);
  if (!command || !jobRoot) {
    console.error("Usage: node delta-preview.mjs <baseline|plan|build|verify> <job-directory> <revision-id|baseline-index-path>");
    process.exit(64);
  }
  if (command === "verify") {
    const workflow = readJson(path.join(path.resolve(jobRoot), "state", "workflow.json"));
    if (workflow.pendingDeltaPreview) {
      verifyDeltaBindings(jobRoot, workflow.pendingDeltaPreview, workflow.previewBaseline, { rebuildProduction: false });
      console.log("Delta bindings are current");
    } else {
      console.log("No pending delta bindings");
    }
  } else if (command === "baseline") {
    const previewRelativePath = process.argv[5];
    if (!value || !previewRelativePath) throw new Error("baseline requires revision ID and preview-relative path");
    console.log(JSON.stringify(createPreviewBaseline(jobRoot, Number(value), previewRelativePath), null, 2));
  } else {
    if (!value) throw new Error(`${command} requires a baseline Motion Index path`);
    const plan = planDeltaPreview(jobRoot, value);
    if (command === "plan") console.log(JSON.stringify(plan, null, 2));
    else if (command === "build") console.log(JSON.stringify(buildDeltaCompositions(jobRoot, plan), null, 2));
    else throw new Error(`Unknown delta-preview command: ${command}`);
  }
}
