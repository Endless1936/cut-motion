import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import { writeMotionIndex } from "./motion-index.mjs";
import { deriveRenderManifest, resolveRenderMode, writeRenderManifest } from "./render-manifest.mjs";
import {
  isPathInside,
  readJson,
  resolveLockedHyperframesCli,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const hyperframesWorkerArguments = () => {
  const workers = process.env.CUT_MOTION_RENDER_WORKERS;
  if (!workers) return [];
  if (!/^[1-8]$/.test(workers)) {
    throw new Error("CUT_MOTION_RENDER_WORKERS must be a whole number from 1 to 8");
  }
  return ["--workers", workers];
};

const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${options.label ?? command} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
};

export const probeVideoArtifact = (filePath, { detailed = true } = {}) => {
  const probeArguments = [
    "-v", "error",
    ...(detailed ? ["-count_frames", "-show_data"] : []),
    "-show_entries",
    "stream=index,codec_type,codec_name,profile,level,codec_tag_string,width,height,pix_fmt,r_frame_rate,avg_frame_rate,time_base,sample_aspect_ratio,field_order,color_range,color_space,color_transfer,color_primaries,nb_read_frames,nb_frames,extradata:stream_tags=encoder",
    "-show_entries",
    "format=duration",
    "-of", "json",
    filePath
  ];
  const result = run("ffprobe", probeArguments, { label: "FFprobe" });
  const payload = JSON.parse(result.stdout);
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`Rendered artifact has no video stream: ${filePath}`);
  const actualFrames = Number(video.nb_read_frames ?? video.nb_frames);
  if (detailed && (!Number.isInteger(actualFrames) || actualFrames < 1)) {
    throw new Error(`Rendered artifact has no reliable frame count: ${filePath}`);
  }
  return {
    actualFrames: Number.isInteger(actualFrames) && actualFrames > 0 ? actualFrames : null,
    duration: Number(payload.format?.duration),
    audioStreamCount: (payload.streams ?? []).filter((stream) => stream.codec_type === "audio").length,
    width: Number(video.width),
    height: Number(video.height),
    streamSignature: {
      codec: video.codec_name,
      profile: video.profile,
      level: Number(video.level),
      codecTag: video.codec_tag_string,
      width: Number(video.width),
      height: Number(video.height),
      extradataSha256: sha256Text(video.extradata ?? ""),
      fps: video.r_frame_rate,
      averageFps: video.avg_frame_rate,
      timeBase: video.time_base,
      pixelFormat: video.pix_fmt,
      sampleAspectRatio: video.sample_aspect_ratio,
      fieldOrder: video.field_order,
      colorRange: video.color_range ?? null,
      colorSpace: video.color_space ?? null,
      colorTransfer: video.color_transfer ?? null,
      colorPrimaries: video.color_primaries ?? null,
      encoder: video.tags?.encoder ?? null
    }
  };
};

const cachePaths = (jobRoot, quality, cacheKey) => {
  if (!["standard", "high"].includes(quality) || !/^[a-f0-9]{64}$/.test(cacheKey)) throw new Error("Invalid Chunk cache key");
  const directory = path.join(jobRoot, "hyperframes", "cache", quality);
  return {
    directory,
    artifactPath: path.join(directory, `${cacheKey}.mp4`),
    receiptPath: path.join(directory, `${cacheKey}.receipt.json`)
  };
};

