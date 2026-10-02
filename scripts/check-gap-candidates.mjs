#!/usr/bin/env node
// Validate state/gap-candidates.json for the talking-head rough-cut standard.
//
// Usage:
//   node scripts/check-gap-candidates.mjs <gap-candidates.json>
//
// The validator re-runs ASR gap detection against state/timeline-source-windows.json
// and requires a recorded disposition for every candidate the locked timeline still
// contains, so the "find gap candidates / classify / check coverage" steps cannot be
// skipped silently. It also verifies that declared removals are genuinely absent,
// that the artifact is not stale for the timeline it describes, and that edge
// tightening was computed on the post-cleanup item set.

import fs from "node:fs";
import path from "node:path";
import { readJson, sha256File } from "./workflow-utils.mjs";
import {
  DEFAULT_SCAN_THRESHOLDS_DB,
  GAP_CANDIDATE_MINIMUM_SECONDS,
  GAP_REVIEW_EMPHASIS_SECONDS,
  deriveRemovedCandidates,
  detectGapCandidates,
  parseSilenceScan
} from "./gap-detection.mjs";

const SPAN_TOLERANCE_SECONDS = 0.02;
const MINIMUM_PRESERVED_REASON_LENGTH = 12;

const argumentsList = process.argv.slice(2);
const artifactArgument = argumentsList.find((argument) => !argument.startsWith("--"));
if (!artifactArgument) {
  console.error("Usage: node check-gap-candidates.mjs <gap-candidates.json>");
  process.exit(64);
}

const artifactPath = path.resolve(artifactArgument);
const jobRoot = path.dirname(path.dirname(artifactPath));
const artifact = readJson(artifactPath);
const sourceTranscriptPath = path.join(jobRoot, "state", "source-transcript.json");
const timelineWindowsPath = path.join(jobRoot, "state", "timeline-source-windows.json");
const silenceScanPath = path.join(jobRoot, "state", "source-silence-db-scan.txt");
const errors = [];

for (const required of [sourceTranscriptPath, timelineWindowsPath]) {
  if (!fs.existsSync(required)) errors.push(`missing ${path.relative(jobRoot, required)}`);
}
if (errors.length) {
  for (const error of errors) console.error(`Error: ${error}`);
  process.exit(1);
}

const sourceTranscript = readJson(sourceTranscriptPath);
const timelineWindows = readJson(timelineWindowsPath);
const fps = Number(timelineWindows.timelineFps?.numerator ?? 30) / Number(timelineWindows.timelineFps?.denominator ?? 1);

