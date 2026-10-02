#!/usr/bin/env node
// Refine the in/out points of already-selected ChatCut clips from the original
// waveform. This calculator never decides which content to keep or edits a timeline.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIMARY_ACTIVITY_RMS16 = 200;
const LOW_LEVEL_GUARD_RMS16 = 100;
const RUN_WINDOWS = 3;
const LEAVE_FRAMES = 1;
const MICROSECONDS_PER_SECOND = 1_000_000n;

function fail(message) {
  throw new Error(message);
}

function safeInteger(value, label, { min = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    fail(label + " must be a safe integer >= " + min + ".");
  }
  return value;
}

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) fail("Internal divisor must be positive.");
  if (numerator >= 0n) return (numerator + denominator - 1n) / denominator;
  return numerator / denominator;
}

function roundDiv(numerator, denominator) {
  if (denominator <= 0n) fail("Internal divisor must be positive.");
  if (numerator >= 0n) return (numerator + denominator / 2n) / denominator;
  return -((-numerator + denominator / 2n) / denominator);
}

function toSafeNumber(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(label + " is outside the safe integer range.");
  return number;
}

function validateIndex(index) {
  if (index?.schemaVersion !== 4) fail("Only full schema-v4 waveform indexes are supported.");
  const source = index.source;
  const audio = index.audio;
  const waveform = index.waveform;
  if (!/^[a-f0-9]{64}$/i.test(source?.sha256 ?? "")) fail("Waveform index has no valid source SHA-256.");
  const sourceStartUs = safeInteger(source.startTimeUs, "index.source.startTimeUs");
  const sourceDurationUs = safeInteger(source.durationUs, "index.source.durationUs", { min: 1 });
  const sourceEndUs = safeInteger(sourceStartUs + sourceDurationUs, "index source end");
  safeInteger(audio?.startTimeUs, "index.audio.startTimeUs");
  safeInteger(audio?.sampleRate, "index.audio.sampleRate", { min: 1 });
  safeInteger(audio?.channels, "index.audio.channels", { min: 1 });
  safeInteger(waveform?.windowSamples, "index.waveform.windowSamples", { min: 1 });
  safeInteger(waveform?.decodedSampleCount, "index.waveform.decodedSampleCount", { min: 1 });
  if (!Array.isArray(waveform?.featureOrderPerChannel) || !Array.isArray(waveform?.windows)) {
    fail("Waveform index must contain featureOrderPerChannel and full waveform.windows.");
  }
  const featuresPerChannel = waveform.featureOrderPerChannel.length;
  if (featuresPerChannel < 1) fail("Waveform feature list is empty.");
  const rmsIndex = waveform.featureOrderPerChannel.indexOf("linearRms16");
  if (rmsIndex < 0) fail("Waveform index has no supported linear RMS feature.");
  const expectedWindows = Math.ceil(waveform.decodedSampleCount / waveform.windowSamples);
  if (waveform.windows.length !== expectedWindows) {
    fail("Waveform row count does not match decodedSampleCount/windowSamples.");
  }
  const expectedWidth = audio.channels * featuresPerChannel;
  for (let i = 0; i < waveform.windows.length; i += 1) {
    const row = waveform.windows[i];
    if (!Array.isArray(row) || row.length !== expectedWidth) {
      fail("Waveform row " + i + " has an unexpected feature count.");
    }
    for (let channel = 0; channel < audio.channels; channel += 1) {
      const rms = row[channel * featuresPerChannel + rmsIndex];
      if (!Number.isSafeInteger(rms) || rms < 0 || rms > 32767) {
        fail("Waveform RMS value at row " + i + ", channel " + channel + " is invalid.");
      }
    }
  }
  const audioEndUs = BigInt(audio.startTimeUs) + roundDiv(
    BigInt(waveform.decodedSampleCount) * MICROSECONDS_PER_SECOND,
    BigInt(audio.sampleRate),
  );
  return {
    sourceStartUs: BigInt(sourceStartUs),
    sourceEndUs: BigInt(sourceEndUs),
    audioStartUs: BigInt(audio.startTimeUs),
    audioEndUs,
    rmsIndex,
    featuresPerChannel,
    windowSamples: BigInt(waveform.windowSamples),
    sampleRate: BigInt(audio.sampleRate),
    decodedSamples: BigInt(waveform.decodedSampleCount),
    rows: waveform.windows,
    channels: audio.channels,
  };
}

