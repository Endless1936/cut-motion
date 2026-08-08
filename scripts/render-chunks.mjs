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
    if (receipt.cacheKey !== chunk.cacheKey
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
      "."
    ], { cwd: path.join(jobRoot, "hyperframes"), stdio: "inherit", label: `HyperFrames ${quality} Chunk render` });
    const probe = probeVideoArtifact(temporaryPath);
    assertChunkProbe(manifest, chunk, probe);
    assertCurrentManifest(jobRoot, manifest);
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

export const singlePassAudioSupported = (jobRoot, manifest) => {
  const template = fs.readFileSync(path.join(jobRoot, "hyperframes", "index.template.html"), "utf8");
  const audioTags = [...template.matchAll(/<audio\b[^>]*>/gi)].map((match) => match[0]);
  if (audioTags.length !== 1) return false;
  const attributes = parseTagAttributes(audioTags[0]);
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
  const sourceValue = attributes.src?.split(/[?#]/, 1)[0];
  if (!sourceValue || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(sourceValue)) return false;
  let decodedSource;
  try {
    decodedSource = decodeURI(sourceValue);
  } catch {
    return false;
  }
  const sourcePath = path.resolve(path.join(jobRoot, "hyperframes"), decodedSource);
  if (!isPathInside(jobRoot, sourcePath)
    || !fs.existsSync(sourcePath)
    || sha256File(sourcePath) !== manifest.audio.sourceSha256) {
    return false;
  }
  const withoutAudioTag = template.replace(audioTags[0], "");
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
  if (sha256File(pinnedPath) !== item.receipt.artifactSha256) {
    throw new Error("Chunk cache changed while being pinned for assembly");
  }
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
    const muxArguments = (audioCodec) => [
      "-y", "-v", "error",
      "-i", visualPath, "-i", audioPath,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", audioCodec,
      ...(audioCodec === "aac" ? ["-b:a", "192k"] : []),
      "-t", String(manifest.duration),
      "-movflags", "+faststart",
      candidatePath
    ];
    let mux = spawnSync("ffmpeg", muxArguments("copy"), { encoding: "utf8" });
    if (mux.status !== 0) mux = spawnSync("ffmpeg", muxArguments("aac"), { encoding: "utf8" });
    if (mux.status !== 0) throw new Error(`Audio mux failed: ${(mux.stderr || mux.stdout || "").trim()}`);
    const outputProbe = probeVideoArtifact(candidatePath);
    if (outputProbe.actualFrames !== manifest.totalFrames) throw new Error("Final assembled frame count does not match Render Manifest");
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
      "."
    ], { cwd: path.join(jobRoot, "hyperframes"), stdio: "inherit", label: `HyperFrames ${quality} monolithic render` });
    assertCurrentManifest(jobRoot, manifest, mode);
    const fullAudit = workflow.mode === "auto" || workflow.roughCutReviewDecision === "automatic-fallback";
    const detailedProbe = fullAudit || mode === "chunked";
    const probe = probeVideoArtifact(temporaryPath, { detailed: detailedProbe });
    if (detailedProbe) assertFullOutputProbe(manifest, probe, "Monolithic render");
    else assertBasicOutputProbe(manifest, probe, "Monolithic render");
    promoteRenderedCandidate(jobRoot, manifest, temporaryPath, outputPath, { mode });
    const receipt = {
      schemaVersion: "2.0.0",
      quality,
      mode: "monolithic",
      reason,
      artifactSha256: sha256File(outputPath),
      contentManifestSha256: manifest.contentManifestSha256,
      totalFrames: manifest.totalFrames,
      streamSignature: probe.streamSignature
    };
    if (detailedProbe) writeJsonAtomic(assemblyReceiptPath(outputPath), receipt);
    return { mode: "monolithic", outputPath, manifest, receipt: detailedProbe ? receipt : null, reason };
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

const prepareRender = (jobRootInput, quality, outputPathInput, requestedMode) => {
  if (!["standard", "high"].includes(quality)) throw new Error("Render quality must be standard or high");
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.resolve(outputPathInput);
  validateRenderOutputPath(jobRoot, quality, outputPath);
  const binary = resolveLockedHyperframesCli(jobRoot).binaryPath;
  const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  if (!fs.existsSync(templatePath)) throw new Error("Render requires hyperframes/index.template.html");

  const manifest = deriveRenderManifest(jobRoot, { mode: requestedMode });
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
