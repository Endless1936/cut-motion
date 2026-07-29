import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";
import { isPathInside, readJson, sha256File, sha256Text, writeJsonAtomic } from "./workflow-utils.mjs";

const relative = (jobRoot, candidate) => path.relative(jobRoot, candidate).split(path.sep).join("/");
const digestFiles = (paths) => sha256Text(paths.map((candidate) => `${path.basename(candidate)}:${sha256File(candidate)}`).join("\n"));
const withoutInstalledCaptions = (source) => source.replace(
  /(<!-- CUT_MOTION_CAPTIONS_START -->)[\s\S]*?(<!-- CUT_MOTION_CAPTIONS_END -->)/,
  "$1\n$2"
);
const digestSharedFiles = (paths, compositionSourcePath) => sha256Text(paths.map((candidate) => {
  const digest = candidate === compositionSourcePath
    ? sha256Text(withoutInstalledCaptions(fs.readFileSync(candidate, "utf8")))
    : sha256File(candidate);
  return `${path.basename(candidate)}:${digest}`;
}).join("\n"));
const buildScriptPath = fileURLToPath(new URL("./build-composition.mjs", import.meta.url));
const motionWindowUtilsPath = fileURLToPath(new URL("./motion-window-utils.mjs", import.meta.url));

const assetEntry = (jobRoot, value) => {
  if (!value || value.startsWith("data:") || value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return null;
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
    : path.resolve(hyperframesDirectory, decodedValue);
  if (!isPathInside(jobRoot, absolutePath)) throw new Error(`Local asset escapes the job directory: ${value}`);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) throw new Error(`Local asset is missing: ${value}`);
  return { path: relative(jobRoot, absolutePath), sha256: sha256File(absolutePath) };
};

const assetsForSources = (jobRoot, sources) => {
  const values = [];
  const pattern = /(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/g;
  for (const source of sources) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2];
      const entry = assetEntry(jobRoot, value);
      if (entry) values.push(entry);
    }
  }
  return [...new Map(values.map((entry) => [entry.path, entry])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
};

export const deriveMotionIndex = (jobRootInput) => {
  const jobRoot = path.resolve(jobRootInput);
  const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
  const captionsPath = path.join(jobRoot, "captions", "captions.json");
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  const compositionSourcePath = fs.existsSync(templatePath)
    ? templatePath
    : path.join(jobRoot, "hyperframes", "index.html");
  const captionCssPath = path.join(jobRoot, "hyperframes", "caption.css");
  const packagePath = path.join(jobRoot, "hyperframes", "package.json");
  const transcriptPath = path.join(jobRoot, "state", "transcript.json");
  const beatMap = readJson(beatMapPath);
  const captions = fs.existsSync(captionsPath) ? readJson(captionsPath) : { cues: [] };
  const transcript = readJson(transcriptPath);
  const wordsById = transcriptWordsById(transcript);
  const sharedSourcePaths = [compositionSourcePath, captionCssPath].filter((candidate) => fs.existsSync(candidate));
  const sharedAssets = assetsForSources(jobRoot, sharedSourcePaths.map((candidate) => fs.readFileSync(candidate, "utf8")));
  const sharedPaths = [...new Set([
    ...sharedSourcePaths,
    buildScriptPath,
    motionWindowUtilsPath,
    packagePath,
    ...sharedAssets.map((entry) => path.join(jobRoot, entry.path))
  ].filter((candidate) => fs.existsSync(candidate)))].sort();

  const beats = [...(beatMap.beats ?? [])]
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
    .map((beat) => {
      const moduleDirectory = path.join(jobRoot, "hyperframes", "mg", beat.id);
      const sourcePaths = ["fragment.html", "style.css", "timeline.mjs"].map((filename) => path.join(moduleDirectory, filename));
      const hasModule = sourcePaths.every((candidate) => fs.existsSync(candidate));
      const sources = hasModule ? sourcePaths.map((candidate) => fs.readFileSync(candidate, "utf8")) : [];
      const renderWindow = hasModule ? resolveBeatRenderWindow(beat, beatMap, wordsById) : { start: beat.start, end: beat.end };
      return {
        beatId: beat.id,
        modulePath: hasModule ? relative(jobRoot, moduleDirectory) : null,
        rootSelector: hasModule ? `[data-beat-id="${beat.id}"]` : null,
        assets: hasModule ? assetsForSources(jobRoot, sources) : [],
        captionCueIds: [...(beat.captionCueIds ?? [])].sort(),
        window: { start: renderWindow.start, end: renderWindow.end },
        moduleSha256: hasModule ? digestFiles(sourcePaths) : null
      };
    });

  return {
    schemaVersion: "1.0.0",
    duration: beatMap.duration,
    sourceHashes: {
      beatMap: sha256File(beatMapPath),
      captions: fs.existsSync(captionsPath) ? sha256File(captionsPath) : null,
      compositionTemplate: sha256File(compositionSourcePath)
    },
    sharedDependencySha256: digestSharedFiles(sharedPaths, compositionSourcePath),
    beats,
    captions: [...(captions.cues ?? [])]
      .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id))
      .map((cue) => ({
        cueId: cue.id,
        window: { start: cue.start, end: cue.end },
        contentSha256: sha256Text(JSON.stringify({ lines: cue.lines, text: cue.text }))
      }))
  };
};

export const writeMotionIndex = (jobRootInput) => {
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.join(jobRoot, "state", "motion-index.json");
  const index = deriveMotionIndex(jobRoot);
  writeJsonAtomic(outputPath, index);
  return { outputPath, index };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, jobRoot] = process.argv.slice(2);
  if (!["generate", "check"].includes(command) || !jobRoot) {
    console.error("Usage: node motion-index.mjs <generate|check> <job-directory>");
    process.exit(64);
  }
  const expected = deriveMotionIndex(jobRoot);
  const outputPath = path.join(path.resolve(jobRoot), "state", "motion-index.json");
  if (command === "generate") {
    writeJsonAtomic(outputPath, expected);
    console.log(`Generated ${outputPath}`);
  } else {
    if (!fs.existsSync(outputPath)) throw new Error(`Motion Index is missing: ${outputPath}`);
    if (JSON.stringify(readJson(outputPath)) !== JSON.stringify(expected)) throw new Error("Motion Index is stale");
    console.log(`Motion Index is current: ${outputPath}`);
  }
}