export const validateCacheReceipt = (jobRootInput, quality, chunk) => {
  const jobRoot = path.resolve(jobRootInput);
  const paths = cachePaths(jobRoot, quality, chunk.cacheKey);
  if (!fs.existsSync(paths.artifactPath) || !fs.existsSync(paths.receiptPath)) return null;
  try {
    if (!fs.lstatSync(paths.artifactPath).isFile()
      || fs.lstatSync(paths.artifactPath).isSymbolicLink()
      || !fs.lstatSync(paths.receiptPath).isFile()
      || fs.lstatSync(paths.receiptPath).isSymbolicLink()) return null;
    const receipt = readJson(paths.receiptPath);
    const expectedFrames = chunk.endFrame - chunk.startFrame;
    if (receipt.schemaVersion !== "2.0.0"
      || receipt.cacheKey !== chunk.cacheKey
      || receipt.quality !== quality
      || receipt.frameCount !== expectedFrames
      || receipt.chunkDependencySha256 !== chunk.dependencySha256) return null;
    if (receipt.artifactSha256 !== sha256File(paths.artifactPath)) return null;
    if (!receipt.streamSignature) return null;
    const probe = {
      actualFrames: receipt.frameCount,
      audioStreamCount: 0,
      width: receipt.streamSignature.width,
      height: receipt.streamSignature.height,
      streamSignature: receipt.streamSignature
    };
    return { ...paths, receipt, probe };
  } catch {
    return null;
  }
};

const writeCacheReceipt = (paths, quality, chunk, probe) => {
  const receipt = {
    schemaVersion: "2.0.0",
    cacheKey: chunk.cacheKey,
    quality,
    chunkDependencySha256: chunk.dependencySha256,
    artifactSha256: sha256File(paths.artifactPath),
    frameCount: probe.actualFrames,
    streamSignature: probe.streamSignature
  };
  writeJsonAtomic(paths.receiptPath, receipt);
  return receipt;
};

const normalizeChunkFrameBoundary = (temporaryPath, expectedFrames, fps) => {
  const normalizedPath = `${temporaryPath}.normalized.mp4`;
  try {
    run("ffmpeg", [
      "-y", "-v", "error",
      "-i", temporaryPath,
      "-frames:v", String(expectedFrames),
      "-map", "0:v:0",
      "-c:v", "copy",
      "-r", String(fps),
      "-an",
      normalizedPath
    ], { label: "Chunk frame-boundary normalization" });
    fs.renameSync(normalizedPath, temporaryPath);
  } finally {
    if (fs.existsSync(normalizedPath)) fs.unlinkSync(normalizedPath);
  }
};

const assertChunkProbe = (manifest, chunk, probe) => {
  const expectedFrames = chunk.endFrame - chunk.startFrame;
  if (probe.actualFrames !== expectedFrames) {
    throw new Error(`${chunk.id}: rendered ${probe.actualFrames} frames; expected ${expectedFrames}`);
  }
  if (probe.audioStreamCount !== 0) throw new Error(`${chunk.id}: visual cache unexpectedly contains audio`);
  if (probe.width !== manifest.width || probe.height !== manifest.height) throw new Error(`${chunk.id}: rendered dimensions do not match the manifest`);
};

const numericRate = (value) => {
  const [numerator, denominator = "1"] = String(value ?? "").split("/");
  return Number(numerator) / Number(denominator);
};

const assertFullOutputProbe = (manifest, probe, label) => {
  const fps = numericRate(probe.streamSignature?.fps);
  if (probe.actualFrames !== manifest.totalFrames) throw new Error(`${label} frame count differs from Render Manifest`);
  if (probe.width !== manifest.width || probe.height !== manifest.height) throw new Error(`${label} dimensions differ from Render Manifest`);
  if (!Number.isFinite(fps) || Math.abs(fps - manifest.fps) > 0.001) throw new Error(`${label} FPS differs from Render Manifest`);
  if (probe.audioStreamCount < 1) throw new Error(`${label} has no audio stream`);
  if (!Number.isFinite(probe.duration) || Math.abs(probe.duration - manifest.duration) > 1 / manifest.fps) {
    throw new Error(`${label} duration differs from Render Manifest`);
  }
};