function validateManifest(index, manifest) {
  if (manifest.schemaVersion !== 1) fail("Timeline windows must use schemaVersion 1.");
  if (manifest.sourceSha256 !== index.source.sha256) fail("Timeline windows sourceSha256 does not match the waveform index.");
  if (manifest.sourceDurationUs !== index.source.durationUs) fail("Timeline windows sourceDurationUs does not match the waveform index.");
  if (typeof manifest.sourceAssetId !== "string" || !manifest.sourceAssetId.trim()) {
    fail("Timeline windows must identify the single ChatCut source asset.");
  }
  const fps = manifest.timelineFps;
  const fpsNumerator = safeInteger(fps?.numerator, "timelineFps.numerator", { min: 1 });
  const fpsDenominator = safeInteger(fps?.denominator, "timelineFps.denominator", { min: 1 });
  return {
    fpsNumerator: BigInt(fpsNumerator),
    fpsDenominator: BigInt(fpsDenominator),
    sourceAssetId: manifest.sourceAssetId,
  };
}

function windowBounds(index, windowIndex) {
  const sampleStart = BigInt(windowIndex) * index.windowSamples;
  const sampleEnd = sampleStart + index.windowSamples > index.decodedSamples
    ? index.decodedSamples
    : sampleStart + index.windowSamples;
  const startUs = index.audioStartUs + roundDiv(sampleStart * MICROSECONDS_PER_SECOND, index.sampleRate);
  const endUs = index.audioStartUs + roundDiv(sampleEnd * MICROSECONDS_PER_SECOND, index.sampleRate);
  return { startUs, endUs };
}

function rmsForRow(index, windowIndex) {
  const row = index.rows[windowIndex];
  let loudest = 0;
  for (let channel = 0; channel < index.channels; channel += 1) {
    loudest = Math.max(loudest, row[channel * index.featuresPerChannel + index.rmsIndex]);
  }
  return loudest;
}

function findSustainedRun(index, clipStartUs, rangeStartUs, rangeEndUs, clipEndUs, threshold, direction) {
  const windowSpan = index.windowSamples * MICROSECONDS_PER_SECOND;
  const firstDelta = rangeStartUs - index.audioStartUs;
  const lastDelta = rangeEndUs - index.audioStartUs;
  const firstWindow = firstDelta <= 0n ? 0n : firstDelta * index.sampleRate / windowSpan;
  const afterLastWindow = lastDelta <= 0n ? 0n : ceilDiv(lastDelta * index.sampleRate, windowSpan);
  let runLength = 0;
  let runStartUs = null;
  let found = null;
  for (let i = Number(firstWindow); i < Number(afterLastWindow) && i < index.rows.length; i += 1) {
    const bounds = windowBounds(index, i);
    if (bounds.endUs <= rangeStartUs || bounds.startUs >= rangeEndUs) continue;
    // Ignore partial bins only at actual clip edges; never borrow another clip's sound.
    if (bounds.startUs < clipStartUs || bounds.endUs > clipEndUs) {
      runLength = 0;
      runStartUs = null;
      continue;
    }
    if (rmsForRow(index, i) >= threshold) {
      if (runLength === 0) runStartUs = bounds.startUs;
      runLength += 1;
      if (runLength >= RUN_WINDOWS) {
        found = { startUs: runStartUs, endUs: bounds.endUs };
        if (direction === "first") return found;
      }
    } else {
      runLength = 0;
      runStartUs = null;
    }
  }
  return found;
}

