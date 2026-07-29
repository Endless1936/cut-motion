import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import { deriveRenderManifest, writeRenderManifest } from "./render-manifest.mjs";
import {
  isPathInside,
  readJson,
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

export const probeVideoArtifact = (filePath) => {
  const result = run("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-show_data",
    "-show_entries",
    "stream=index,codec_type,codec_name,profile,level,codec_tag_string,width,height,pix_fmt,r_frame_rate,avg_frame_rate,time_base,sample_aspect_ratio,field_order,color_range,color_space,color_transfer,color_primaries,nb_read_frames,nb_frames,extradata:stream_tags=encoder",
    "-of", "json",
    filePath
  ], { label: "FFprobe" });
  const payload = JSON.parse(result.stdout);
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`Rendered artifact has no video stream: ${filePath}`);
  const actualFrames = Number(video.nb_read_frames ?? video.nb_frames);
  if (!Number.isInteger(actualFrames) || actualFrames < 1) throw new Error(`Rendered artifact has no reliable frame count: ${filePath}`);
  return {
    actualFrames,
    audioStreamCount: payload.streams.filter((stream) => stream.codec_type === "audio").length,
    width: Number(video.width),
    height: Number(video.height),
    streamSignature: {
      codec: video.codec_name,
      profile: video.profile,
      level: Number(video.level),
      codecTag: video.codec_tag_string,
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

const cachePaths = (jobRoot, quality, renderKey) => {
  if (!["standard", "high"].includes(quality) || !/^[a-f0-9]{64}$/.test(renderKey)) throw new Error("Invalid Chunk cache key");
  const directory = path.join(jobRoot, "hyperframes", "cache", quality);
  return {
    directory,
    artifactPath: path.join(directory, `${renderKey}.mp4`),
    receiptPath: path.join(directory, `${renderKey}.receipt.json`)
  };
};

export const validateCacheReceipt = (jobRootInput, quality, chunk) => {
  const jobRoot = path.resolve(jobRootInput);
  const renderKey = quality === "high" ? chunk.highKey : chunk.standardKey;
  const paths = cachePaths(jobRoot, quality, renderKey);
  if (!fs.existsSync(paths.artifactPath) || !fs.existsSync(paths.receiptPath)) return null;
  try {
    const receipt = readJson(paths.receiptPath);
    const expectedFrames = chunk.endFrame - chunk.startFrame;
    if (receipt.renderKey !== renderKey || receipt.quality !== quality || receipt.expectedFrames !== expectedFrames) return null;
    if (receipt.artifactSha256 !== sha256File(paths.artifactPath)) return null;
    if (receipt.actualFrames !== expectedFrames || !receipt.streamSignature) return null;
    const probe = {
      actualFrames: receipt.actualFrames,
      audioStreamCount: 0,
      width: receipt.width,
      height: receipt.height,
      streamSignature: receipt.streamSignature
    };
    return { ...paths, receipt, probe };
  } catch {
    return null;
  }
};

const writeCacheReceipt = (paths, quality, renderKey, chunk, probe) => {
  const receipt = {
    schemaVersion: "1.0.0",
    renderKey,
    quality,
    startFrame: chunk.startFrame,
    endFrame: chunk.endFrame,
    expectedFrames: chunk.endFrame - chunk.startFrame,
    artifactSha256: sha256File(paths.artifactPath),
    actualFrames: probe.actualFrames,
    width: probe.width,
    height: probe.height,
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

function assertCurrentManifest(jobRoot, manifest) {
  const current = deriveRenderManifest(jobRoot, { baselineManifest: manifest });
  if (current.contentManifestSha256 !== manifest.contentManifestSha256) {
    throw new Error("Render inputs changed while the output was being produced");
  }
}

const renderChunk = (jobRoot, manifest, chunk, quality, binary) => {
  const renderKey = quality === "high" ? chunk.highKey : chunk.standardKey;
  const existing = validateCacheReceipt(jobRoot, quality, chunk);
  if (existing) return { ...existing, reused: true };
  const paths = cachePaths(jobRoot, quality, renderKey);
  fs.mkdirSync(paths.directory, { recursive: true });
  const compositionDirectory = path.join(jobRoot, "hyperframes", "chunks");
  const compositionPath = path.join(compositionDirectory, `${chunk.id}.html`);
  buildComposition(path.join(jobRoot, "hyperframes"), {
    startFrame: chunk.startFrame,
    endFrame: chunk.endFrame,
    videoOnly: true,
    outputPath: compositionPath
  });
  const temporaryPath = path.join(paths.directory, `${renderKey}.${process.pid}.tmp.mp4`);
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
    const receipt = writeCacheReceipt(paths, quality, renderKey, chunk, probe);
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
    fs.writeFileSync(concatPath, `${rendered.map((item) => safeConcatLine(item.artifactPath)).join("\n")}\n`);
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
    assertCurrentManifest(jobRoot, manifest);
    fs.renameSync(candidatePath, outputPath);
    const manifestPath = path.join(jobRoot, "state", "render-manifest.json");
    const receipt = {
      schemaVersion: "1.0.0",
      quality,
      outputPath: path.relative(jobRoot, outputPath).split(path.sep).join("/"),
      artifactSha256: sha256File(outputPath),
      renderManifestPath: "state/render-manifest.json",
      renderManifestSha256: sha256File(manifestPath),
      contentManifestSha256: manifest.contentManifestSha256,
      totalFrames: manifest.totalFrames,
      chunkKeys: manifest.chunks.map((chunk) => quality === "high" ? chunk.highKey : chunk.standardKey)
    };
    writeJsonAtomic(assemblyReceiptPath(outputPath), receipt);
    return receipt;
  } finally {
    if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
};

const approvedBaselineManifest = (jobRoot, workflow) => {
  const relativePath = workflow.previewBaseline?.renderManifestPath;
  if (!relativePath) return null;
  const manifestPath = path.join(jobRoot, relativePath);
  if (!isPathInside(jobRoot, manifestPath) || !fs.existsSync(manifestPath)) throw new Error("Approved Render Manifest is missing");
  if (sha256File(manifestPath) !== workflow.previewBaseline.renderManifestSha256) throw new Error("Approved Render Manifest SHA-256 is stale");
  return readJson(manifestPath);
};

export const verifyAssemblyReceipt = (jobRootInput, outputRelativePath, expectedContentSha256 = null) => {
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.join(jobRoot, outputRelativePath);
  const receiptPath = assemblyReceiptPath(outputPath);
  if (!isPathInside(jobRoot, outputPath) || !fs.existsSync(outputPath) || !fs.existsSync(receiptPath)) {
    throw new Error("Chunk assembly receipt is missing");
  }
  const receipt = readJson(receiptPath);
  if (receipt.artifactSha256 !== sha256File(outputPath)) throw new Error("Chunk assembly artifact SHA-256 is stale");
  if (expectedContentSha256 && receipt.contentManifestSha256 !== expectedContentSha256) {
    throw new Error("Chunk assembly content differs from the approved standard preview");
  }
  return receipt;
};

const renderMonolithicFallback = (jobRoot, quality, outputPath, binary, manifest = null, reason = null) => {
  if (manifest) assertCurrentManifest(jobRoot, manifest);
  const hyperframesDirectory = path.join(jobRoot, "hyperframes");
  if (fs.existsSync(path.join(hyperframesDirectory, "index.template.html"))) buildComposition(hyperframesDirectory);
  else if (!fs.existsSync(path.join(hyperframesDirectory, "index.html"))) throw new Error("Fallback composition is missing");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${process.pid}.tmp.mp4`);
  try {
    run(binary, [
      "render",
      "--composition", "index.html",
      "--quality", quality,
      "--output", temporaryPath,
      "."
    ], { cwd: path.join(jobRoot, "hyperframes"), stdio: "inherit", label: `HyperFrames ${quality} fallback render` });
    if (manifest) assertCurrentManifest(jobRoot, manifest);
    let receipt = null;
    if (manifest) {
      const probe = probeVideoArtifact(temporaryPath);
      assertFullOutputProbe(manifest, probe, "Monolithic fallback");
    }
    fs.renameSync(temporaryPath, outputPath);
    if (manifest) {
      const manifestPath = path.join(jobRoot, "state", "render-manifest.json");
      receipt = {
        schemaVersion: "1.0.0",
        quality,
        fallback: true,
        fallbackReason: reason,
        outputPath: path.relative(jobRoot, outputPath).split(path.sep).join("/"),
        artifactSha256: sha256File(outputPath),
        renderManifestPath: "state/render-manifest.json",
        renderManifestSha256: sha256File(manifestPath),
        contentManifestSha256: manifest.contentManifestSha256,
        totalFrames: manifest.totalFrames,
        chunkKeys: []
      };
      writeJsonAtomic(assemblyReceiptPath(outputPath), receipt);
    }
    return { fallback: true, outputPath, manifest, receipt, reason };
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
};

export const renderChunkedOutput = (jobRootInput, quality, outputPathInput) => {
  if (!["standard", "high"].includes(quality)) throw new Error("Chunk render quality must be standard or high");
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.resolve(outputPathInput);
  if (!isPathInside(jobRoot, outputPath)) throw new Error("Chunk render output must stay inside the job");
  const binary = path.join(jobRoot, "hyperframes", "node_modules", ".bin", "hyperframes");
  if (!fs.existsSync(binary)) throw new Error("Job-local HyperFrames is not installed");
  const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
  const baselineManifest = approvedBaselineManifest(jobRoot, workflow);
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  if (!fs.existsSync(templatePath)) {
    return renderMonolithicFallback(jobRoot, quality, outputPath, binary, null, "legacy-composition-without-chunk-contract");
  }
  const manifest = deriveRenderManifest(jobRoot, { baselineManifest });
  if (quality === "high") {
    if (!baselineManifest || !workflow.previewBaseline?.contentManifestSha256) {
      throw new Error("High render requires an approved standard Render Manifest");
    }
    if (manifest.contentManifestSha256 !== workflow.previewBaseline.contentManifestSha256) {
      throw new Error("Current content differs from the approved standard Render Manifest");
    }
  }
  writeRenderManifest(jobRoot, { baselineManifest });
  if (!singlePassAudioSupported(jobRoot, manifest)) {
    return renderMonolithicFallback(jobRoot, quality, outputPath, binary, manifest, "non-pass-through-audio-graph");
  }
  const rendered = [];
  try {
    for (const chunk of manifest.chunks) rendered.push(renderChunk(jobRoot, manifest, chunk, quality, binary));
    assertCurrentManifest(jobRoot, manifest);
    return {
      fallback: false,
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
    return renderMonolithicFallback(jobRoot, quality, outputPath, binary, manifest, error.message);
  }
};

export const pruneChunkCache = (jobRootInput, manifests) => {
  const jobRoot = path.resolve(jobRootInput);
  const keep = { standard: new Set(), high: new Set() };
  for (const manifest of manifests.filter(Boolean)) {
    for (const chunk of manifest.chunks ?? []) {
      keep.standard.add(chunk.standardKey);
      keep.high.add(chunk.highKey);
    }
  }
  for (const quality of ["standard", "high"]) {
    const directory = path.join(jobRoot, "hyperframes", "cache", quality);
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      const match = /^([a-f0-9]{64})\.(?:mp4|receipt\.json)$/.exec(filename);
      if (match && !keep[quality].has(match[1])) fs.unlinkSync(path.join(directory, filename));
    }
  }
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [jobRoot, quality, outputPath] = process.argv.slice(2);
  if (!jobRoot || !quality || !outputPath) {
    console.error("Usage: node render-chunks.mjs <job-directory> <standard|high> <output-path>");
    process.exit(64);
  }
  const result = renderChunkedOutput(jobRoot, quality, outputPath);
  console.log(result.fallback
    ? `Rendered monolithic fallback: ${result.outputPath}`
    : `Chunk render complete: ${result.renderedChunks} rendered, ${result.reusedChunks} reused`);
}