const assertBasicOutputProbe = (manifest, probe, label) => {
  const fps = numericRate(probe.streamSignature?.fps);
  if (probe.width !== manifest.width || probe.height !== manifest.height) throw new Error(`${label} dimensions differ from Render Manifest`);
  if (!Number.isFinite(fps) || Math.abs(fps - manifest.fps) > 0.001) throw new Error(`${label} FPS differs from Render Manifest`);
  if (probe.audioStreamCount < 1) throw new Error(`${label} has no audio stream`);
  if (!Number.isFinite(probe.duration) || Math.abs(probe.duration - manifest.duration) > 1 / manifest.fps) {
    throw new Error(`${label} duration differs from Render Manifest`);
  }
};

function assertCurrentManifest(jobRoot, manifest, mode = manifest.chunks?.length ? "chunked" : "monolithic") {
  const current = deriveRenderManifest(jobRoot, {
    mode,
    baselineManifest: manifest
  });
  if (current.contentManifestSha256 !== manifest.contentManifestSha256) {
    throw new Error("Render inputs changed while the output was being produced");
  }
}

const renderChunk = (jobRoot, manifest, chunk, quality, binary) => {
  const existing = validateCacheReceipt(jobRoot, quality, chunk);
  if (existing) return { ...existing, reused: true };
  const paths = cachePaths(jobRoot, quality, chunk.cacheKey);
  fs.mkdirSync(paths.directory, { recursive: true });
  const compositionDirectory = path.join(jobRoot, "hyperframes", "chunks", chunk.id);
  const compositionPath = path.join(compositionDirectory, "index.html");
  buildComposition(path.join(jobRoot, "hyperframes"), {
    startFrame: chunk.startFrame,
    endFrame: chunk.endFrame,
    videoOnly: true,
    outputPath: compositionPath
  });
  const temporaryPath = path.join(paths.directory, `${chunk.cacheKey}.${process.pid}.tmp.mp4`);
  let promoted = false;
  try {
    const relativeComposition = path.relative(path.join(jobRoot, "hyperframes"), compositionPath).split(path.sep).join("/");
    run(binary, [
      "render",
      "--composition", relativeComposition,
      "--quality", quality,
      "--output", temporaryPath,
      ...hyperframesWorkerArguments(),
      "."
    ], { cwd: path.join(jobRoot, "hyperframes"), stdio: "inherit", label: `HyperFrames ${quality} Chunk render` });
    normalizeChunkFrameBoundary(temporaryPath, chunk.endFrame - chunk.startFrame, manifest.fps);
    const probe = probeVideoArtifact(temporaryPath);
    assertChunkProbe(manifest, chunk, probe);
    fs.renameSync(temporaryPath, paths.artifactPath);
    promoted = true;
    const receipt = writeCacheReceipt(paths, quality, chunk, probe);
    return { ...paths, receipt, probe, reused: false };
  } catch (error) {
    if (promoted) {
      for (const candidate of [paths.artifactPath, paths.receiptPath]) {
        if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
      }
    }
    throw error;
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
};

const compatibleSignature = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const evictCacheEntry = (jobRoot, item) => {
  const cacheRoot = path.join(jobRoot, "hyperframes", "cache");
  for (const candidate of [item.artifactPath, item.receiptPath]) {
    if (candidate && isPathInside(cacheRoot, candidate) && fs.existsSync(candidate)) fs.unlinkSync(candidate);
  }
};
const safeConcatLine = (candidate) => {
  if (/[\r\n']/.test(candidate)) throw new Error("Chunk cache path cannot be represented safely in concat input");
  return `file '${candidate}'`;
};

const parseTagAttributes = (tag) => {
  const attributes = {};
  for (const match of tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    if (match[1].toLowerCase() === "audio") continue;
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
};

const resolveLocalMediaPath = (jobRootInput, sourceValue) => {
  const jobRoot = path.resolve(jobRootInput);
  const cleanSource = sourceValue?.split(/[?#]/, 1)[0];
  if (!cleanSource || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(cleanSource)) return null;
  let decodedSource;
  try {
    decodedSource = decodeURI(cleanSource);
  } catch {
    return null;
  }
  const sourcePath = path.resolve(path.join(jobRoot, "hyperframes"), decodedSource);
  if (!isPathInside(jobRoot, sourcePath) || !fs.existsSync(sourcePath)) return null;
  const realPath = fs.realpathSync(sourcePath);
  if (!isPathInside(fs.realpathSync(jobRoot), realPath) || !fs.statSync(realPath).isFile()) return null;
  return realPath;
};

const postMixAudioTag = (jobRoot, tag) => {
  const attributes = parseTagAttributes(tag);
  if (attributes["data-render-audio"] !== "post-mix") return null;
  const sourcePath = resolveLocalMediaPath(jobRoot, attributes.src);
  const start = Number(attributes["data-start"]);
  const duration = Number(attributes["data-duration"]);
  const mediaStart = Number(attributes["data-media-start"] ?? 0);
  const volume = Number(attributes["data-volume"] ?? 1);
  const fadeOutStart = attributes["data-fade-out-start"] == null
    ? null : Number(attributes["data-fade-out-start"]);
  const fadeOutDuration = attributes["data-fade-out-duration"] == null
    ? null : Number(attributes["data-fade-out-duration"]);
  const playbackRate = attributes["data-playback-rate"] ?? attributes.playbackrate;
  if (!sourcePath || !Number.isFinite(start) || start < 0
    || !Number.isFinite(duration) || duration <= 0
    || !Number.isFinite(mediaStart) || mediaStart < 0
    || !Number.isFinite(volume) || volume < 0 || volume > 1
    || (playbackRate != null && Number(playbackRate) !== 1)
    || (fadeOutStart != null && (!Number.isFinite(fadeOutStart) || fadeOutStart < start))
    || (fadeOutDuration != null && (!Number.isFinite(fadeOutDuration) || fadeOutDuration <= 0))) {
    throw new Error("Invalid post-mix audio tag");
  }
  return { sourcePath, start, duration, mediaStart, volume, fadeOutStart, fadeOutDuration };
};

export const resolvePostMixAudioTags = (jobRootInput) => {
  const jobRoot = path.resolve(jobRootInput);
  const template = fs.readFileSync(path.join(jobRoot, "hyperframes", "index.template.html"), "utf8");
  return [...template.matchAll(/<audio\b[^>]*>/gi)]
    .map(([tag]) => postMixAudioTag(jobRoot, tag))
    .filter(Boolean);
};

export const singlePassAudioSupported = (jobRoot, manifest) => {
  const template = fs.readFileSync(path.join(jobRoot, "hyperframes", "index.template.html"), "utf8");
  const audioTags = [...template.matchAll(/<audio\b[^>]*>/gi)].map((match) => match[0]);
  const sourceTags = audioTags.filter((tag) => parseTagAttributes(tag).id === "source-audio");
  const postMixTags = audioTags.filter((tag) => parseTagAttributes(tag)["data-render-audio"] === "post-mix");
  if (sourceTags.length !== 1 || sourceTags.length + postMixTags.length !== audioTags.length) return false;
  const attributes = parseTagAttributes(sourceTags[0]);
  const durationIsFull = attributes["data-duration"] === "__CUT_MOTION_DURATION__"
    || Number(attributes["data-duration"]) === manifest.duration;
  const mediaStartIsZero = attributes["data-media-start"] === "__CUT_MOTION_MEDIA_START__"
    || Number(attributes["data-media-start"]) === 0;
  if (attributes.id !== "source-audio"
    || attributes["data-var-src"] != null
    || Number(attributes["data-start"]) !== 0
    || !durationIsFull
    || !mediaStartIsZero
    || Number(attributes["data-volume"]) !== 1
    || (attributes.playbackrate != null && Number(attributes.playbackrate) !== 1)
    || (attributes["data-playback-rate"] != null && Number(attributes["data-playback-rate"]) !== 1)) {
    return false;
  }
  const sourcePath = resolveLocalMediaPath(jobRoot, attributes.src);
  if (!sourcePath || sha256File(sourcePath) !== manifest.audio.sourceSha256) {
    return false;
  }
  try {
    for (const tag of postMixTags) postMixAudioTag(jobRoot, tag);
  } catch {
    return false;
  }
  const withoutAudioTag = template.replace(/<audio\b[^>]*>\s*<\/audio>/gi, "");
  return !/(?:source-audio|playbackRate|preservesPitch|querySelector(?:All)?\s*\(\s*["'][^"']*audio|timeline\.(?:to|fromTo)\([^)]*\bvolume\b)/s.test(withoutAudioTag);
};

const assemblyReceiptPath = (outputPath) => `${outputPath}.render.json`;
export const promoteRenderedCandidate = (jobRoot, manifest, candidatePath, outputPath, { mode } = {}) => {
  assertCurrentManifest(jobRoot, manifest, mode);
  fs.renameSync(candidatePath, outputPath);
};

export const pinRenderedArtifacts = (workDirectory, rendered) => rendered.map((item, index) => {
  if (!fs.lstatSync(item.artifactPath).isFile() || fs.lstatSync(item.artifactPath).isSymbolicLink()) {
    throw new Error("Chunk cache artifact must be a regular non-symlink file");
  }
  if (sha256File(item.artifactPath) !== item.receipt.artifactSha256) {
    throw new Error("Chunk cache changed before assembly");
  }
  const pinnedPath = path.join(workDirectory, `chunk-${String(index + 1).padStart(4, "0")}.mp4`);
  fs.linkSync(item.artifactPath, pinnedPath);
  return { ...item, pinnedPath };
});

export const assertPinnedArtifacts = (pinned) => {
  for (const item of pinned) {
    if (!fs.existsSync(item.pinnedPath) || sha256File(item.pinnedPath) !== item.receipt.artifactSha256) {
      throw new Error("Pinned Chunk cache changed during assembly");
    }
  }
};

export const assembleChunks = (jobRoot, manifest, quality, rendered, outputPath) => {
  const signature = rendered[0]?.probe.streamSignature;
  if (!signature || rendered.some((item) => !compatibleSignature(signature, item.probe.streamSignature))) {
    for (const item of rendered) evictCacheEntry(jobRoot, item);
    throw new Error(`Rendered ${quality} Chunks have incompatible stream signatures`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const workDirectory = path.join(jobRoot, "hyperframes", "chunks", `assembly-${quality}-${process.pid}`);
  fs.mkdirSync(workDirectory, { recursive: true });
  const concatPath = path.join(workDirectory, "concat.txt");
  const visualPath = path.join(workDirectory, "visual.mp4");
  const candidatePath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${process.pid}.tmp.mp4`);
  try {
    const pinned = pinRenderedArtifacts(workDirectory, rendered);
    fs.writeFileSync(concatPath, `${pinned.map((item) => safeConcatLine(item.pinnedPath)).join("\n")}\n`);
    run("ffmpeg", [
      "-y", "-v", "error",
      "-f", "concat", "-safe", "0", "-i", concatPath,
      "-map", "0:v:0", "-c:v", "copy", "-an",
      visualPath
    ], { label: "Chunk video assembly" });
    const visualProbe = probeVideoArtifact(visualPath);
    if (visualProbe.actualFrames !== manifest.totalFrames) throw new Error("Assembled visual frame count does not match Render Manifest");
    const audioPath = path.join(jobRoot, manifest.audio.sourcePath);
    if (!isPathInside(jobRoot, audioPath) || !fs.existsSync(audioPath) || sha256File(audioPath) !== manifest.audio.sourceSha256) {
      throw new Error("Authoritative audio binding is stale");
    }
    const postMix = resolvePostMixAudioTags(jobRoot);
    const muxArguments = (audioCodec) => {
      const inputArguments = ["-i", visualPath, "-i", audioPath];
      postMix.forEach((item) => inputArguments.push("-i", item.sourcePath));
      if (postMix.length === 0) {
        return [
          "-y", "-v", "error",
          ...inputArguments,
          "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", audioCodec,
          ...(audioCodec === "aac" ? ["-b:a", "192k"] : []),
          "-t", String(manifest.duration),
          "-movflags", "+faststart",
          candidatePath
        ];
      }
      const filters = ["[1:a]aresample=48000,volume=1[base]"];
      const mixLabels = [];
      postMix.forEach((item, index) => {
        const inputIndex = index + 2;
        const delayMs = Math.round(item.start * 1000);
        let filter = `[${inputIndex}:a]atrim=start=${item.mediaStart}:duration=${item.duration},asetpts=PTS-STARTPTS,aresample=48000,volume=${item.volume}`;
        if (item.fadeOutStart != null && item.fadeOutDuration != null) {
          filter += `,afade=t=out:st=${item.fadeOutStart - item.start}:d=${item.fadeOutDuration}`;
        }
        filter += `,adelay=${delayMs}|${delayMs}[mix${index}]`;
        filters.push(filter);
        mixLabels.push(`[mix${index}]`);
      });
      filters.push(`[base]${mixLabels.join("")}amix=inputs=${postMix.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`);
      return [
        "-y", "-v", "error",
        ...inputArguments,
        "-filter_complex", filters.join(";"),
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", audioCodec,
        ...(audioCodec === "aac" ? ["-b:a", "192k"] : []),
        "-t", String(manifest.duration),
        "-movflags", "+faststart",
        candidatePath
      ];
    };
    let mux = postMix.length > 0
      ? spawnSync("ffmpeg", muxArguments("aac"), { encoding: "utf8" })
      : spawnSync("ffmpeg", muxArguments("copy"), { encoding: "utf8" });
    if (postMix.length === 0 && mux.status !== 0) mux = spawnSync("ffmpeg", muxArguments("aac"), { encoding: "utf8" });
    if (mux.status !== 0) throw new Error(`Audio mux failed: ${(mux.stderr || mux.stdout || "").trim()}`);
    const outputProbe = probeVideoArtifact(candidatePath);
    assertFullOutputProbe(manifest, outputProbe, "Final assembled output");
    assertPinnedArtifacts(pinned);
    promoteRenderedCandidate(jobRoot, manifest, candidatePath, outputPath);
    const receipt = {
      schemaVersion: "2.0.0",
      quality,
      mode: "chunked",
      artifactSha256: sha256File(outputPath),
      contentManifestSha256: manifest.contentManifestSha256,
      totalFrames: manifest.totalFrames,
      streamSignature: outputProbe.streamSignature
    };
    writeJsonAtomic(assemblyReceiptPath(outputPath), receipt);
    return receipt;
  } finally {
    if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
};

export const verifyAssemblyReceipt = (
  jobRootInput,
  outputRelativePath,
  { quality = null, contentManifestSha256 = null } = {}
) => {
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.join(jobRoot, outputRelativePath);
  const receiptPath = assemblyReceiptPath(outputPath);
  if (!isPathInside(jobRoot, outputPath) || !fs.existsSync(outputPath) || !fs.existsSync(receiptPath)) {
    throw new Error("Chunk assembly receipt is missing");
  }
  const receipt = readJson(receiptPath);
  const manifestPath = path.join(jobRoot, "state", "render-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Current Render Manifest is missing");
  const manifest = readJson(manifestPath);
  const expectedContentSha256 = contentManifestSha256 ?? manifest.contentManifestSha256;
  const allowedKeys = new Set([
    "schemaVersion",
    "quality",
    "mode",
    "reason",
    "artifactSha256",
    "contentManifestSha256",
    "totalFrames",
    "streamSignature"
  ]);
  if (receipt.schemaVersion !== "2.0.0"
    || Object.keys(receipt).some((key) => !allowedKeys.has(key))
    || !["standard", "high"].includes(receipt.quality)) {
    throw new Error("Render receipt schema is invalid");
  }
  if (receipt.artifactSha256 !== sha256File(outputPath)) throw new Error("Chunk assembly artifact SHA-256 is stale");
  if (quality && receipt.quality !== quality) throw new Error(`Expected ${quality} render receipt`);
  if (receipt.contentManifestSha256 !== expectedContentSha256) {
    throw new Error("Chunk assembly content differs from the current Render Manifest");
  }
  if (!["chunked", "monolithic"].includes(receipt.mode)
    || !Number.isInteger(receipt.totalFrames)
    || receipt.totalFrames !== manifest.totalFrames
    || !receipt.streamSignature) {
    throw new Error("Render receipt is incomplete");
  }
  const probe = probeVideoArtifact(outputPath);
  assertFullOutputProbe(manifest, probe, "Receipt artifact");
  if (!compatibleSignature(receipt.streamSignature, probe.streamSignature)) {
    throw new Error("Render receipt stream signature is stale");
  }
  return receipt;
};

const renderMonolithic = (
  jobRoot,
  quality,
  outputPath,
  binary,
  manifest,
  workflow,
  reason,
  { mode = "monolithic" } = {}
) => {
  assertCurrentManifest(jobRoot, manifest, mode);
  const hyperframesDirectory = path.join(jobRoot, "hyperframes");
  if (!fs.existsSync(path.join(hyperframesDirectory, "index.template.html"))) {
    throw new Error("Monolithic render requires hyperframes/index.template.html");
  }
  buildComposition(hyperframesDirectory);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${process.pid}.tmp.mp4`);
  try {
    run(binary, [
      "render",
      "--composition", "index.html",
      "--quality", quality,
      "--output", temporaryPath,
      ...hyperframesWorkerArguments(),
      "."
    ], { cwd: path.join(jobRoot, "hyperframes"), stdio: "inherit", label: `HyperFrames ${quality} monolithic render` });
    const fullAudit = workflow.mode === "auto" || workflow.roughCutReviewDecision === "automatic-fallback";
    const detailedProbe = fullAudit || mode === "chunked";
    const probe = probeVideoArtifact(temporaryPath, { detailed: detailedProbe });
    if (detailedProbe) assertFullOutputProbe(manifest, probe, "Monolithic render");
    else assertBasicOutputProbe(manifest, probe, "Monolithic render");
    promoteRenderedCandidate(jobRoot, manifest, temporaryPath, outputPath, { mode });
    let receipt = null;
    if (detailedProbe) {
      receipt = {
        schemaVersion: "2.0.0",
        quality,
        mode: "monolithic",
        reason,
        artifactSha256: sha256File(outputPath),
        contentManifestSha256: manifest.contentManifestSha256,
        totalFrames: manifest.totalFrames,
        streamSignature: probe.streamSignature
      };
      writeJsonAtomic(assemblyReceiptPath(outputPath), receipt);
    }
    return { mode: "monolithic", outputPath, manifest, receipt, reason };
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
};

const validateRenderOutputPath = (jobRoot, quality, outputPath) => {
  const outputDirectory = path.join(jobRoot, quality === "standard" ? "previews" : "output");
  if (path.dirname(outputPath) !== outputDirectory || path.extname(outputPath).toLowerCase() !== ".mp4") {
    throw new Error(`${quality} render output must be a direct MP4 child of ${path.relative(jobRoot, outputDirectory)}`);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  if (fs.lstatSync(outputDirectory).isSymbolicLink()
    || !isPathInside(fs.realpathSync(jobRoot), fs.realpathSync(outputDirectory))) {
    throw new Error("Render output directory must be a real directory inside the job");
  }
};

const readPreviousRenderManifest = (jobRoot) => {
  const manifestPath = path.join(jobRoot, "state", "render-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return readJson(manifestPath);
  } catch {
    return null;
  }
};

export const prepareRender = (jobRootInput, quality, outputPathInput, requestedMode) => {
  if (!["standard", "high"].includes(quality)) throw new Error("Render quality must be standard or high");
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.resolve(outputPathInput);
  validateRenderOutputPath(jobRoot, quality, outputPath);
  const binary = resolveLockedHyperframesCli(jobRoot).binaryPath;
  const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  if (!fs.existsSync(templatePath)) throw new Error("Render requires hyperframes/index.template.html");

  const manifest = deriveRenderManifest(jobRoot, {
    mode: requestedMode,
    baselineManifest: readPreviousRenderManifest(jobRoot)
  });
  const renderMode = resolveRenderMode(requestedMode, manifest.duration);
  writeRenderManifest(jobRoot, { manifest });
  writeMotionIndex(jobRoot, manifest);
  return {
    jobRoot,
    outputPath,
    binary,
    workflow,
    manifest,
    quality,
    renderMode
  };
};

const renderPreparedChunked = ({ jobRoot, outputPath, binary, workflow, manifest, quality }) => {
  if (!singlePassAudioSupported(jobRoot, manifest)) {
    return renderMonolithic(jobRoot, quality, outputPath, binary, manifest, workflow, "non-pass-through-audio-graph", {
      mode: "chunked"
    });
  }
  const rendered = [];
  try {
    for (const chunk of manifest.chunks) rendered.push(renderChunk(jobRoot, manifest, chunk, quality, binary));
    assertCurrentManifest(jobRoot, manifest);
    return {
      mode: "chunked",
      manifest,
      receipt: assembleChunks(jobRoot, manifest, quality, rendered, outputPath),
      renderedChunks: rendered.filter((item) => !item.reused).length,
      reusedChunks: rendered.filter((item) => item.reused).length
    };
  } catch (error) {
    for (const item of rendered.filter((candidate) => !candidate.reused)) {
      for (const candidate of [item.artifactPath, item.receiptPath]) {
        if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
      }
    }
    throw error;
  }
};

export const renderChunkedOutput = (jobRootInput, quality, outputPathInput) => {
  const prepared = prepareRender(jobRootInput, quality, outputPathInput, "chunked");
  return renderPreparedChunked(prepared);
};

export const renderOutput = (jobRootInput, quality, outputPathInput, { mode = "auto" } = {}) => {
  const prepared = prepareRender(jobRootInput, quality, outputPathInput, mode);
  if (prepared.renderMode === "monolithic") {
    return renderMonolithic(
      prepared.jobRoot,
      quality,
      prepared.outputPath,
      prepared.binary,
      prepared.manifest,
      prepared.workflow,
      "default-monolithic",
      { mode: "monolithic" }
    );
  }
  return renderPreparedChunked(prepared);
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [jobRoot, quality, outputPath, ...options] = process.argv.slice(2);
  const modeIndex = options.indexOf("--mode");
  const mode = modeIndex === -1 ? "auto" : options[modeIndex + 1];
  if (!jobRoot || !quality || !outputPath
    || (modeIndex !== -1 && (!mode || options.length !== modeIndex + 2))) {
    console.error("Usage: node render-chunks.mjs <job-directory> <standard|high> <output-path> [--mode <auto|monolithic|chunked>]");
    process.exit(64);
  }
  const result = renderOutput(jobRoot, quality, outputPath, { mode });
  console.log(result.mode === "monolithic"
    ? `Rendered monolithic output: ${result.outputPath}`
    : `Chunk render complete: ${result.renderedChunks} rendered, ${result.reusedChunks} reused`);
}