function trimFramesBefore(boundaryUs, clipStartUs, map) {
  const delta = boundaryUs - clipStartUs;
  const frames = delta * map.fpsNumerator
    / (MICROSECONDS_PER_SECOND * map.fpsDenominator) - BigInt(LEAVE_FRAMES);
  return frames > 0n ? frames : 0n;
}

function trimFramesAfter(boundaryUs, clipEndUs, map) {
  const delta = clipEndUs - boundaryUs;
  const frames = delta * map.fpsNumerator
    / (MICROSECONDS_PER_SECOND * map.fpsDenominator) - BigInt(LEAVE_FRAMES);
  return frames > 0n ? frames : 0n;
}

export function computeSeamTighteningPlan(indexJson, manifest) {
  const index = validateIndex(indexJson);
  const map = validateManifest(indexJson, manifest);
  if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) {
    fail("Timeline windows must contain a non-empty clips array.");
  }
  const clips = [];
  const seenItemIds = new Set();
  let priorTimelineEnd = null;
  let totalInputFrames = 0;
  let totalTrimFrames = 0;
  let totalHeadTrimFrames = 0;
  let totalTailTrimFrames = 0;

  for (let i = 0; i < manifest.clips.length; i += 1) {
    const clip = manifest.clips[i];
    const itemId = clip?.itemId;
    if (typeof itemId !== "string" || !itemId.trim() || seenItemIds.has(itemId)) {
      fail("Clip " + i + " must have a unique non-empty itemId.");
    }
    seenItemIds.add(itemId);
    if (clip.assetId !== map.sourceAssetId) fail("Clip " + itemId + " refers to a different source asset.");
    const timelineStartFrame = safeInteger(clip.timelineStartFrame, itemId + ".timelineStartFrame", { min: 0 });
    const durationFrames = safeInteger(clip.durationFrames, itemId + ".durationFrames", { min: 1 });
    if (priorTimelineEnd !== null && timelineStartFrame !== priorTimelineEnd) {
      fail("Timeline clips must be ordered and contiguous; unsupported gaps/overlaps at " + itemId + ".");
    }
    priorTimelineEnd = safeInteger(timelineStartFrame + durationFrames, itemId + " timeline end", { min: 1 });
    const sourceStartUs = BigInt(safeInteger(clip.srcStartUs, itemId + ".srcStartUs", { min: 0 }));
    const sourceEndUs = BigInt(safeInteger(clip.srcEndUs, itemId + ".srcEndUs", { min: 1 }));
    if (sourceEndUs <= sourceStartUs || sourceStartUs < index.sourceStartUs || sourceEndUs > index.sourceEndUs) {
      fail("Clip " + itemId + " has an invalid original-source range.");
    }
    if (clip.playbackRateNumerator !== 1 || clip.playbackRateDenominator !== 1) {
      fail("Only explicitly verified 1x playback is supported; refusing to guess speed mapping.");
    }
    if (sourceStartUs < index.audioStartUs || sourceEndUs > index.audioEndUs) {
      fail("Clip " + itemId + " maps outside indexed audio; no extrapolation is allowed.");
    }
    const frameDelta = (sourceEndUs - sourceStartUs) * map.fpsNumerator
      - BigInt(durationFrames) * MICROSECONDS_PER_SECOND * map.fpsDenominator;
    const frameTolerance = MICROSECONDS_PER_SECOND * map.fpsDenominator;
    if (frameDelta > frameTolerance || frameDelta < -frameTolerance) {
      fail("Clip " + itemId + " source duration disagrees with its timeline frame count.");
    }
    const primaryStart = findSustainedRun(
      index, sourceStartUs, sourceStartUs, sourceEndUs, sourceEndUs, PRIMARY_ACTIVITY_RMS16, "first",
    );
    const primaryEnd = findSustainedRun(
      index, sourceStartUs, sourceStartUs, sourceEndUs, sourceEndUs, PRIMARY_ACTIVITY_RMS16, "last",
    );
    const frameUs = ceilDiv(MICROSECONDS_PER_SECOND * map.fpsDenominator, map.fpsNumerator);
    let headBoundaryUs = null;
    let tailBoundaryUs = null;
    let headFallbackUs = null;
    let tailFallbackUs = null;
    let proposedHeadTrimFrames = 0;
    let proposedTailTrimFrames = 0;

    if (primaryStart) {
      const headCandidateUs = primaryStart.startUs - frameUs;
      const fallback = findSustainedRun(
        index, sourceStartUs, sourceStartUs, headCandidateUs, sourceEndUs, LOW_LEVEL_GUARD_RMS16, "first",
      );
      headBoundaryUs = fallback?.startUs ?? primaryStart.startUs;
      headFallbackUs = fallback?.startUs ?? null;
      proposedHeadTrimFrames = Number(trimFramesBefore(headBoundaryUs, sourceStartUs, map));
    }
    if (primaryEnd) {
      const tailCandidateUs = primaryEnd.endUs + frameUs;
      const fallback = findSustainedRun(
        index, sourceStartUs, tailCandidateUs, sourceEndUs, sourceEndUs, LOW_LEVEL_GUARD_RMS16, "last",
      );
      tailBoundaryUs = fallback?.endUs ?? primaryEnd.endUs;
      tailFallbackUs = fallback?.endUs ?? null;
      proposedTailTrimFrames = Number(trimFramesAfter(tailBoundaryUs, sourceEndUs, map));
    }

    if (proposedHeadTrimFrames + proposedTailTrimFrames >= durationFrames) {
      proposedHeadTrimFrames = 0;
      proposedTailTrimFrames = 0;
    }
    // Ripple-trim earlier clips only. This clip's own head trim shortens its
    // source range but its remaining content still starts at this timeline slot.
    const timelineStartFrameAfterShift = timelineStartFrame - totalTrimFrames;
    const durationFramesAfterTrim = durationFrames - proposedHeadTrimFrames - proposedTailTrimFrames;
    totalInputFrames = safeInteger(totalInputFrames + durationFrames, "total input frames", { min: 1 });
    totalTrimFrames = safeInteger(
      totalTrimFrames + proposedHeadTrimFrames + proposedTailTrimFrames,
      "total proposed trim frames", { min: 0 },
    );
    totalHeadTrimFrames = safeInteger(totalHeadTrimFrames + proposedHeadTrimFrames, "total head trim frames", { min: 0 });
    totalTailTrimFrames = safeInteger(totalTailTrimFrames + proposedTailTrimFrames, "total tail trim frames", { min: 0 });
    const reason = primaryStart || primaryEnd
      ? "Waveform boundaries located inside this retained source interval."
      : "No sustained primary-threshold activity found; no edge trim proposed.";
    clips.push({
      itemId,
      timelineStartFrame,
      timelineStartFrameAfterShift,
      durationFrames,
      durationFramesAfterTrim,
      sourceStartUs: Number(sourceStartUs),
      sourceEndUs: Number(sourceEndUs),
      sourceStartUsAfterTrim: toSafeNumber(sourceStartUs + roundDiv(BigInt(proposedHeadTrimFrames) * MICROSECONDS_PER_SECOND * map.fpsDenominator, map.fpsNumerator), itemId + " adjusted start"),
      sourceEndUsAfterTrim: toSafeNumber(sourceEndUs - roundDiv(BigInt(proposedTailTrimFrames) * MICROSECONDS_PER_SECOND * map.fpsDenominator, map.fpsNumerator), itemId + " adjusted end"),
      primaryActivityStartSourceUs: primaryStart ? toSafeNumber(primaryStart.startUs, itemId + " primary start") : null,
      primaryActivityEndSourceUs: primaryEnd ? toSafeNumber(primaryEnd.endUs, itemId + " primary end") : null,
      lowLevelFallbackStartSourceUs: headFallbackUs === null ? null : toSafeNumber(headFallbackUs, itemId + " low-level head fallback"),
      lowLevelFallbackEndSourceUs: tailFallbackUs === null ? null : toSafeNumber(tailFallbackUs, itemId + " low-level tail fallback"),
      proposedHeadTrimFrames,
      proposedTailTrimFrames,
      reason,
    });
  }

  return {
    schemaVersion: 1,
    mode: "candidate-plan-only",
    sourceSha256: indexJson.source.sha256,
    chatcutAssetId: map.sourceAssetId,
    timelineFps: manifest.timelineFps,
    waveformOriginUs: Number(index.audioStartUs),
    activityThresholdsRms16: { primary: PRIMARY_ACTIVITY_RMS16, lowLevelGuard: LOW_LEVEL_GUARD_RMS16 },
    consecutiveWindows: RUN_WINDOWS,
    safety: "Thresholds measure signal level only, not sound categories. Searches stay inside each source interval; one full timeline frame is retained at each proposed edge.",
    editsApplied: false,
    clipCount: clips.length,
    inputDurationFrames: totalInputFrames,
    proposedHeadTrimFrames: totalHeadTrimFrames,
    proposedTailTrimFrames: totalTailTrimFrames,
    proposedTotalTrimFrames: totalTrimFrames,
    proposedDurationFrames: totalInputFrames - totalTrimFrames,
    clips,
  };
}

