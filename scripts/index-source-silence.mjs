#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

const WINDOW_MS = 10;
const DEFAULT_LOOKUP_PADDING_MS = 1000;
const cliArgs = process.argv.slice(2);
const outputFlagIndex = cliArgs.indexOf("--output");
const outputPath = outputFlagIndex === -1 ? null : cliArgs[outputFlagIndex + 1];
if (outputFlagIndex !== -1 && (!outputPath || outputFlagIndex !== cliArgs.length - 2)) failUsage();
const args = outputFlagIndex === -1 ? cliArgs : cliArgs.slice(0, outputFlagIndex);
const summaryOnly = args.includes("--summary");

function failUsage() {
  console.error("Usage: node scripts/index-source-silence.mjs <original-video> [--summary] [--output <index.json>]\n       node scripts/index-source-silence.mjs --lookup <waveform-index.json> <source-seams.json> [--output <lookup.json>]");
  process.exit(64);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function secondsToUs(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000_000) : null;
}

function canonicalPath(filePath) {
  const absolutePath = resolve(filePath);
  return existsSync(absolutePath)
    ? realpathSync(absolutePath)
    : resolve(realpathSync(dirname(absolutePath)), basename(absolutePath));
}

function assertSafeOutputPath(pathToWrite, protectedInputs) {
  const outputPath = resolve(pathToWrite);
  const outputRealPath = canonicalPath(outputPath);
  const outputStat = existsSync(outputPath) ? statSync(outputPath) : null;
  for (const inputPath of protectedInputs) {
    const inputRealPath = canonicalPath(inputPath);
    const inputStat = statSync(inputRealPath);
    if (outputRealPath === inputRealPath
      || (outputStat && outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino)) {
      throw new Error(`Refusing to overwrite an input file: ${inputPath}`);
    }
  }
}

function emitJson(value, protectedInputs = []) {
  const content = `${JSON.stringify(value, summaryOnly ? 2 : undefined)}\n`;
  if (outputPath) {
    assertSafeOutputPath(outputPath, protectedInputs);
    writeFileSync(resolve(outputPath), content);
  }
  else process.stdout.write(content);
}

function sampleValue(buffer, offset) {
  const value = buffer.readFloatLE(offset);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
}

function makeDecoder(mediaPath, streamIndex, sampleRate, channelCount) {
  const child = spawn("ffmpeg", [
    "-hide_banner", "-nostats", "-nostdin", "-v", "error", "-i", mediaPath,
    "-map", `0:${streamIndex}`, "-vn", "-acodec", "pcm_f32le", "-f", "f32le", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const windowSamples = Math.max(1, Math.round(sampleRate * WINDOW_MS / 1000));
  const bytesPerFrame = channelCount * 4;
  const features = [];
  const peaks = Array(channelCount).fill(0);
  const sums = Array(channelCount).fill(0);
  const crossings = Array(channelCount).fill(0);
  const exactZeroSamples = Array(channelCount).fill(0);
  const lastSigns = Array(channelCount).fill(0);
  let sampleIndex = 0;
  let count = 0;
  let carry = Buffer.alloc(0);
  let stderr = "";
  let invalidSampleCount = 0;

  function finishWindow() {
    if (!count) return;
    const values = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      values.push(
        Math.round(peaks[channel] * 32767),
        Math.round(Math.sqrt(sums[channel] / count) * 32767),
        crossings[channel],
        exactZeroSamples[channel],
      );
      peaks[channel] = 0;
      sums[channel] = 0;
      crossings[channel] = 0;
      exactZeroSamples[channel] = 0;
    }
    features.push(values);
    count = 0;
  }

  child.stdout.on("data", (chunk) => {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const usableBytes = data.length - data.length % bytesPerFrame;
    for (let offset = 0; offset < usableBytes; offset += bytesPerFrame) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = sampleValue(data, offset + channel * 4);
        if (sample === null) {
          invalidSampleCount += 1;
          continue;
        }
        const sign = sample < 0 ? -1 : sample > 0 ? 1 : 0;
        peaks[channel] = Math.max(peaks[channel], Math.abs(sample));
        sums[channel] += sample * sample;
        if (sample === 0) exactZeroSamples[channel] += 1;
        if (sign && lastSigns[channel] && sign !== lastSigns[channel]) crossings[channel] += 1;
        if (sign) lastSigns[channel] = sign;
      }
      count += 1;
      sampleIndex += 1;
      if (count === windowSamples) finishWindow();
    }
    carry = usableBytes < data.length ? data.subarray(usableBytes) : Buffer.alloc(0);
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const completion = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) return rejectPromise(new Error(`ffmpeg PCM decode exited ${code}: ${stderr.slice(-4000)}`));
      if (carry.length) return rejectPromise(new Error("ffmpeg returned a partial PCM sample frame"));
      if (invalidSampleCount) return rejectPromise(new Error(`ffmpeg PCM decode returned ${invalidSampleCount} non-finite samples; refusing to index them as silence.`));
      finishWindow();
      resolvePromise();
    });
  });

  return { completion, features, get sampleCount() { return sampleIndex; }, windowSamples };
}

