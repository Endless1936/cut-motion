#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexScript = path.join(repositoryRoot, "scripts", "index-source-silence.mjs");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-source-index-"));

const run = (argumentsList) => {
  const result = spawnSync(process.execPath, [indexScript, ...argumentsList], { encoding: "utf8" });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const writeMonoWav = (filePath, amplitude = 0.25) => {
  const sampleRate = 48_000;
  const durationSeconds = 0.3;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const inQuietRun = index >= sampleRate * 0.1 && index < sampleRate * 0.2;
    const sample = inQuietRun ? 0 : Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 440) * amplitude * 32767);
    pcm.writeInt16LE(sample, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
};

try {
  const sourcePath = path.join(temporaryRoot, "source.wav");
  const indexPath = path.join(temporaryRoot, "index.json");
  const summaryPath = path.join(temporaryRoot, "summary.json");
  const seamsPath = path.join(temporaryRoot, "seams.json");
  const lookupPath = path.join(temporaryRoot, "lookup.json");
  writeMonoWav(sourcePath);

  let result = run([sourcePath, "--output", indexPath]);
  assert.equal(result.status, 0, result.output);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  assert.equal(index.schemaVersion, 4);
  assert.equal(index.detector.dbThresholdsUsed, false);
  assert.equal("quietRunsByThresholdDb" in index.waveform, false);
  assert.ok(index.waveform.digitalSilenceRuns.some((run) => run.startTimeUs <= 100_000 && run.endTimeUs >= 200_000));

  const makeSeamMap = (sourceIndex, {
    assetDurationUs = sourceIndex.source.durationUs,
    offsetUs = 0,
    scaleNumerator = 1,
    scaleDenominator = 1,
    seams,
    lookupPaddingMs,
  }) => {
    const sourceMap = {
      chatcutAssetId: "asset-test",
      originalSourceSha256: sourceIndex.source.sha256,
      originalSourceDurationUs: sourceIndex.source.durationUs,
      offsetUs,
      scaleNumerator,
      scaleDenominator,
      assetDurationUs,
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
      evidence: "Test fixture records the inspected source/asset duration and explicit time map.",
    };
    return {
      schemaVersion: 2,
      sourceSha256: sourceIndex.source.sha256,
      timelineFps: { numerator: 30, denominator: 1 },
      sourceMap,
      ...(lookupPaddingMs === undefined ? {} : { lookupPaddingMs }),
      timelineSeams: seams,
    };
  };

  fs.writeFileSync(seamsPath, JSON.stringify({
    schemaVersion: 1,
    sourceSha256: index.source.sha256,
    timelineFps: { numerator: 30, denominator: 1 },
    seams: [
      {
        timelineFrame: 5,
        leftItemId: "left",
        rightItemId: "right",
        leftSourceEndUs: 150_000,
        rightSourceStartUs: 150_000,
      },
      {
        timelineFrame: 8,
        leftItemId: "left-after",
        rightItemId: "right-after",
        leftSourceEndUs: 250_000,
        rightSourceStartUs: 250_000,
      },
      {
        timelineFrame: 2,
        leftItemId: "left-before",
        rightItemId: "right-before",
        leftSourceEndUs: 50_000,
        rightSourceStartUs: 50_000,
      },
    ],
  }));
  result = run(["--lookup", indexPath, seamsPath, "--output", lookupPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /schema-v2 asset-clock seam maps only/);

  const mappedSeamsPath = path.join(temporaryRoot, "mapped-seams.json");
  const mappedLookupPath = path.join(temporaryRoot, "mapped-lookup.json");
  fs.writeFileSync(mappedSeamsPath, JSON.stringify(makeSeamMap(index, {
    seams: [{
      timelineFrame: 5,
      leftItemId: "mapped-left",
      rightItemId: "mapped-right",
      leftAssetEndUs: 150_000,
      rightAssetStartUs: 150_000,
    }],
  })));
  result = run(["--lookup", indexPath, mappedSeamsPath, "--output", mappedLookupPath]);
  assert.equal(result.status, 0, result.output);
  const mappedLookup = JSON.parse(fs.readFileSync(mappedLookupPath, "utf8"));
  assert.equal(mappedLookup.seams[0].leftSourceEndUs, 150_000);
  assert.equal(mappedLookup.seams[0].rightSourceStartUs, 150_000);
  assert.ok(mappedLookup.seams[0].leftWaveform.length > 0);
  assert.equal("boundaryRecommendations" in mappedLookup.seams[0], false);
  assert.equal("nearbyQuietRuns" in mappedLookup.seams[0], false);
  assert.equal(mappedLookup.sourceMap.verificationStatus, "operator-attested; field consistency checked by this utility");
  assert.match(mappedLookup.boundaryPolicy, /no dB thresholds/);

  const internalSpanTooNarrowPath = path.join(temporaryRoot, "internal-span-too-narrow.json");
  const internalSpanMapPath = path.join(temporaryRoot, "internal-span-map.json");
  const internalSpanLookupPath = path.join(temporaryRoot, "internal-span-lookup.json");
  fs.writeFileSync(internalSpanMapPath, JSON.stringify(makeSeamMap(index, {
    lookupPaddingMs: 60,
    seams: [{
      timelineFrame: 8,
      leftItemId: "same-item",
      rightItemId: "same-item",
      leftAssetEndUs: 100_000,
      rightAssetStartUs: 250_000,
    }],
  })));
  result = run(["--lookup", indexPath, internalSpanMapPath, "--output", internalSpanTooNarrowPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /does not cover the full same-item candidate span/);
  fs.writeFileSync(internalSpanMapPath, JSON.stringify(makeSeamMap(index, {
    lookupPaddingMs: 80,
    seams: [{
      timelineFrame: 8,
      leftItemId: "same-item",
      rightItemId: "same-item",
      leftAssetEndUs: 100_000,
      rightAssetStartUs: 250_000,
    }],
  })));
  result = run(["--lookup", indexPath, internalSpanMapPath, "--output", internalSpanLookupPath]);
  assert.equal(result.status, 0, result.output);
  const internalSpanLookup = JSON.parse(fs.readFileSync(internalSpanLookupPath, "utf8"));
  const leftTimes = internalSpanLookup.seams[0].leftWaveform.map((sample) => sample.timeUs);
  const rightTimes = internalSpanLookup.seams[0].rightWaveform.map((sample) => sample.timeUs);
  assert.ok(Math.max(...leftTimes) >= Math.min(...rightTimes), "same-item traces must overlap and cover the candidate span");

  const legacyV3IndexPath = path.join(temporaryRoot, "legacy-v3-index.json");
  const legacyV3LookupPath = path.join(temporaryRoot, "legacy-v3-lookup.json");
  const legacyV3Index = structuredClone(index);
  legacyV3Index.schemaVersion = 3;
  legacyV3Index.waveform.quietRunsByThresholdDb = {
    "-30": [{ startTimeUs: 100_000, endTimeUs: 200_000 }],
    "-35": [{ startTimeUs: 100_000, endTimeUs: 200_000 }],
    "-40": [{ startTimeUs: 100_000, endTimeUs: 200_000 }],
  };
  fs.writeFileSync(legacyV3IndexPath, JSON.stringify(legacyV3Index));
  result = run(["--lookup", legacyV3IndexPath, mappedSeamsPath, "--output", legacyV3LookupPath]);
  assert.equal(result.status, 0, result.output);
  const legacyV3Lookup = JSON.parse(fs.readFileSync(legacyV3LookupPath, "utf8"));
  assert.deepEqual(legacyV3Lookup.seams[0].leftWaveform, mappedLookup.seams[0].leftWaveform);
  assert.equal("boundaryRecommendations" in legacyV3Lookup.seams[0], false);
  assert.equal("nearbyQuietRuns" in legacyV3Lookup.seams[0], false);
  assert.match(legacyV3Lookup.boundaryPolicy, /no dB thresholds/);

  const lowLevelSourcePath = path.join(temporaryRoot, "low-level-source.wav");
  const lowLevelIndexPath = path.join(temporaryRoot, "low-level-index.json");
  const lowLevelSeamsPath = path.join(temporaryRoot, "low-level-seams.json");
  const lowLevelLookupPath = path.join(temporaryRoot, "low-level-lookup.json");
  writeMonoWav(lowLevelSourcePath, 0.005);
  result = run([lowLevelSourcePath, "--output", lowLevelIndexPath]);
  assert.equal(result.status, 0, result.output);
  const lowLevelIndex = JSON.parse(fs.readFileSync(lowLevelIndexPath, "utf8"));
  fs.writeFileSync(lowLevelSeamsPath, JSON.stringify(makeSeamMap(lowLevelIndex, {
    lookupPaddingMs: 40,
    seams: [{
      timelineFrame: 8,
      leftItemId: "low-level-left",
      rightItemId: "low-level-right",
      leftAssetEndUs: 250_000,
      rightAssetStartUs: 250_000,
    }],
  })));
  result = run(["--lookup", lowLevelIndexPath, lowLevelSeamsPath, "--output", lowLevelLookupPath]);
  assert.equal(result.status, 0, result.output);
  const lowLevelLookup = JSON.parse(fs.readFileSync(lowLevelLookupPath, "utf8"));
  assert.deepEqual(lowLevelLookup.seams[0].nearbyDigitalSilenceRuns.left, []);
  assert.ok(lowLevelLookup.seams[0].leftWaveform.some((window) => window.channels.some((channel) => channel.peakSample > 0)));

  const scaledSeamsPath = path.join(temporaryRoot, "scaled-seams.json");
  const scaledLookupPath = path.join(temporaryRoot, "scaled-lookup.json");
  fs.writeFileSync(scaledSeamsPath, JSON.stringify(makeSeamMap(index, {
    assetDurationUs: 145_000,
    offsetUs: 10_000,
    scaleNumerator: 2,
    scaleDenominator: 1,
    seams: [{
      timelineFrame: 5,
      leftItemId: "scaled-left",
      rightItemId: "scaled-right",
      leftAssetEndUs: 70_000,
      rightAssetStartUs: 70_000,
    }],
  })));
  result = run(["--lookup", indexPath, scaledSeamsPath, "--output", scaledLookupPath]);
  assert.equal(result.status, 0, result.output);
  const scaledLookup = JSON.parse(fs.readFileSync(scaledLookupPath, "utf8"));
  assert.equal(scaledLookup.seams[0].leftSourceEndUs, 150_000);

  const invalidMapPath = path.join(temporaryRoot, "invalid-map.json");
  const invalidMapLookupPath = path.join(temporaryRoot, "invalid-map-lookup.json");
  const invalidMap = makeSeamMap(index, { seams: [{
    timelineFrame: 5,
    leftItemId: "invalid-left",
    rightItemId: "invalid-right",
    leftAssetEndUs: 150_000,
    rightAssetStartUs: 150_000,
  }] });
  invalidMap.sourceMap.operatorVerification.scaleNumerator = 3;
  fs.writeFileSync(invalidMapPath, JSON.stringify(invalidMap));
  result = run(["--lookup", indexPath, invalidMapPath, "--output", invalidMapLookupPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /operator-attested ChatCut asset map/);

  result = run([sourcePath, "--summary", "--output", summaryPath]);
  assert.equal(result.status, 0, result.output);
  result = run(["--lookup", summaryPath, seamsPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /full index/);
  console.log("Source-audio index tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