function parseArguments(argv) {
  const parsed = {};
  const allowed = new Set(["index", "windows", "out", "force"]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--") || !allowed.has(token.slice(2))) {
      fail("Unknown argument " + token + ". Use --index, --windows, and optional --out and --force.");
    }
    const key = token.slice(2);
    if (parsed[key] !== undefined) fail("Duplicate argument --" + key + ".");
    if (key === "force") { parsed.force = true; continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) fail("Missing value for --" + key + ".");
    parsed[key] = value;
    i += 1;
  }
  if (!parsed.index || !parsed.windows) fail("Usage: node scripts/compute-seam-tightening.mjs --index <index.json> --windows <timeline-windows.json> [--out <plan.json>] [--force]");
  if (parsed.force && !parsed.out) fail("--force requires --out.");
  return parsed;
}

function runCli() {
  if (process.argv.slice(2).includes("--help")) {
    console.log("Usage: node scripts/compute-seam-tightening.mjs --index <index.json> --windows <timeline-windows.json> [--out <plan.json>] [--force]\nFor a ChatCut job, use prepare-rough-cut.mjs <job> tighten <saved-preview-pages.json>... to build these inputs automatically.");
    return;
  }
  const args = parseArguments(process.argv.slice(2));
  const indexPath = path.resolve(args.index);
  const windowsPath = path.resolve(args.windows);
  const plan = computeSeamTighteningPlan(
    JSON.parse(fs.readFileSync(indexPath, "utf8")),
    JSON.parse(fs.readFileSync(windowsPath, "utf8")),
  );
  const output = JSON.stringify(plan, null, 2) + "\n";
  if (!args.out) {
    process.stdout.write(output);
    return;
  }
  const outputPath = path.resolve(args.out);
  if (outputPath === indexPath || outputPath === windowsPath) {
    fail("--out must not overwrite an input file.");
  }
  if (args.force && fs.existsSync(outputPath)) {
    const target = fs.lstatSync(outputPath);
    if (!target.isFile() || target.nlink > 1) fail("--force requires a regular output file without symbolic or hard links.");
    if ([indexPath, windowsPath].some((input) => fs.realpathSync(input) === fs.realpathSync(outputPath))) fail("--out must not overwrite an input file.");
  }
  fs.writeFileSync(outputPath, output, { flag: args.force ? "w" : "wx" });
  process.stdout.write("Wrote candidate plan: " + outputPath + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write("Seam tightening plan failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