function summarize(index) {
  let maxPeak = 0;
  for (const window of index.waveform.windows) {
    for (let channel = 0; channel < index.audio.channels; channel += 1) maxPeak = Math.max(maxPeak, window[channel * 4]);
  }
  return {
    source: index.source,
    audio: index.audio,
    waveform: {
      windowMs: index.waveform.windowMs,
      windowCount: index.waveform.windows.length,
      decodedSampleCount: index.waveform.decodedSampleCount,
      maximumPeakSample: maxPeak,
      exactDigitalSilenceRunCount: index.waveform.digitalSilenceRuns.length,
      features: "per-channel linear peak, RMS, zero-crossing count, and exact-zero sample count",
    },
    detector: index.detector,
  };
}

function lookup(indexPath, seamsPath) {
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  const seamData = JSON.parse(readFileSync(seamsPath, "utf8"));
  if (!index.waveform || !Array.isArray(index.waveform.windows)) {
    throw new Error("Waveform lookup requires a full index; do not pass a --summary output.");
  }
  const seamSourceSha256 = seamData.source?.sha256 ?? seamData.sourceSha256;
  if (!seamSourceSha256 || seamSourceSha256 !== index.source.sha256) {
    throw new Error("Seam map must carry the same source SHA-256 as the waveform index.");
  }
  if (seamData.schemaVersion !== 2) {
    throw new Error("Strict waveform lookup accepts schema-v2 asset-clock seam maps only; legacy schema-v1 threshold candidates are disabled.");
  }
  const seams = seamData.timelineSeams ?? seamData.seams ?? [];
  if (!Array.isArray(seams) || seams.length === 0) throw new Error("Seam map must contain at least one timeline seam.");
  const sourceMap = seamData.sourceMap;
  const operatorVerification = sourceMap?.operatorVerification;
  if (!sourceMap || sourceMap.originalSourceSha256 !== index.source.sha256
    || !Number.isSafeInteger(sourceMap.originalSourceDurationUs) || sourceMap.originalSourceDurationUs !== index.source.durationUs
    || typeof sourceMap.chatcutAssetId !== "string" || !sourceMap.chatcutAssetId.trim()
    || !Number.isSafeInteger(sourceMap.offsetUs)
    || !Number.isSafeInteger(sourceMap.scaleNumerator) || sourceMap.scaleNumerator <= 0
    || !Number.isSafeInteger(sourceMap.scaleDenominator) || sourceMap.scaleDenominator <= 0
    || !Number.isSafeInteger(sourceMap.assetDurationUs) || sourceMap.assetDurationUs <= 0
    || !operatorVerification || operatorVerification.method !== "manual-chatcut-asset-metadata-review"
    || operatorVerification.chatcutAssetId !== sourceMap.chatcutAssetId
    || operatorVerification.originalSourceSha256 !== index.source.sha256
    || operatorVerification.originalSourceDurationUs !== sourceMap.originalSourceDurationUs
    || operatorVerification.assetDurationUs !== sourceMap.assetDurationUs
    || operatorVerification.offsetUs !== sourceMap.offsetUs
    || operatorVerification.scaleNumerator !== sourceMap.scaleNumerator
    || operatorVerification.scaleDenominator !== sourceMap.scaleDenominator
    || typeof operatorVerification.evidence !== "string" || !operatorVerification.evidence.trim()
    || !Number.isSafeInteger(seamData.timelineFps?.numerator) || seamData.timelineFps.numerator <= 0
    || !Number.isSafeInteger(seamData.timelineFps?.denominator) || seamData.timelineFps.denominator <= 0) {
    throw new Error("Schema v2 requires an operator-attested ChatCut asset map whose source hash, duration, asset ID, offset, and scale match the independently inspected evidence.");
  }
  const requestedPaddingMs = Number(seamData.lookupPaddingMs ?? DEFAULT_LOOKUP_PADDING_MS);
  if (!Number.isFinite(requestedPaddingMs)) throw new Error("lookupPaddingMs must be a finite number.");
  const paddingUs = Math.max(0, Math.round(requestedPaddingMs * 1000));
  const { sampleRate, startTimeUs } = index.audio;
  const { windowSamples, windows } = index.waveform;
  const windowCount = windows.length;
  const windowUs = (windowSamples / sampleRate) * 1_000_000;
  const decodedEndTimeUs = startTimeUs + Math.round(index.waveform.decodedSampleCount / sampleRate * 1_000_000);
  const mapAssetTime = (assetTimeUs) => Math.round(assetTimeUs * sourceMap.scaleNumerator / sourceMap.scaleDenominator) + sourceMap.offsetUs;
  const mapStartUs = mapAssetTime(0);
  const mapEndUs = mapAssetTime(sourceMap.assetDurationUs);
  const oneFrameUs = Math.ceil(1_000_000 * seamData.timelineFps.denominator / seamData.timelineFps.numerator);
  if (mapStartUs < startTimeUs - oneFrameUs || mapEndUs > decodedEndTimeUs + oneFrameUs
    || mapEndUs <= mapStartUs) {
    throw new Error("Operator-attested source map falls outside the indexed original audio by more than one timeline frame.");
  }
  const mapSeam = (seam) => {
    if (!Number.isSafeInteger(seam.timelineFrame) || seam.timelineFrame < 0
      || typeof seam.leftItemId !== "string" || !seam.leftItemId
      || typeof seam.rightItemId !== "string" || !seam.rightItemId) {
      throw new Error("Each seam needs a non-negative integer timelineFrame and both item ids.");
    }
    let leftSourceEndUs;
    let rightSourceStartUs;
    if (!Number.isSafeInteger(seam.leftAssetEndUs) || !Number.isSafeInteger(seam.rightAssetStartUs)
      || seam.leftAssetEndUs < 0 || seam.rightAssetStartUs < 0
      || seam.leftAssetEndUs > sourceMap.assetDurationUs || seam.rightAssetStartUs > sourceMap.assetDurationUs) {
      throw new Error(`Seam at frame ${seam.timelineFrame} has asset times outside its operator-attested asset duration.`);
    }
    leftSourceEndUs = mapAssetTime(seam.leftAssetEndUs);
    rightSourceStartUs = mapAssetTime(seam.rightAssetStartUs);
    if (seam.leftItemId === seam.rightItemId) {
      const candidateSpanUs = rightSourceStartUs - leftSourceEndUs;
      if (candidateSpanUs <= 0) {
        throw new Error(`Same-item candidate at frame ${seam.timelineFrame} must have a positive source-time span.`);
      }
      if (paddingUs * 2 < candidateSpanUs) {
        throw new Error(`lookupPaddingMs does not cover the full same-item candidate span at frame ${seam.timelineFrame}; set it to at least half that source-time span.`);
      }
    }
    for (const [label, timeUs] of [["leftSourceEndUs", leftSourceEndUs], ["rightSourceStartUs", rightSourceStartUs]]) {
      if (!Number.isSafeInteger(timeUs)
        || timeUs < startTimeUs - oneFrameUs || timeUs > decodedEndTimeUs + oneFrameUs) {
        throw new Error(`Seam at frame ${seam.timelineFrame} has ${label} outside the indexed original audio.`);
      }
    }
    return { ...seam, leftSourceEndUs, rightSourceStartUs };
  };
  const mappedSeams = seams.map(mapSeam);
  function trace(timeUs) {
    const center = Math.round(((timeUs - startTimeUs) / 1_000_000 * sampleRate) / windowSamples);
    const radius = Math.ceil(paddingUs / windowUs);
    const from = Math.max(0, center - radius);
    const to = Math.min(windowCount, center + radius + 1);
    return Array.from({ length: to - from }, (_, offset) => ({
      timeUs: Math.round(startTimeUs + (from + offset) * windowUs),
      channels: Array.from({ length: index.audio.channels }, (_, channel) => ({
        peakSample: windows[from + offset][channel * 4],
        rmsSample: windows[from + offset][channel * 4 + 1],
        zeroCrossings: windows[from + offset][channel * 4 + 2],
        exactZeroSamples: windows[from + offset][channel * 4 + 3],
      })),
    }));
  }
  const nearbyDigitalSilenceRuns = (timeUs) => index.waveform.digitalSilenceRuns.filter((run) =>
    run.endTimeUs >= timeUs - paddingUs && run.startTimeUs <= timeUs + paddingUs);
  const output = mappedSeams.map((seam) => ({
    ...seam,
    leftWaveform: Number.isFinite(seam.leftSourceEndUs) ? trace(seam.leftSourceEndUs) : undefined,
    rightWaveform: Number.isFinite(seam.rightSourceStartUs) ? trace(seam.rightSourceStartUs) : undefined,
    nearbyDigitalSilenceRuns: {
      left: nearbyDigitalSilenceRuns(seam.leftSourceEndUs),
      right: nearbyDigitalSilenceRuns(seam.rightSourceStartUs),
    },
  }));
  emitJson({
    schemaVersion: 2,
    sourceSha256: index.source.sha256,
    seamCount: output.length,
    lookupPaddingMs: paddingUs / 1000,
    timelineFps: seamData.timelineFps,
    sourceMap: {
      ...sourceMap,
      verificationStatus: "operator-attested; field consistency checked by this utility",
    },
    boundaryPolicy: "schema-v2 original-source waveform trace only; no dB thresholds, ASR, VAD, or cut recommendations",
    seams: output,
  }, [indexPath, seamsPath]);
}

