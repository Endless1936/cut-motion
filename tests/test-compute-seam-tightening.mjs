#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeSeamTighteningPlan } from "../scripts/compute-seam-tightening.mjs";

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/compute-seam-tightening.mjs");
const sourceSha256 = "ab".repeat(32);

function makeIndex({
  audioStartUs = 500_000,
  sourceStartUs = 0,
  sourceDurationUs = 3_000_000,
  sampleRate = 48_000,
  windowSamples = 480,
  audioDurationUs = 2_500_000,
  energyRanges = [[1_000_000, 1_200_000]],
  lowEnergyRanges = [],
  rmsRanges = [],
} = {}) {
  const decodedSampleCount = Math.round(audioDurationUs * sampleRate / 1_000_000);
  const windowCount = Math.ceil(decodedSampleCount / windowSamples);
  const windows = Array.from({ length: windowCount }, (_, i) => {
    const startUs = audioStartUs + Math.round(i * windowSamples * 1_000_000 / sampleRate);
    const endUs = audioStartUs + Math.round(Math.min((i + 1) * windowSamples, decodedSampleCount) * 1_000_000 / sampleRate);
    const active = energyRanges.some(([fromUs, toUs]) => startUs >= fromUs && endUs <= toUs);
    const lowActivity = lowEnergyRanges.some(([fromUs, toUs]) => startUs >= fromUs && endUs <= toUs);
    const explicitLevel = rmsRanges.find(([fromUs, toUs]) => startUs >= fromUs && endUs <= toUs)?.[2];
    const rms = explicitLevel ?? (active ? 600 : lowActivity ? 150 : 0);
    return [rms, rms, 4, rms > 0 ? 0 : windowSamples];
  });
  return {
    schemaVersion: 4,
    source: { path: "source.mov", sha256: sourceSha256, startTimeUs: sourceStartUs, durationUs: sourceDurationUs },
    audio: { startTimeUs: audioStartUs, durationUs: audioDurationUs, sampleRate, channels: 1 },
    waveform: {
      windowMs: 10,
      windowSamples,
      decodedSampleCount,
      featureOrderPerChannel: ["linearPeak16", "linearRms16", "zeroCrossings", "exactZeroSamples"],
      windows,
    },
  };
}

function makeManifest(index, {
  timelineFps = { numerator: 30, denominator: 1 },
  offsetUs = 500_000,
  scaleNumerator = 1,
  scaleDenominator = 1,
  assetDurationUs = 2_500_000,
  clips = null,
} = {}) {
  const sourceMap = {
    chatcutAssetId: "asset-test",
    originalSourceSha256: sourceSha256,
    originalSourceDurationUs: index.source.durationUs,
    assetDurationUs,
    offsetUs,
    scaleNumerator,
    scaleDenominator,
  };
  sourceMap.operatorVerification = {
    method: "manual-chatcut-asset-metadata-review",
    chatcutAssetId: sourceMap.chatcutAssetId,
    originalSourceSha256: sourceMap.originalSourceSha256,
    originalSourceDurationUs: sourceMap.originalSourceDurationUs,
    assetDurationUs: sourceMap.assetDurationUs,
    offsetUs: sourceMap.offsetUs,
    scaleNumerator: sourceMap.scaleNumerator,
    scaleDenominator: sourceMap.scaleDenominator,
    evidence: "Fixture records the inspected source and asset timing map.",
  };
  return {
    schemaVersion: 1,
    sourceSha256,
    sourceDurationUs: index.source.durationUs,
    sourceAssetId: sourceMap.chatcutAssetId,
    timelineFps,
    sourceMap,
    clips: (clips ?? [
      {
        itemId: "clip-a",
        assetId: "asset-test",
        timelineStartFrame: 0,
        durationFrames: 30,
        assetStartUs: 0,
        assetEndUs: 1_000_000,
        playbackRateNumerator: 1,
        playbackRateDenominator: 1,
        terminalWordStartSourceUs: 1_000_000,
        terminalWordEndSourceUs: 1_150_000,
      },
      {
        itemId: "clip-b",
        assetId: "asset-test",
        timelineStartFrame: 30,
        durationFrames: 30,
        assetStartUs: 1_000_000,
        assetEndUs: 2_000_000,
        playbackRateNumerator: 1,
        playbackRateDenominator: 1,
        terminalWordStartSourceUs: 2_300_000,
        terminalWordEndSourceUs: 2_450_000,
      },
    ]).map((clip) => ({
      itemId: clip.itemId,
      assetId: clip.assetId,
      timelineStartFrame: clip.timelineStartFrame,
      durationFrames: clip.durationFrames,
      srcStartUs: offsetUs + Math.round(clip.assetStartUs * scaleNumerator / scaleDenominator),
      srcEndUs: offsetUs + Math.round(clip.assetEndUs * scaleNumerator / scaleDenominator),
      playbackRateNumerator: clip.playbackRateNumerator,
      playbackRateDenominator: clip.playbackRateDenominator,
    })),
  };
}

