import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCaptionSequence,
  captionFrameWindow,
  frameWindowsOverlap,
  quantizeFrameWindow
} from "./frame-window-utils.mjs";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";
import {
  computeDesignLanguageFingerprint,
  isPathInside,
  readJson,
  resolveLockedHyperframesCli,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from "./workflow-utils.mjs";

export const CHUNK_SECONDS = Object.freeze({ minimum: 8, target: 12, maximum: 18 });
export const MONOLITHIC_MAX_SECONDS = 5 * 60;
const RENDER_MODES = new Set(["auto", "monolithic", "chunked"]);
export const resolveRenderMode = (requestedMode = "auto", duration) => {
  if (!RENDER_MODES.has(requestedMode)) throw new Error(`Unknown render mode: ${requestedMode}`);
  if (requestedMode !== "auto") return requestedMode;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Render mode requires a positive duration");
  return duration <= MONOLITHIC_MAX_SECONDS ? "monolithic" : "chunked";
};
const buildScriptPath = fileURLToPath(new URL("./build-composition.mjs", import.meta.url));
const motionWindowUtilsPath = fileURLToPath(new URL("./motion-window-utils.mjs", import.meta.url));
const frameWindowUtilsPath = fileURLToPath(new URL("./frame-window-utils.mjs", import.meta.url));
const beatMapSchemaPath = fileURLToPath(new URL("../schemas/beat-map.schema.json", import.meta.url));
const boundaryIsSafe = (frame, intervals) => !intervals.some((interval) => interval.startFrame < frame && frame < interval.endFrame);
const uniqueSorted = (values) => [...new Set(values)].sort((left, right) => left - right);
const relative = (root, candidate) => path.relative(root, candidate).split(path.sep).join("/");
const digestFiles = (paths) => sha256Text(paths.map((candidate) => `${relative(path.dirname(candidate), candidate)}:${sha256File(candidate)}`).join("\n"));
const captionBlockPattern = /(<!-- CUT_MOTION_CAPTIONS_START -->)[\s\S]*?(<!-- CUT_MOTION_CAPTIONS_END -->)/;
const stripInstalledCaptions = (source) => {
  const matches = source.match(new RegExp(captionBlockPattern.source, "g"));
  if (matches?.length !== 1) throw new Error("Composition template requires exactly one installed-caption block");
  return source.replace(captionBlockPattern, "$1\n$2");
};
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const installedCaptionSections = (source, cues, fps, totalFrames) => {
  assertCaptionSequence(cues, totalFrames);
  const block = source.match(captionBlockPattern)?.[0];
  if (!block) throw new Error("Composition template requires an installed-caption block");
  const sectionPattern = /<section\b(?=[^>]*\bmotion-caption-layer\b)(?=[^>]*\bdata-caption-id=["']([^"']+)["'])[^>]*>[\s\S]*?<\/section>/gi;
  const sections = new Map();
  for (const match of block.matchAll(sectionPattern)) {
    if (sections.has(match[1])) throw new Error(`Duplicate installed caption section: ${match[1]}`);
    sections.set(match[1], match[0]);
  }
  const residue = block
    .replace("<!-- CUT_MOTION_CAPTIONS_START -->", "")
    .replace("<!-- CUT_MOTION_CAPTIONS_END -->", "")
    .replace(sectionPattern, "")
    .trim();
  if (residue) throw new Error("Installed-caption block contains content outside caption sections");
  if (sections.size !== cues.length) {
    throw new Error(`Installed caption section count ${sections.size} differs from captions.json count ${cues.length}`);
  }
  return new Map(cues.map((cue) => {
    const id = escapeHtml(cue.id);
    const section = sections.get(id);
    if (!section) throw new Error(`Installed caption section is missing: ${cue.id}`);
    const expected = captionFrameWindow(cue, totalFrames);
    const startFrame = Number(/\bdata-caption-start-frame=["'](\d+)["']/.exec(section)?.[1]);
    const endFrame = Number(/\bdata-caption-end-frame=["'](\d+)["']/.exec(section)?.[1]);
    const start = Number(/\bdata-start=["']([^"']+)["']/.exec(section)?.[1]);
    const duration = Number(/\bdata-duration=["']([^"']+)["']/.exec(section)?.[1]);
    if (startFrame !== expected.startFrame || endFrame !== expected.endFrame
      || Math.abs(start - expected.startFrame / fps) > 0.000001
      || Math.abs(duration - (expected.endFrame - expected.startFrame) / fps) > 0.000001) {
      throw new Error(`Installed caption timing differs from captions.json: ${cue.id}`);
    }
    return [cue.id, section];
  }));
};

const assetEntry = (jobRoot, sourceDirectory, value) => {
  if (!value || value.startsWith("data:") || value.startsWith("#")) return null;
  if (/^(?:https?:)?\/\//i.test(value)) {
    throw new Error(`Remote render resources must be localized inside the job: ${value}`);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  const cleanValue = value.split(/[?#]/, 1)[0];
  if (!cleanValue) return null;
  let decodedValue;
  try {
    decodedValue = decodeURI(cleanValue);
  } catch {
    throw new Error(`Invalid local asset URL: ${value}`);
  }
  const hyperframesDirectory = path.join(jobRoot, "hyperframes");
  const absolutePath = decodedValue.startsWith("/")
    ? path.resolve(hyperframesDirectory, `.${decodedValue}`)
    : path.resolve(sourceDirectory, decodedValue);
  if (!isPathInside(jobRoot, absolutePath)) throw new Error(`Local asset escapes the job directory: ${value}`);
  if (!fs.existsSync(absolutePath)) throw new Error(`Local asset is missing: ${value}`);
  const realPath = fs.realpathSync(absolutePath);
  if (!isPathInside(fs.realpathSync(jobRoot), realPath) || !fs.statSync(realPath).isFile()) {
    throw new Error(`Local asset escapes the job directory: ${value}`);
  }
  return { path: relative(jobRoot, absolutePath), sha256: sha256File(realPath) };
};

const dynamicAssetPattern = /\b(?:fetch|import)\s*\(|\bnew\s+URL\s*\(|\.(?:src|srcset|poster)\s*=|\bsetAttribute\s*\(\s*["'](?:src|srcset|poster)["']|\bbackgroundImage\s*=|url\(\s*var\(/;
const assertNoDynamicAssets = (source, sourcePath) => {
  if (dynamicAssetPattern.test(source)) {
    throw new Error(`Dynamic media references are unsupported in render sources: ${relative(path.dirname(path.dirname(sourcePath)), sourcePath)}`);
  }
};

const referencesInSource = (source) => {
  const values = [];
  for (const match of source.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    values.push(match[1] ?? match[2]);
  }
  for (const match of source.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    if (/\bdata:/i.test(match[1])) throw new Error("Data URLs in srcset are unsupported; use a static local file or src");
    for (const candidate of match[1].split(",")) {
      const value = candidate.trim().split(/\s+/, 1)[0];
      if (value) values.push(value);
    }
  }
  for (const match of source.matchAll(/\bimage-set\(([^)]*)\)/gi)) {
    for (const candidate of match[1].matchAll(/["']([^"']+)["']/g)) values.push(candidate[1]);
  }
  for (const match of source.matchAll(/@import\s+["']([^"']+)["']/gi)) values.push(match[1]);
  return values;
};

const assetsForSourcePaths = (jobRoot, sourcePaths, initialReferenceDirectory = null) => {
  const assets = new Map();
  const scanned = new Set();
  const scan = (sourcePath, referenceDirectory = path.dirname(sourcePath)) => {
    const realSourcePath = fs.realpathSync(sourcePath);
    if (scanned.has(realSourcePath)) return;
    scanned.add(realSourcePath);
    const source = fs.readFileSync(sourcePath, "utf8");
    assertNoDynamicAssets(source, sourcePath);
    for (const value of referencesInSource(source)) {
      const entry = assetEntry(jobRoot, referenceDirectory, value);
      if (!entry) continue;
      assets.set(entry.path, entry);
      const referencedPath = path.join(jobRoot, entry.path);
      if (/\.(?:html?|css)$/i.test(referencedPath)) scan(referencedPath);
    }
  };
  for (const sourcePath of sourcePaths) scan(sourcePath, initialReferenceDirectory ?? path.dirname(sourcePath));
  return [...assets.values()]
    .sort((left, right) => left.path.localeCompare(right.path));
};

const digestSharedFiles = (paths, compositionSourcePath) => sha256Text(paths.map((candidate) => {
  const digest = candidate === compositionSourcePath
    ? sha256Text(stripInstalledCaptions(fs.readFileSync(candidate, "utf8")))
    : sha256File(candidate);
  return `${relative(path.dirname(compositionSourcePath), candidate)}:${digest}`;
}).join("\n"));

export const deriveRenderInputs = (jobRootInput) => {
  const jobRoot = path.resolve(jobRootInput);
  const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
  const captionsPath = path.join(jobRoot, "captions", "captions.json");
  const transcriptPath = path.join(jobRoot, "state", "transcript.json");
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  const captionCssPath = path.join(jobRoot, "hyperframes", "caption.css");
  const packagePath = path.join(jobRoot, "hyperframes", "package.json");
  if (!fs.existsSync(templatePath)) throw new Error("Render Manifest requires hyperframes/index.template.html");

  const beatMap = readJson(beatMapPath);
  const captions = fs.existsSync(captionsPath) ? readJson(captionsPath) : { cues: [] };
  const wordsById = transcriptWordsById(readJson(transcriptPath));
  const fps = Number(beatMap.fps);
  const duration = Number(beatMap.duration);
  if (!(fps > 0 && duration > 0)) throw new Error("Render Manifest requires positive fps and duration");
  const totalFrames = Math.ceil(duration * fps);

  const sharedSourcePaths = [templatePath, captionCssPath].filter((candidate) => fs.existsSync(candidate));
  const templateSource = fs.readFileSync(templatePath, "utf8");
  const captionSections = installedCaptionSections(templateSource, captions.cues ?? [], fps, totalFrames);
  const sharedAssets = assetsForSourcePaths(jobRoot, sharedSourcePaths);
  const sharedPaths = [...new Set([
    ...sharedSourcePaths,
    buildScriptPath,
    motionWindowUtilsPath,
    frameWindowUtilsPath,
    beatMapSchemaPath,
    packagePath,
    ...sharedAssets.map((entry) => path.join(jobRoot, entry.path))
  ].filter((candidate) => fs.existsSync(candidate)))].sort();

  const beats = [...(beatMap.beats ?? [])]
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
    .map((beat) => {
      const moduleDirectory = path.join(jobRoot, "hyperframes", "mg", beat.id);
      const sourcePaths = ["fragment.html", "style.css", "timeline.mjs"].map((filename) => path.join(moduleDirectory, filename));
      const hasModule = sourcePaths.every((candidate) => fs.existsSync(candidate));
      const renderWindow = hasModule ? resolveBeatRenderWindow(beat, beatMap, wordsById) : { start: beat.start, end: beat.end };
      const assets = hasModule ? assetsForSourcePaths(jobRoot, sourcePaths, path.join(jobRoot, "hyperframes")) : [];
      const moduleSha256 = hasModule ? digestFiles(sourcePaths) : null;
      const window = quantizeFrameWindow(renderWindow.start, renderWindow.end, fps, totalFrames);
      return {
        beatId: beat.id,
        modulePath: hasModule ? relative(jobRoot, moduleDirectory) : null,
        rootSelector: hasModule ? `[data-beat-id="${beat.id}"]` : null,
        captionCueIds: [...(beat.captionCueIds ?? [])].sort(),
        window,
        fingerprint: sha256Text(JSON.stringify({ beat, renderWindow, moduleSha256, assets }))
      };
    });

  const captionEntries = [...(captions.cues ?? [])]
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
    .map((cue) => ({
      cueId: cue.id,
      window: captionFrameWindow(cue, totalFrames),
      fingerprint: sha256Text(JSON.stringify({
        cue,
        installedSectionSha256: sha256Text(captionSections.get(cue.id))
      }))
    }));

  return {
    beatMap,
    fps,
    duration,
    totalFrames,
    sharedDependencySha256: digestSharedFiles(sharedPaths, templatePath),
    beats,
    captions: captionEntries
  };
};

const mergeIntervals = (intervals) => {
  const sorted = intervals
    .filter((interval) => interval.endFrame > interval.startFrame)
    .sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startFrame < previous.endFrame) previous.endFrame = Math.max(previous.endFrame, interval.endFrame);
    else merged.push({ ...interval });
  }
  return merged;
};

const continuousBAxisIntervals = (beatMap, fps, totalFrames) => {
  const intervals = [];
  let group = [];
  const flush = () => {
    if (group.length > 1) intervals.push(quantizeFrameWindow(group[0].start, group.at(-1).end, fps, totalFrames));
    group = [];
  };
  for (const beat of [...(beatMap.beats ?? [])].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))) {
    const previous = group.at(-1);
    if (!previous || beat.axis !== "B" || previous.axis !== "B" || beat.start > previous.end + 1 / fps) flush();
    group.push(beat);
  }
  flush();
  return intervals;
};

export const unsafeRenderIntervals = (beatMap, inputs) => mergeIntervals([
  ...inputs.beats.filter((beat) => beat.modulePath).map((beat) => beat.window),
  ...inputs.captions.map((cue) => cue.window),
  ...continuousBAxisIntervals(beatMap, inputs.fps, inputs.totalFrames)
]);

const nearestSafeBoundary = (anchor, intervals, lower, upper) => {
  const candidates = [anchor, lower, upper];
  for (const interval of intervals) candidates.push(interval.startFrame, interval.endFrame);
  return uniqueSorted(candidates)
    .filter((frame) => frame >= lower && frame <= upper && boundaryIsSafe(frame, intervals))
    .sort((left, right) => Math.abs(left - anchor) - Math.abs(right - anchor) || left - right)[0] ?? null;
};

export const planStableChunkBoundaries = ({
  totalFrames,
  fps,
  unsafeIntervals,
  baselineBoundaries = [],
  minimumSeconds = CHUNK_SECONDS.minimum,
  targetSeconds = CHUNK_SECONDS.target,
  maximumSeconds = CHUNK_SECONDS.maximum
}) => {
  const minimumFrames = Math.max(1, Math.ceil(minimumSeconds * fps));
  const targetFrames = Math.max(minimumFrames, Math.round(targetSeconds * fps));
  const maximumFrames = Math.max(targetFrames, Math.floor(maximumSeconds * fps));
  const baseline = uniqueSorted(baselineBoundaries)
    .filter((frame) => frame > 0 && frame < totalFrames && boundaryIsSafe(frame, unsafeIntervals));
  const candidates = new Set([0, totalFrames, ...baseline]);
  for (let anchor = targetFrames; anchor < totalFrames; anchor += targetFrames) {
    if ([...candidates].some((frame) => Math.abs(frame - anchor) < minimumFrames / 2)) continue;
    const boundary = nearestSafeBoundary(
      anchor,
      unsafeIntervals,
      Math.max(1, anchor - (targetFrames - minimumFrames)),
      Math.min(totalFrames - 1, anchor + (maximumFrames - targetFrames))
    );
    if (boundary != null) candidates.add(boundary);
  }

  let boundaries = uniqueSorted([...candidates]);
  const protectedBaseline = new Set(baseline);
  const removeCrowdedBoundary = () => {
    if (boundaries.length <= 2) return false;
    for (let index = 1; index < boundaries.length; index += 1) {
      if (boundaries[index] - boundaries[index - 1] >= minimumFrames) continue;
      if (index === 1) boundaries.splice(index, 1);
      else if (index === boundaries.length - 1) boundaries.splice(index - 1, 1);
      else if (protectedBaseline.has(boundaries[index - 1]) && !protectedBaseline.has(boundaries[index])) boundaries.splice(index, 1);
      else boundaries.splice(index - 1, 1);
      return true;
    }
    return false;
  };
  while (removeCrowdedBoundary()) {}

  const fillOversizedGap = () => {
    for (let index = 1; index < boundaries.length; index += 1) {
      const left = boundaries[index - 1];
      const right = boundaries[index];
      if (right - left <= maximumFrames) continue;
      const firstAbsoluteAnchor = Math.ceil((left + minimumFrames) / targetFrames) * targetFrames;
      const anchor = Math.min(right - minimumFrames, Math.max(left + minimumFrames, firstAbsoluteAnchor));
      const boundary = nearestSafeBoundary(anchor, unsafeIntervals, left + minimumFrames, right - minimumFrames);
      if (boundary == null) continue;
      boundaries.push(boundary);
      boundaries = uniqueSorted(boundaries);
      return true;
    }
    return false;
  };
  while (fillOversizedGap()) {}

  if (boundaries[0] !== 0 || boundaries.at(-1) !== totalFrames) throw new Error("Chunk boundaries do not cover the full timeline");
  for (const boundary of boundaries.slice(1, -1)) {
    if (!boundaryIsSafe(boundary, unsafeIntervals)) throw new Error(`Chunk boundary ${boundary} falls inside an active interval`);
  }
  return boundaries;
};

const baselineBoundariesFrom = (baselineManifest) => baselineManifest?.chunks?.slice(0, -1).map((chunk) => chunk.endFrame) ?? [];
const makeChunk = ({ startFrame, endFrame, beats, captions, shared, runtime }) => {
  const dependencySha256 = sha256Text(JSON.stringify({ shared, startFrame, endFrame, beats, captions }));
  return {
    id: `f${String(startFrame).padStart(6, "0")}-f${String(endFrame).padStart(6, "0")}`,
    startFrame,
    endFrame,
    beatIds: beats.map((entry) => entry.beatId),
    captionCueIds: captions.map((entry) => entry.cueId),
    dependencySha256,
    cacheKey: sha256Text(JSON.stringify({ dependencySha256, rendererFingerprint: runtime.fingerprint }))
  };
};

export const deriveRenderManifest = (jobRootInput, options = {}) => {
  const jobRoot = path.resolve(jobRootInput);
  const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
  const designSystem = readJson(path.join(jobRoot, "state", "design-system.json"));
  const packageJson = readJson(path.join(jobRoot, "hyperframes", "package.json"));
  const inputs = deriveRenderInputs(jobRoot);
  const renderMode = resolveRenderMode(options.mode ?? "chunked", inputs.duration);
  const authoritativeMediaPath = path.join(jobRoot, workflow.authoritativeMediaPath ?? "");
  if (!workflow.authoritativeMediaPath
    || !isPathInside(jobRoot, authoritativeMediaPath)
    || !fs.existsSync(authoritativeMediaPath)
    || sha256File(authoritativeMediaPath) !== workflow.authoritativeMediaSha256) {
    throw new Error("Render Manifest authoritative media binding is stale");
  }
  const designLanguageFingerprint = options.designLanguageFingerprint
    ?? computeDesignLanguageFingerprint(jobRoot, workflow.captionMode);
  const runtime = resolveLockedHyperframesCli(jobRoot);
  const shared = {
    authoritativeMediaSha256: workflow.authoritativeMediaSha256,
    designLanguageFingerprint,
    sharedDependencySha256: inputs.sharedDependencySha256,
    canvas: designSystem.canvas,
    fps: inputs.fps,
    hyperframes: packageJson.devDependencies?.hyperframes,
    gsap: packageJson.devDependencies?.gsap,
    rendererFingerprint: runtime.fingerprint,
    cacheContract: 3
  };
  const chunks = renderMode === "chunked" ? (() => {
    const boundaries = planStableChunkBoundaries({
      totalFrames: inputs.totalFrames,
      fps: inputs.fps,
      unsafeIntervals: unsafeRenderIntervals(inputs.beatMap, inputs),
      baselineBoundaries: baselineBoundariesFrom(options.baselineManifest)
    });
    return boundaries.slice(0, -1).map((startFrame, index) => {
      const endFrame = boundaries[index + 1];
      const chunkWindow = { startFrame, endFrame };
      const beats = inputs.beats.filter((entry) => frameWindowsOverlap(chunkWindow, entry.window));
      const captions = inputs.captions.filter((entry) => frameWindowsOverlap(chunkWindow, entry.window));
      return makeChunk({ startFrame, endFrame, beats, captions, shared, runtime });
    });
  })() : [makeChunk({
    startFrame: 0,
    endFrame: inputs.totalFrames,
    beats: inputs.beats,
    captions: inputs.captions,
    shared,
    runtime
  })];
  const content = {
    schemaVersion: "2.0.0",
    fps: inputs.fps,
    width: Number(designSystem.canvas.width),
    height: Number(designSystem.canvas.height),
    totalFrames: inputs.totalFrames,
    duration: inputs.totalFrames / inputs.fps,
    audio: { sourcePath: workflow.authoritativeMediaPath, sourceSha256: workflow.authoritativeMediaSha256 },
    designLanguageFingerprint,
    sharedDependencySha256: inputs.sharedDependencySha256,
    beats: inputs.beats,
    captions: inputs.captions,
    chunks
  };
  return { ...content, contentManifestSha256: sha256Text(JSON.stringify(content)) };
};

export const writeRenderManifest = (jobRootInput, options = {}) => {
  const jobRoot = path.resolve(jobRootInput);
  const manifest = options.manifest ?? deriveRenderManifest(jobRoot, { ...options, mode: options.mode ?? "auto" });
  const outputPath = path.join(jobRoot, "state", "render-manifest.json");
  writeJsonAtomic(outputPath, manifest);
  return { outputPath, manifest };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, jobRoot] = process.argv.slice(2);
  if (!["generate", "check"].includes(command) || !jobRoot) {
    console.error("Usage: node render-manifest.mjs <generate|check> <job-directory>");
    process.exit(64);
  }
  const outputPath = path.join(path.resolve(jobRoot), "state", "render-manifest.json");
  const expected = deriveRenderManifest(jobRoot, { mode: "auto" });
  if (command === "generate") writeJsonAtomic(outputPath, expected);
  else if (!fs.existsSync(outputPath) || JSON.stringify(readJson(outputPath)) !== JSON.stringify(expected)) {
    throw new Error("Render Manifest is missing or stale");
  }
  console.log(`${command === "generate" ? "Generated" : "Verified"} ${outputPath}`);
}