if (args[0] === "--lookup") {
  if (args.length !== 3 || summaryOnly) failUsage();
  lookup(resolve(args[1]), resolve(args[2]));
} else {
  const sourcePath = args.find((argument) => argument !== "--summary");
  if (!sourcePath || args.length > 2 || (args.length === 2 && !summaryOnly)) failUsage();
  const mediaPath = resolve(sourcePath);
  const sourceSha256BeforeDecode = await sha256(mediaPath);
  const probe = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=start_time,duration:stream=index,codec_type,codec_name,sample_rate,channels,time_base,start_time,duration",
    "-of", "json", mediaPath,
  ]));
  const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
  if (!audioStream) throw new Error("The original source has no audio stream.");
  const sampleRate = Number(audioStream.sample_rate);
  const channelCount = Number(audioStream.channels);
  if (!Number.isFinite(sampleRate) || !Number.isFinite(channelCount) || channelCount < 1) {
    throw new Error("Could not read source audio sample rate or channel count.");
  }
  const decoder = makeDecoder(mediaPath, Number(audioStream.index), sampleRate, channelCount);
  await decoder.completion;
  const sourceSha256AfterDecode = await sha256(mediaPath);
  if (sourceSha256BeforeDecode !== sourceSha256AfterDecode) {
    throw new Error("The source file changed while its audio waveform was being indexed; discard this scan and retry.");
  }
  const audioStartTimeUs = secondsToUs(audioStream.start_time ?? probe.format.start_time) ?? 0;
  const digitalSilenceRuns = [];
  let silenceStartSample = null;
  const closeSilenceRun = (endSample) => {
    if (silenceStartSample === null) return;
    digitalSilenceRuns.push({
      startTimeUs: audioStartTimeUs + Math.round(silenceStartSample / sampleRate * 1_000_000),
      endTimeUs: audioStartTimeUs + Math.round(endSample / sampleRate * 1_000_000),
    });
    silenceStartSample = null;
  };
  for (let i = 0; i < decoder.features.length; i += 1) {
    const sampleStart = i * decoder.windowSamples;
    const sampleCount = Math.min(decoder.windowSamples, decoder.sampleCount - sampleStart);
    const window = decoder.features[i];
    const exactZeroAcrossChannels = sampleCount === decoder.windowSamples
      && Array.from({ length: channelCount }, (_, channel) => window[channel * 4 + 3] === sampleCount).every(Boolean);
    if (exactZeroAcrossChannels) {
      if (silenceStartSample === null) silenceStartSample = sampleStart;
    } else {
      closeSilenceRun(sampleStart);
    }
  }
  closeSilenceRun(decoder.sampleCount);
  const index = {
    schemaVersion: 4,
    source: {
      path: mediaPath,
      sha256: sourceSha256AfterDecode,
      startTimeUs: secondsToUs(probe.format.start_time) ?? 0,
      durationUs: secondsToUs(probe.format.duration),
    },
    audio: {
      streamIndex: Number(audioStream.index),
      codec: audioStream.codec_name,
      startTimeUs: audioStartTimeUs,
      durationUs: secondsToUs(audioStream.duration ?? probe.format.duration),
      timeBase: audioStream.time_base,
      sampleRate,
      channels: channelCount,
    },
    detector: {
      name: "FFmpeg single-pass PCM waveform index",
      version: run("ffmpeg", ["-version"]).split(/\r?\n/, 1)[0],
      asrUsed: false,
      vadUsed: false,
      dbThresholdsUsed: false,
      classification: "exact-zero decoded samples on every channel are reported as digital silence; all nonzero audio is preserved in a per-channel waveform trace; no amplitude threshold or cut recommendation is produced",
    },
    waveform: {
      windowMs: WINDOW_MS,
      windowSamples: decoder.windowSamples,
      decodedSampleCount: decoder.sampleCount,
      featureOrderPerChannel: ["linearPeak16", "linearRms16", "zeroCrossings", "exactZeroSamples"],
      windows: decoder.features,
      digitalSilenceRuns,
    },
  };
  emitJson(summaryOnly ? summarize(index) : index, [mediaPath]);
}