if (artifact.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");

// --- artifact is bound to the timeline it describes -------------------------
const liveTimelineSha = sha256File(timelineWindowsPath);
if (artifact.timeline?.path !== "state/timeline-source-windows.json") errors.push("timeline.path must be state/timeline-source-windows.json");
if (artifact.timeline?.sha256 !== liveTimelineSha) {
  errors.push("gap candidates are stale: state/timeline-source-windows.json changed after the gap review was recorded");
}
if (artifact.mediaFingerprint !== timelineWindows.sourceSha256) errors.push("mediaFingerprint must match the timeline source hash");
if (artifact.timeline?.itemCount !== (timelineWindows.clips ?? []).length) errors.push("timeline.itemCount is stale");
if (artifact.scan?.asrNoWordSeconds !== GAP_CANDIDATE_MINIMUM_SECONDS) {
  errors.push(`scan.asrNoWordSeconds must be ${GAP_CANDIDATE_MINIMUM_SECONDS}`);
}
if (artifact.scan?.emphasisSeconds !== GAP_REVIEW_EMPHASIS_SECONDS) {
  errors.push(`scan.emphasisSeconds must be ${GAP_REVIEW_EMPHASIS_SECONDS}`);
}

// --- the dB sweep required by step 3 must actually have been run ------------
const sweep = artifact.scan?.decibelSweep;
if (sweep?.source !== "state/source-silence-db-scan.txt") errors.push("scan.decibelSweep.source must be state/source-silence-db-scan.txt");
if (JSON.stringify(sweep?.thresholdsDb) !== JSON.stringify(DEFAULT_SCAN_THRESHOLDS_DB)) {
  errors.push(`scan.decibelSweep.thresholdsDb must be [${DEFAULT_SCAN_THRESHOLDS_DB.join(", ")}]`);
}
if (sweep?.minimumDetectedSeconds !== 0.45) errors.push("scan.decibelSweep.minimumDetectedSeconds must be 0.45");
const scanPresent = fs.existsSync(silenceScanPath);
const scanIntervals = scanPresent ? parseSilenceScan(fs.readFileSync(silenceScanPath, "utf8")) : [];
const sweepObserved = scanPresent && DEFAULT_SCAN_THRESHOLDS_DB.every(
  (threshold) => scanIntervals.some((interval) => interval.thresholdDb === threshold)
);
if (sweep?.applied !== true) errors.push("scan.decibelSweep.applied must be true: run scripts/detect-silence.sh on the original source and keep state/source-silence-db-scan.txt");
if (!sweepObserved) errors.push("the recorded dB sweep output is missing or does not cover the -30/-35/-40 dB thresholds");

// --- re-detect and require a disposition for every live candidate -----------
const { candidates: live } = detectGapCandidates({
  sourceTranscript,
  timelineWindows,
  fps,
  minimumSeconds: GAP_CANDIDATE_MINIMUM_SECONDS
});
const recorded = Array.isArray(artifact.candidates) ? artifact.candidates : [];
const recordedById = new Map(recorded.map((entry) => [entry.id, entry]));
const matchesLive = (entry) => live.some((candidate) => candidate.itemId === entry.itemId
  && Math.abs(candidate.sourceStart - entry.sourceStart) <= SPAN_TOLERANCE_SECONDS
  && Math.abs(candidate.sourceEnd - entry.sourceEnd) <= SPAN_TOLERANCE_SECONDS);

let unexplained = 0;
let preservedCount = 0;
for (const candidate of live) {
  const entry = recordedById.get(candidate.id);
  if (!entry) {
    // A candidate identity is item-scoped, so a renamed-but-identical span still
    // counts as covered when its coordinates match.
    const coordinateMatch = recorded.find((record) => record.itemId === candidate.itemId
      && Math.abs(record.sourceStart - candidate.sourceStart) <= SPAN_TOLERANCE_SECONDS
      && Math.abs(record.sourceEnd - candidate.sourceEnd) <= SPAN_TOLERANCE_SECONDS);
    if (!coordinateMatch) {
      errors.push(`${candidate.id}: retained ${candidate.durationSeconds.toFixed(3)}s candidate at ${candidate.timelineStart.toFixed(2)}s on the timeline has no recorded disposition`);
      continue;
    }
    continue;
  }
  if (entry.classification === "unclassified") {
    errors.push(`${entry.id}: still unclassified (${candidate.durationSeconds.toFixed(3)}s at ${candidate.timelineStart.toFixed(2)}s)`);
    unexplained += 1;
    continue;
  }
  if (entry.classification === "remove") {
    errors.push(`${entry.id}: recorded as removed but the span is still present on the locked timeline; re-run cleanup or reclassify it`);
    continue;
  }
  preservedCount += 1;
  if (entry.evidence?.audioChecked !== true) errors.push(`${entry.id}: preserved candidates require audioChecked evidence`);
  if (typeof entry.evidence?.note !== "string" || !entry.evidence.note.trim()) {
    errors.push(`${entry.id}: preserved candidates require an evidence note`);
  }
  const needsReason = entry.durationSeconds >= GAP_REVIEW_EMPHASIS_SECONDS;
  if (needsReason && (typeof entry.reason !== "string" || entry.reason.trim().length < MINIMUM_PRESERVED_REASON_LENGTH)) {
    errors.push(`${entry.id}: a ${entry.durationSeconds.toFixed(3)}s preserved pause needs its own reason of at least ${MINIMUM_PRESERVED_REASON_LENGTH} characters`);
  }
  if (!needsReason && typeof entry.reasonCode !== "string" && (typeof entry.reason !== "string" || !entry.reason.trim())) {
    errors.push(`${entry.id}: preserved candidates require a reasonCode or reason`);
  }
}

// --- stale entries that no longer describe the timeline ---------------------
for (const entry of recorded) {
  if (!matchesLive(entry)) {
    errors.push(`${entry.id}: recorded candidate is not present on the locked timeline; refresh it with scripts/classify-gaps.mjs`);
  }
}

// --- declared removals must be gone, and the cleanup must be evidenced -------
const removed = Array.isArray(artifact.removedCandidates) ? artifact.removedCandidates : [];
const spans = (timelineWindows.clips ?? []).map((item) => ({ start: item.srcStartUs / 1e6, end: item.srcEndUs / 1e6 }));
for (const entry of removed) {
  if (!(Number.isFinite(entry.sourceStart) && Number.isFinite(entry.sourceEnd) && entry.sourceEnd > entry.sourceStart)) {
    errors.push(`${entry.id}: removed candidate requires a positive source span`);
    continue;
  }
  if (entry.classification !== "remove") errors.push(`${entry.id}: removedCandidates entries must use classification "remove"`);
  if (typeof entry.reason !== "string" || !entry.reason.trim()) errors.push(`${entry.id}: removed candidates require a reason`);
  if (entry.evidence?.audioChecked !== true) errors.push(`${entry.id}: removed candidates require audioChecked evidence`);
  const stillPresent = spans.find((span) => span.start < entry.sourceEnd - SPAN_TOLERANCE_SECONDS && span.end > entry.sourceStart + SPAN_TOLERANCE_SECONDS);
  if (stillPresent) {
    errors.push(`${entry.id}: recorded as removed but the locked timeline still contains source time inside ${entry.sourceStart}-${entry.sourceEnd}s`);
  }
}

// --- every pause cleanup excised must be recorded ---------------------------
// The pre-cleanup snapshot is the only record of what the retained structure
// looked like before steps 3-5 ran. Re-deriving its word-free internal spans and
// requiring each excision to be listed is what makes a skipped cleanup fail.
const preCleanupPath = artifact.timeline?.preCleanupPath
  ? path.resolve(jobRoot, artifact.timeline.preCleanupPath)
  : path.join(jobRoot, "state", "timeline-source-windows.pre-cleanup.json");
let derivedRemoved = null;
if (!artifact.timeline?.preCleanupPath && fs.existsSync(preCleanupPath)) {
  errors.push("a pre-cleanup snapshot exists but timeline.preCleanupPath is not recorded; re-run scripts/classify-gaps.mjs --write");
}
if (artifact.timeline?.preCleanupPath) {
  if (!fs.existsSync(preCleanupPath)) {
    errors.push(`timeline.preCleanupPath ${artifact.timeline.preCleanupPath} does not exist`);
  } else if (artifact.timeline.preCleanupSha256 !== sha256File(preCleanupPath)) {
    errors.push("the pre-cleanup snapshot changed after the gap review was recorded");
  }
}
if (fs.existsSync(preCleanupPath)) {
  const preCleanupWindows = readJson(preCleanupPath);
  if (artifact.timeline?.preCleanupItemCount !== (preCleanupWindows.clips ?? []).length) {
    errors.push("timeline.preCleanupItemCount is stale");
  }
  derivedRemoved = deriveRemovedCandidates({
    sourceTranscript,
    preCleanupWindows,
    finalWindows: timelineWindows,
    minimumSeconds: GAP_CANDIDATE_MINIMUM_SECONDS
  });
  for (const expected of derivedRemoved) {
    const recordedEntry = removed.find((entry) => Math.abs(entry.sourceStart - expected.sourceStart) <= SPAN_TOLERANCE_SECONDS
      && Math.abs(entry.sourceEnd - expected.sourceEnd) <= SPAN_TOLERANCE_SECONDS);
    if (!recordedEntry) {
      errors.push(`${expected.id}: the ${expected.originalPauseSeconds}s pause at ${expected.sourceStart}-${expected.sourceEnd}s was excised but is not recorded under removedCandidates`);
    }
  }
  for (const entry of removed) {
    if (!derivedRemoved.some((expected) => Math.abs(entry.sourceStart - expected.sourceStart) <= SPAN_TOLERANCE_SECONDS
      && Math.abs(entry.sourceEnd - expected.sourceEnd) <= SPAN_TOLERANCE_SECONDS)) {
      errors.push(`${entry.id}: recorded removal does not correspond to an internal word-free span excised from the pre-cleanup structure`);
    }
  }
}

// --- edge tightening must have run on the post-cleanup item set -------------
const tighteningPlanPath = path.join(jobRoot, "state", "seam-tightening-plan.json");
if (fs.existsSync(tighteningPlanPath)) {
  const plan = readJson(tighteningPlanPath);
  const timelineItems = (timelineWindows.clips ?? []).length;
  if (Number.isInteger(plan.clipCount) && plan.clipCount !== timelineItems) {
    errors.push(`edge tightening ran on ${plan.clipCount} items but the locked timeline has ${timelineItems}; gap cleanup must be applied before the edge calculator`);
  }
}

// --- coverage block must agree with the recorded content --------------------
const coverage = artifact.coverage ?? {};
if (coverage.itemsExamined !== (timelineWindows.clips ?? []).length) errors.push("coverage.itemsExamined is stale");
if (coverage.candidateCount !== recorded.length) errors.push("coverage.candidateCount does not match the recorded candidates");
if (coverage.classifiedCount !== recorded.filter((entry) => entry.classification !== "unclassified").length) {
  errors.push("coverage.classifiedCount does not match the recorded candidates");
}
if (coverage.preservedCount !== recorded.filter((entry) => entry.classification === "preserve").length) {
  errors.push("coverage.preservedCount does not match the recorded candidates");
}
if (coverage.removedCount !== removed.length) errors.push("coverage.removedCount does not match removedCandidates");
const removedSeconds = Math.round(removed.reduce((total, entry) => total + (Number(entry.durationSeconds) || 0), 0) * 1000) / 1000;
if (Math.abs((Number(coverage.removedSeconds) || 0) - removedSeconds) > 0.002) {
  errors.push("coverage.removedSeconds does not match removedCandidates");
}
if (coverage.unexplainedCount !== recorded.filter((entry) => entry.classification === "unclassified").length) {
  errors.push("coverage.unexplainedCount does not match the recorded candidates");
}
if (unexplained !== 0 && coverage.unexplainedCount === 0) errors.push("coverage reports no unexplained candidates but live candidates are unclassified");

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length) process.exit(1);
console.log(`Gap candidates passed: ${recorded.length} retained candidate(s) classified (${preservedCount} preserved), ${removed.length} removal(s) verified against the locked timeline.`);
