import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectGapCandidates, silenceSweepCompleted } from "../scripts/gap-detection.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-gaps-"));
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${name} unexpectedly passed:\n${output}`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`${name} failed for the wrong reason:\n${output}`);
  return output;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const MICROSECONDS = 1_000_000;
const clip = (itemId, srcStart, srcEnd, timelineStartFrame) => ({
  itemId,
  assetId: "asset-1",
  timelineStartFrame,
  durationFrames: Math.round((srcEnd - srcStart) * 30),
  srcStartUs: Math.round(srcStart * MICROSECONDS),
  srcEndUs: Math.round(srcEnd * MICROSECONDS),
  playbackRateNumerator: 1,
  playbackRateDenominator: 1
});

try {
  // Fixture: three words at 1.0-2.0, 5.0-5.4, 7.0-7.4. The pre-cleanup structure
  // holds one item whose internal pauses are 3.0s and 1.6s. Cleanup shortened the
  // first to a 0.4s floor and kept the second, splitting the item in two.
  const job = path.join(temporaryRoot, "job");
  fs.mkdirSync(path.join(job, "state"), { recursive: true });
  writeJson(path.join(job, "state", "source-transcript.json"), {
    revision: 1,
    language: "zh-CN",
    duration: 8,
    source: "chatcut",
    segments: [
      {
        id: "s1",
        text: "甲乙丙。",
        start: 1,
        end: 7.4,
        confidence: null,
        words: [
          { id: "s1.w0", text: "甲。", start: 1, end: 2, confidence: null },
          { id: "s1.w1", text: "乙，", start: 5, end: 5.4, confidence: null },
          { id: "s1.w2", text: "丙。", start: 7, end: 7.4, confidence: null }
        ]
      }
    ]
  });
  const timelineWindows = {
    schemaVersion: 1,
    sourceSha256: "a".repeat(64),
    sourceDurationUs: 8 * MICROSECONDS,
    sourceAssetId: "asset-1",
    timelineFps: { numerator: 30, denominator: 1 },
    clips: [clip("item-1", 0.9, 2.4, 0), clip("item-2", 5.0, 7.4, 45)]
  };
  writeJson(path.join(job, "state", "timeline-source-windows.json"), timelineWindows);
  writeJson(path.join(job, "state", "timeline-source-windows.pre-cleanup.json"), {
    schemaVersion: 1,
    sourceSha256: "a".repeat(64),
    sourceDurationUs: 8 * MICROSECONDS,
    sourceAssetId: "asset-1",
    timelineFps: { numerator: 30, denominator: 1 },
    clips: [clip("item-1", 1.0, 7.4, 0)]
  });
  fs.writeFileSync(path.join(job, "state", "source-silence-db-scan.txt"), [
    "[silencedetect@db30 @ 0x0] silence_start: 2.05",
    "[silencedetect@db30 @ 0x0] silence_end: 5.02 | silence_duration: 2.97",
    "[silencedetect@db35 @ 0x0] silence_start: 2.05",
    "[silencedetect@db35 @ 0x0] silence_end: 5.02 | silence_duration: 2.97",
    "[silencedetect@db40 @ 0x0] silence_start: 2.05",
    "[silencedetect@db40 @ 0x0] silence_end: 5.02 | silence_duration: 2.97"
  ].join("\n"));

  const artifactPath = path.join(job, "state", "gap-candidates.json");

  // A dry run reports the candidates and writes nothing.
  const dryRun = script("classify-gaps.mjs", [job]);
  assert.match(dryRun, /Candidates on the locked timeline \(2\)/);
  assert.match(dryRun, /Pauses cleanup excised \(1, 2\.6s total\)/);
  assert.match(dryRun, /unclassified/);
  assert.match(dryRun, /1 removed, 0 preserved, 2 unclassified; longest retained candidate 1\.600s/);
  assert.equal(fs.existsSync(artifactPath), false, "a dry run must not write the artifact");

  // --write emits every detected candidate plus the derived excision.
  script("classify-gaps.mjs", [job, "--write"]);
  const skeleton = readJson(artifactPath);
  assert.equal(skeleton.schemaVersion, "1.0.0");
  assert.equal(skeleton.timeline.preCleanupItemCount, 1);
  assert.equal(skeleton.coverage.candidateCount, 2);
  assert.equal(skeleton.coverage.unexplainedCount, 2);
  assert.equal(skeleton.removedCandidates.length, 1);
  assert.equal(skeleton.removedCandidates[0].originalPauseSeconds, 3.02);
  assert.equal(skeleton.removedCandidates[0].retainedSeconds, 0.42);
  assert.equal(skeleton.removedCandidates[0].reason, "");
  const tailCandidate = skeleton.candidates.find((entry) => entry.boundary === "tail");
  const internalCandidate = skeleton.candidates.find((entry) => entry.boundary === "internal");
  assert.equal(tailCandidate.durationSeconds, 0.4);
  assert.equal(internalCandidate.durationSeconds, 1.6);

  // Unclassified candidates and unexplained removals must block the gate.
  script("check-gap-candidates.mjs", [artifactPath], false, /still unclassified/);
  script("check-gap-candidates.mjs", [artifactPath], false, /removed candidates require a reason/);

  // Fill in the editorial decisions the standard requires.
  const filled = readJson(artifactPath);
  for (const entry of filled.candidates) {
    entry.classification = "preserve";
    entry.reasonCode = entry.boundary === "tail" ? "cleanup-floor-breath" : "natural-sentence-beat";
    entry.reason = entry.boundary === "tail"
      ? "Retained floor of the shortened 3.0s pause so the closing line does not run into the next one."
      : "Held beat that carries the turn in the sentence; removing it would clip continuous delivery.";
    entry.evidence = { audioChecked: false, note: "ASR and dB sweep only." };
  }
  filled.removedCandidates[0].reasonCode = "dead-air-internal-pause";
  filled.removedCandidates[0].reason = "Internal dead air confirmed by the dB sweep and by the absence of any ASR word.";
  filled.removedCandidates[0].evidence = { audioChecked: false, note: "Continuous silence 2.05-5.02s at -30/-35/-40 dB." };
  filled.coverage.classifiedCount = 2;
  filled.coverage.preservedCount = 2;
  filled.coverage.unexplainedCount = 0;
  writeJson(artifactPath, filled);
  assert.match(script("check-gap-candidates.mjs", [artifactPath]), /Longest retained candidate: 1\.600s/);

  // A concise reason code is enough; no listening report or minimum prose size.
  const shortReason = readJson(artifactPath);
  shortReason.candidates.find((entry) => entry.boundary === "internal").reason = "beat";
  writeJson(artifactPath, shortReason);
  script("check-gap-candidates.mjs", [artifactPath]);
  const renamed = structuredClone(filled);
  renamed.candidates[0].id = "old-style-id";
  renamed.candidates[0].classification = "unclassified";
  writeJson(artifactPath, renamed);
  script("check-gap-candidates.mjs", [artifactPath], false, /still unclassified/);

  // A candidate cannot be declared removed while it is still on the timeline.
  const contradictory = readJson(artifactPath);
  const internalEntry = contradictory.candidates.find((entry) => entry.boundary === "internal");
  internalEntry.classification = "remove";
  Object.assign(internalEntry, {
    reason: "Internal dead air confirmed by the dB sweep and by the absence of any ASR word."
  });
  contradictory.removedCandidates.push({
    id: "item-2-r2",
    itemId: "item-2",
    sourceStart: internalEntry.sourceStart,
    sourceEnd: internalEntry.sourceEnd,
    durationSeconds: internalEntry.durationSeconds,
    originalPauseSeconds: internalEntry.durationSeconds,
    retainedSeconds: 0,
    classification: "remove",
    reasonCode: "dead-air-internal-pause",
    reason: "Claimed removal that was never applied.",
    evidence: { audioChecked: true, note: "Claimed." }
  });
  writeJson(artifactPath, contradictory);
  script("check-gap-candidates.mjs", [artifactPath], false, /still present on the locked timeline/);

  // Skipping cleanup leaves the pre-cleanup structure in place, so the large
  // internal pauses become live candidates with no disposition.
  const skipped = structuredClone(timelineWindows);
  skipped.clips = [clip("item-1", 1.0, 7.4, 0)];
  writeJson(path.join(job, "state", "timeline-source-windows.json"), skipped);
  const skippedArtifact = readJson(artifactPath);
  skippedArtifact.timeline.sha256 = "b".repeat(64);
  skippedArtifact.timeline.itemCount = 1;
  skippedArtifact.removedCandidates = [];
  skippedArtifact.coverage.removedCount = 0;
  skippedArtifact.coverage.removedSeconds = 0;
  writeJson(artifactPath, skippedArtifact);
  script("check-gap-candidates.mjs", [artifactPath], false, /gap candidates are stale|no recorded disposition|not recorded under removedCandidates/);

  // Restore the cleaned timeline and confirm the filled artifact passes again.
  writeJson(path.join(job, "state", "timeline-source-windows.json"), timelineWindows);
  writeJson(artifactPath, filled);
  script("check-gap-candidates.mjs", [artifactPath]);

  // Edge tightening computed before cleanup is visible as an item-count mismatch.
  const tighteningPlanPath = path.join(job, "state", "seam-tightening-plan.json");
  writeJson(tighteningPlanPath, { clipCount: 1, editsApplied: true });
  assert.match(script("check-gap-candidates.mjs", [artifactPath]), /Warning: seam plan/);
  writeJson(tighteningPlanPath, { clipCount: 2, editsApplied: true });
  script("check-gap-candidates.mjs", [artifactPath]);

  // Re-running the classifier preserves decisions for candidates that are unchanged.
  script("classify-gaps.mjs", [job, "--write"]);
  const afterRerun = readJson(artifactPath);
  assert.equal(afterRerun.coverage.classifiedCount, 2);
  assert.equal(afterRerun.coverage.unexplainedCount, 0);
  assert.equal(afterRerun.candidates[0].evidence.audioChecked, false);
  assert.equal(afterRerun.removedCandidates[0].evidence.audioChecked, false);
  assert.ok(afterRerun.removedCandidates[0].reason.length > 0, "an authored removal reason must survive a re-run");

  // Zero detections are valid; a failed/incomplete scan is not.
  const success = "scan_thresholds_db=-30,-35,-40\nscan_completed=true\n";
  assert.equal(silenceSweepCompleted(success), true);
  assert.equal(silenceSweepCompleted("scan_thresholds_db=-30,-35,-40\n"), false);
  fs.writeFileSync(path.join(job, "state", "source-silence-db-scan.txt"), success);
  script("classify-gaps.mjs", [job, "--write"]);
  script("check-gap-candidates.mjs", [artifactPath]);
  const dbOnly = detectGapCandidates({ sourceTranscript: { segments: [{ words: [{ start: 0, end: 10, text: "broad ASR" }] }] },
    timelineWindows: { clips: [clip("shared-prefix-one", 0, 10, 0), clip("shared-prefix-two", 0, 10, 300)] }, fps: 30,
    silenceIntervals: [{ start: 3, end: 6, thresholdDb: -30 }, { start: 3.1, end: 5.9, thresholdDb: -35 }] }).candidates;
  assert.equal(dbOnly.length, 2);
  assert.equal(dbOnly[0].asrGap, false);
  assert.notEqual(dbOnly[0].id, dbOnly[1].id);

  // A legacy cut is baselined as it exists; no undo/re-edit is required.
  fs.rmSync(path.join(job, "state", "timeline-source-windows.pre-cleanup.json"));
  fs.rmSync(artifactPath);
  assert.match(script("classify-gaps.mjs", [job, "--write"]), /removals before that capture cannot be verified/);
  const migrated = readJson(artifactPath);
  assert.equal(migrated.timeline.baselineKind, "current-timeline");
  assert.equal(migrated.removedCandidates.length, 0);

  // A missing dB sweep is a hard failure: the standard requires the sweep.
  fs.rmSync(path.join(job, "state", "source-silence-db-scan.txt"));
  script("classify-gaps.mjs", [job, "--write"]);
  script("check-gap-candidates.mjs", [artifactPath], false, /decibelSweep\.applied must be true/);

  console.log("Gap candidate contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