const index = makeIndex({
  energyRanges: [
    [1_000_000, 1_200_000],
    [2_600_000, 2_900_000],
  ],
  lowEnergyRanges: [[1_200_000, 1_400_000]],
});
const manifest = makeManifest(index);
const plan = computeSeamTighteningPlan(index, manifest);
assert.equal(plan.waveformOriginUs, 500_000, "uses audio.startTimeUs, not source.startTimeUs or zero");
assert.equal(plan.clips[0].primaryActivityStartSourceUs, 1_000_000);
assert.equal(plan.clips[0].primaryActivityEndSourceUs, 1_200_000);
assert.equal(plan.clips[0].proposedHeadTrimFrames, 14);
assert.equal(plan.clips[0].lowLevelFallbackEndSourceUs, 1_400_000);
assert.equal(plan.clips[0].proposedTailTrimFrames, 2, "sustained lower-level activity backs off the tail boundary");
assert.equal(plan.clips[1].proposedHeadTrimFrames, 0, "activity outside a clip cannot create a head trim");
assert.equal(plan.clips[1].proposedTailTrimFrames, 0, "activity outside a clip cannot create a tail trim");
assert.equal(Object.hasOwn(plan.clips[1], "requiresHumanReview"), false);
assert.equal(Object.hasOwn(plan, "requiresHumanReview"), false);
assert.equal(plan.editsApplied, false);
assert.equal(plan.proposedHeadTrimFrames, 14);
assert.equal(plan.proposedTailTrimFrames, 2);
assert.equal(plan.proposedDurationFrames, 44);
assert.equal(plan.clips[0].timelineStartFrameAfterShift, 0,
  "trimming the first clip's head does not create a blank at the start of the sequence");
assert.equal(plan.clips[1].timelineStartFrameAfterShift, 14);

const partialIndex = makeIndex({ energyRanges: [[500_000, 540_000]] });
const partialManifest = makeManifest(partialIndex, {
  clips: [{
    itemId: "partial-edge",
    assetId: "asset-test",
    timelineStartFrame: 0,
    durationFrames: 1,
    assetStartUs: 5_000,
    assetEndUs: 38_333,
    playbackRateNumerator: 1,
    playbackRateDenominator: 1,
  }],
});
const partialPlan = computeSeamTighteningPlan(partialIndex, partialManifest);
assert.equal(partialPlan.clips[0].proposedHeadTrimFrames, 0);
assert.equal(partialPlan.clips[0].proposedTailTrimFrames, 0,
  "partial waveform bins crossing clip edges do not contribute energy");

const expectRejected = (candidateIndex, candidateManifest, message) => {
  assert.throws(() => computeSeamTighteningPlan(candidateIndex, candidateManifest), message);
};
const wrongHash = structuredClone(manifest);
wrongHash.sourceSha256 = "cd".repeat(32);
expectRejected(index, wrongHash, /sourceSha256/);
const wrongAsset = structuredClone(manifest);
wrongAsset.clips[0].assetId = "other-asset";
expectRejected(index, wrongAsset, /different source asset/);
const wrongDuration = structuredClone(manifest);
wrongDuration.sourceDurationUs += 1;
expectRejected(index, wrongDuration, /sourceDurationUs/);
const wrongRange = structuredClone(manifest);
wrongRange.clips[0].srcEndUs = 3_100_000;
expectRejected(index, wrongRange, /invalid original-source range|outside indexed audio/);
const scaledRange = makeManifest(index, {
  scaleNumerator: 2,
  clips: [{
    itemId: "scaled",
    assetId: "asset-test",
    timelineStartFrame: 0,
    durationFrames: 30,
    assetStartUs: 0,
    assetEndUs: 1_000_000,
    playbackRateNumerator: 1,
    playbackRateDenominator: 1,
  }],
});
expectRejected(index, scaledRange, /source duration disagrees/);
const wrongSpeed = structuredClone(manifest);
wrongSpeed.clips[0].playbackRateNumerator = 2;
expectRejected(index, wrongSpeed, /1x playback/);
const zeroFps = structuredClone(manifest);
zeroFps.timelineFps.numerator = 0;
expectRejected(index, zeroFps, /timelineFps.numerator/);
const nonContiguous = structuredClone(manifest);
nonContiguous.clips[1].timelineStartFrame = 31;
expectRejected(index, nonContiguous, /contiguous/);
const wrongDurationFrames = structuredClone(manifest);
wrongDurationFrames.clips[0].durationFrames = 20;
expectRejected(index, wrongDurationFrames, /source duration disagrees/);
const malformedRows = structuredClone(index);
malformedRows.waveform.windows[0][1] = Number.NaN;
expectRejected(malformedRows, manifest, /RMS value/);
const legacyIndex = structuredClone(index);
legacyIndex.schemaVersion = 3;
expectRejected(legacyIndex, manifest, /schema-v4/);

