#!/usr/bin/env node
// Build or refresh state/gap-candidates.json for the talking-head rough-cut standard.
//
// Usage:
//   node scripts/classify-gaps.mjs <job-directory> [--write] [--rebuild]
//
// Without --write the command prints the detected candidates and the path it
// would write. With --write it emits the artifact with every detected candidate
// present and `classification: "unclassified"`, preserving any classification
// already recorded for candidates whose identity is unchanged. Filling in the
// classification is the audio-led editorial decision described by step 4 of
// docs/talking-head-trim-standard.md; detecting and covering the candidates is
// what this command and check-gap-candidates.mjs automate.

import fs from "node:fs";
import path from "node:path";
import { readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";
import {
  DEFAULT_SCAN_THRESHOLDS_DB,
  GAP_CANDIDATE_MINIMUM_SECONDS,
  GAP_REVIEW_EMPHASIS_SECONDS,
  deriveRemovedCandidates,
  detectGapCandidates,
  overlappingThresholds,
  parseSilenceScan,
  silenceSweepCompleted,
  roundTo
} from "./gap-detection.mjs";

const rawArguments = process.argv.slice(2);
const jobArgument = rawArguments.find((argument) => !argument.startsWith("--"));
const write = rawArguments.includes("--write");
const rebuild = rawArguments.includes("--rebuild");
const preCleanupFlagIndex = rawArguments.indexOf("--pre-cleanup-windows");
const preCleanupArgument = preCleanupFlagIndex >= 0 ? rawArguments[preCleanupFlagIndex + 1] : null;

if (!jobArgument) {
  console.error("Usage: node scripts/classify-gaps.mjs <job-directory> [--write] [--rebuild] [--pre-cleanup-windows <path>]");
  process.exit(64);
}

const jobRoot = path.resolve(jobArgument);
const sourceTranscriptPath = path.join(jobRoot, "state", "source-transcript.json");
const timelineWindowsPath = path.join(jobRoot, "state", "timeline-source-windows.json");
const silenceScanPath = path.join(jobRoot, "state", "source-silence-db-scan.txt");
const artifactPath = path.join(jobRoot, "state", "gap-candidates.json");

for (const required of [sourceTranscriptPath, timelineWindowsPath]) {
  if (!fs.existsSync(required)) throw new Error(`Gap detection requires ${path.relative(jobRoot, required)}`);
}

const sourceTranscript = readJson(sourceTranscriptPath);
const timelineWindows = readJson(timelineWindowsPath);
const fps = Number(timelineWindows.timelineFps?.numerator ?? 30) / Number(timelineWindows.timelineFps?.denominator ?? 1);
const silencePresent = fs.existsSync(silenceScanPath);
const silenceText = silencePresent ? fs.readFileSync(silenceScanPath, "utf8") : "";
const silenceIntervals = parseSilenceScan(silenceText);
const sweepApplied = silencePresent && silenceSweepCompleted(silenceText);
const { candidates: detected, skippedItems } = detectGapCandidates({
  sourceTranscript,
  timelineWindows,
  fps,
  silenceIntervals,
  minimumSeconds: GAP_CANDIDATE_MINIMUM_SECONDS
});

const previous = !rebuild && fs.existsSync(artifactPath) ? readJson(artifactPath) : null;
const previousById = new Map((previous?.candidates ?? []).map((entry) => [entry.id, entry]));

const candidates = detected.map((candidate) => {
  const prior = previousById.get(candidate.id) ?? previous?.candidates?.find((entry) => entry.itemId === candidate.itemId
    && Math.abs(entry.sourceStart - candidate.sourceStart) < 0.001 && Math.abs(entry.sourceEnd - candidate.sourceEnd) < 0.001);
  const carried = prior
    && Math.abs(prior.durationSeconds - candidate.durationSeconds) < 0.001
    && Math.abs(prior.sourceStart - candidate.sourceStart) < 0.001;
  return {
    id: candidate.id,
    itemId: candidate.itemId,
    boundary: candidate.tailBoundary ? "tail" : candidate.headBoundary ? "head" : "internal",
    sourceStart: candidate.sourceStart,
    sourceEnd: candidate.sourceEnd,
    durationSeconds: candidate.durationSeconds,
    timelineStart: candidate.timelineStart,
    timelineEnd: candidate.timelineEnd,
    asrGap: candidate.asrGap,
    decibelHits: overlappingThresholds(silenceIntervals, candidate.sourceStart, candidate.sourceEnd),
    classification: carried ? prior.classification : "unclassified",
    reasonCode: carried ? (prior.reasonCode ?? null) : null,
    reason: carried ? (prior.reason ?? null) : null,
    precedingWord: candidate.precedingWord,
    followingWord: candidate.followingWord,
    evidence: carried && prior.evidence
      ? { ...prior.evidence }
      : { audioChecked: false, note: null }
  };
});

// --- the pauses cleanup excised, derived from the pre-cleanup structure ------
const preCleanupPath = preCleanupArgument
  ? path.resolve(process.cwd(), preCleanupArgument)
  : path.join(jobRoot, "state", "timeline-source-windows.pre-cleanup.json");
if (preCleanupArgument && !fs.existsSync(preCleanupPath)) throw new Error(`Missing requested snapshot: ${preCleanupArgument}`);
const baselineKind = previous?.timeline?.baselineKind ?? (fs.existsSync(preCleanupPath) ? "provided" : "current-timeline");
if (write && !fs.existsSync(preCleanupPath)) writeJsonAtomic(preCleanupPath, timelineWindows);
const preCleanupPresent = fs.existsSync(preCleanupPath);
const preCleanupWindows = preCleanupPresent ? readJson(preCleanupPath) : null;
const derivedRemoved = preCleanupPresent
  ? deriveRemovedCandidates({
    sourceTranscript,
    preCleanupWindows,
    finalWindows: timelineWindows,
    silenceIntervals,
    minimumSeconds: GAP_CANDIDATE_MINIMUM_SECONDS
  })
  : [];
const previousRemoved = previous?.removedCandidates ?? [];
const removedCandidates = derivedRemoved.map((entry) => {
  const prior = previousRemoved.find((candidate) => Math.abs(candidate.sourceStart - entry.sourceStart) < 0.02
    && Math.abs(candidate.sourceEnd - entry.sourceEnd) < 0.02)
    ?? previous?.candidates?.find((candidate) => candidate.classification === "remove"
      && candidate.itemId === entry.itemId && candidate.sourceStart <= entry.sourceStart + 0.02
      && candidate.sourceEnd >= entry.sourceEnd - 0.02);
  return {
    ...entry,
    classification: "remove",
    reasonCode: prior?.reasonCode ?? null,
    reason: prior?.reason ?? "",
    evidence: prior?.evidence
      ? { ...prior.evidence }
      : { audioChecked: false, note: null }
  };
});
const orphanedRemoved = previousRemoved.filter((candidate) => !derivedRemoved.some(
  (entry) => Math.abs(candidate.sourceStart - entry.sourceStart) < 0.02 && Math.abs(candidate.sourceEnd - entry.sourceEnd) < 0.02
));

const durationFrames = (timelineWindows.clips ?? []).reduce((total, item) => total + Number(item.durationFrames ?? 0), 0);
const skippedIds = new Set(skippedItems.map((entry) => entry.itemId));
const itemsExamined = (timelineWindows.clips ?? []).filter((item) => !skippedIds.has(item.itemId)).length;
const artifact = {
  schemaVersion: "1.0.0",
  mediaFingerprint: timelineWindows.sourceSha256,
  timeline: {
    baselineKind,
    path: "state/timeline-source-windows.json",
    sha256: sha256File(timelineWindowsPath),
    itemCount: (timelineWindows.clips ?? []).length,
    fps: roundTo(fps),
    durationSeconds: roundTo(durationFrames / fps),
    preCleanupPath: preCleanupPresent ? path.relative(jobRoot, preCleanupPath).split(path.sep).join("/") : null,
    preCleanupSha256: preCleanupPresent ? sha256File(preCleanupPath) : null,
    preCleanupItemCount: preCleanupPresent ? (preCleanupWindows.clips ?? []).length : null
  },
  scan: {
    asrNoWordSeconds: GAP_CANDIDATE_MINIMUM_SECONDS,
    emphasisSeconds: GAP_REVIEW_EMPHASIS_SECONDS,
    decibelSweep: {
      thresholdsDb: DEFAULT_SCAN_THRESHOLDS_DB,
      minimumDetectedSeconds: 0.45,
      source: "state/source-silence-db-scan.txt",
      applied: sweepApplied
    }
  },
  candidates: candidates.map(({ requiresIndividualReason, ...entry }) => entry),
  removedCandidates,
  coverage: {
    itemsExamined,
    candidateCount: candidates.length,
    classifiedCount: candidates.filter((candidate) => candidate.classification !== "unclassified").length,
    preservedCount: candidates.filter((candidate) => candidate.classification === "preserve").length,
    removedCount: removedCandidates.length,
    removedSeconds: roundTo(removedCandidates.reduce((total, entry) => total + entry.durationSeconds, 0)),
    unexplainedCount: candidates.filter((candidate) => candidate.classification === "unclassified").length
  }
};

const report = candidates.map((candidate) => {
  const bits = [
    candidate.id,
    candidate.boundary.padEnd(8),
    `t=${String(candidate.timelineStart).padStart(6)}s`,
    `dur=${candidate.durationSeconds.toFixed(3)}`,
    `db=[${candidate.decibelHits.join(",")}]`,
    candidate.classification.padEnd(13),
    `${candidate.precedingWord?.text ?? "-"} <<>> ${candidate.followingWord?.text ?? "-"}`
  ];
  return bits.join("  ");
});

console.log(`Job: ${path.relative(process.cwd(), jobRoot) || "."}`);
console.log(`Timeline: ${artifact.timeline.itemCount} items, ${artifact.timeline.durationSeconds}s @ ${artifact.timeline.fps}fps`);
console.log(`dB sweep ${sweepApplied ? "applied" : "NOT APPLIED"} (${silenceScanPath.replace(`${jobRoot}/`, "")})`);
console.log(`Pre-cleanup snapshot: ${preCleanupPresent ? `${artifact.timeline.preCleanupPath} (${artifact.timeline.preCleanupItemCount} items)` : "ABSENT — removed-pause coverage cannot be derived"}`);
if (baselineKind === "current-timeline") console.log("Baseline starts at the captured current timeline; removals before that capture cannot be verified.");
const longestRetained = Math.max(0, ...candidates.map((entry) => entry.durationSeconds));
console.log(`Cleanup summary: ${removedCandidates.length} removed, ${artifact.coverage.preservedCount} preserved, ${artifact.coverage.unexplainedCount} unclassified; longest retained candidate ${longestRetained.toFixed(3)}s.`);
console.log(`Candidates on the locked timeline (${candidates.length}):`);
for (const line of report) console.log(`  ${line}`);
if (removedCandidates.length) {
  console.log(`Pauses cleanup excised (${removedCandidates.length}, ${artifact.coverage.removedSeconds}s total):`);
  for (const entry of removedCandidates) {
    console.log(`  ${entry.id}  src ${entry.sourceStart}-${entry.sourceEnd}s  cut ${entry.durationSeconds}s of a ${entry.originalPauseSeconds}s pause, retained ${entry.retainedSeconds}s${entry.reason ? "" : "  [reason required]"}`);
  }
}
if (orphanedRemoved.length) {
  console.log(`Stale removal records dropped (${orphanedRemoved.length}): ${orphanedRemoved.map((entry) => entry.id).join(", ")}`);
}
if (skippedItems.length) {
  console.log(`Skipped items (${skippedItems.length}): ${skippedItems.map((entry) => `${entry.itemId.slice(0, 8)} (${entry.reason})`).join(", ")}`);
}
const unexplained = candidates.filter((candidate) => candidate.classification === "unclassified");
if (unexplained.length) {
  console.log(`\n${unexplained.length} candidate(s) still need a disposition:`);
  for (const candidate of unexplained) {
    console.log(`  - ${candidate.id}: ${candidate.durationSeconds.toFixed(3)}s between "${candidate.precedingWord?.text ?? "-"}" and "${candidate.followingWord?.text ?? "-"}"${candidate.requiresIndividualReason ? " (>=0.8s, needs an individual reason)" : ""}`);
  }
}
if (!write) {
  console.log("\nDry run. Re-run with --write to emit state/gap-candidates.json.");
  process.exit(0);
}
writeJsonAtomic(artifactPath, artifact);
console.log(`\nWrote ${path.relative(process.cwd(), artifactPath)}`);