const reportedCleanIndex = makeIndex({
  audioStartUs: 0,
  audioDurationUs: 50_000_000,
  sourceDurationUs: 50_000_000,
  energyRanges: [],
  lowEnergyRanges: [],
  rmsRanges: [
    [20_980_000, 21_020_000, 378],
    [21_020_000, 21_030_000, 184],
    [21_030_000, 21_040_000, 126],
    [21_040_000, 21_050_000, 190],
  ],
});
const reportedCleanManifest = makeManifest(reportedCleanIndex, {
  offsetUs: 0,
  assetDurationUs: 50_000_000,
  clips: [{
    itemId: "reported-clean-seam",
    assetId: "asset-test",
    timelineStartFrame: 0,
    durationFrames: 17,
    assetStartUs: 20_900_000,
    assetEndUs: 21_467_000,
    playbackRateNumerator: 1,
    playbackRateDenominator: 1,
  }],
});
const reportedCleanPlan = computeSeamTighteningPlan(reportedCleanIndex, reportedCleanManifest);
assert.equal(reportedCleanPlan.clips[0].primaryActivityEndSourceUs, 21_020_000);
assert.equal(reportedCleanPlan.clips[0].lowLevelFallbackEndSourceUs, null);
assert.equal(reportedCleanPlan.clips[0].proposedTailTrimFrames, 12,
  "matches the supplied high-threshold-only 21.467s example");

const reportedFallbackIndex = makeIndex({
  audioStartUs: 0,
  audioDurationUs: 50_000_000,
  sourceDurationUs: 50_000_000,
  energyRanges: [],
  lowEnergyRanges: [],
  rmsRanges: [
    [38_300_000, 38_380_000, 220],
    [38_410_000, 38_420_000, 145],
    [38_420_000, 38_430_000, 113],
    [38_430_000, 38_440_000, 100],
  ],
});
const reportedFallbackManifest = makeManifest(reportedFallbackIndex, {
  offsetUs: 0,
  assetDurationUs: 50_000_000,
  clips: [{
    itemId: "reported-fallback-seam",
    assetId: "asset-test",
    timelineStartFrame: 0,
    durationFrames: 21,
    assetStartUs: 38_000_000,
    assetEndUs: 38_703_000,
    playbackRateNumerator: 1,
    playbackRateDenominator: 1,
  }],
});
const reportedFallbackPlan = computeSeamTighteningPlan(reportedFallbackIndex, reportedFallbackManifest);
assert.equal(reportedFallbackPlan.clips[0].primaryActivityEndSourceUs, 38_380_000);
assert.equal(reportedFallbackPlan.clips[0].lowLevelFallbackEndSourceUs, 38_440_000);
assert.equal(reportedFallbackPlan.clips[0].proposedTailTrimFrames, 6,
  "matches the supplied low-level-tail fallback example");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-seam-plan-"));
try {
  const indexPath = path.join(temporaryRoot, "index.json");
  const windowsPath = path.join(temporaryRoot, "windows.json");
  fs.writeFileSync(indexPath, JSON.stringify(index));
  fs.writeFileSync(windowsPath, JSON.stringify(manifest));
  const calculate = (windows) => spawnSync(process.execPath, [
    scriptPath, "--index", indexPath, "--windows", windows,
  ], { encoding: "utf8" });
  const standalone = calculate(windowsPath);
  assert.equal(standalone.status, 0);
  assert.equal(standalone.stderr, "", "standalone use has no workflow reminders");
  const overwriteInput = spawnSync(process.execPath, [
    scriptPath, "--index", indexPath, "--windows", windowsPath, "--out", indexPath,
  ], { encoding: "utf8" });
  assert.notEqual(overwriteInput.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(indexPath, "utf8")), index);

  const occupiedOutput = path.join(temporaryRoot, "existing-plan.json");
  fs.writeFileSync(occupiedOutput, "keep");
  const overwriteOutput = spawnSync(process.execPath, [
    scriptPath, "--index", indexPath, "--windows", windowsPath, "--out", occupiedOutput,
  ], { encoding: "utf8" });
  assert.notEqual(overwriteOutput.status, 0);
  assert.equal(fs.readFileSync(occupiedOutput, "utf8"), "keep");
  const force = (out) => spawnSync(process.execPath, [
    scriptPath, "--index", indexPath, "--windows", windowsPath, "--out", out, "--force",
  ], { encoding: "utf8" });
  assert.equal(force(occupiedOutput).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(occupiedOutput, "utf8")), JSON.parse(standalone.stdout));
  assert.notEqual(force(indexPath).status, 0);
  const alias = path.join(temporaryRoot, "index-alias.json");
  fs.symlinkSync(indexPath, alias);
  assert.notEqual(force(alias).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(indexPath, "utf8")), index);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("Seam tightening candidate-plan tests passed.\n");
