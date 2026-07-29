import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyDeltaBindings } from "./delta-preview.mjs";
import { readJson, sha256File } from "./workflow-utils.mjs";

const [jobRootArgument] = process.argv.slice(2);
if (!jobRootArgument) {
  console.error("Usage: node render-delta-preview.mjs <job-directory>");
  process.exit(64);
}

const jobRoot = path.resolve(jobRootArgument);
const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
const delta = workflow.pendingDeltaPreview;
if (!delta || !delta.sources?.length || delta.sources.length !== delta.windows?.length) {
  throw new Error("Workflow has no complete delta preview ready to render");
}
verifyDeltaBindings(jobRoot, delta, workflow.previewBaseline, { rebuildProduction: true });

const hyperframesDirectory = path.join(jobRoot, "hyperframes");
const binary = path.join(hyperframesDirectory, "node_modules", ".bin", "hyperframes");
if (!fs.existsSync(binary)) throw new Error("Job-local HyperFrames is not installed");
const outputDirectory = path.join(jobRoot, "previews", "delta");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `revision-${workflow.revisionId}.mp4`);
const renderedWindows = [];
for (let index = 0; index < delta.sources.length; index += 1) {
  const source = delta.sources[index];
  const sourcePath = path.join(jobRoot, source.path);
  if (!fs.existsSync(sourcePath) || sha256File(sourcePath) !== source.sha256) throw new Error("Delta composition is missing or stale");
  const windowOutputPath = delta.sources.length === 1
    ? outputPath
    : path.join(outputDirectory, `revision-${workflow.revisionId}-window-${String(index + 1).padStart(2, "0")}.mp4`);
  const composition = path.relative(hyperframesDirectory, sourcePath).split(path.sep).join("/");
  const result = spawnSync(binary, [
    "render",
    "--composition", composition,
    "--quality", "standard",
    "--output", windowOutputPath,
    "."
  ], { cwd: hyperframesDirectory, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  renderedWindows.push(windowOutputPath);
}
if (renderedWindows.length > 1) {
  const concatPath = path.join(outputDirectory, `revision-${workflow.revisionId}-concat.txt`);
  const concatBody = renderedWindows.map((candidate) => {
    if (/[\r\n']/.test(candidate)) throw new Error("Delta preview path cannot be represented safely in concat input");
    return `file '${candidate}'`;
  }).join("\n");
  fs.writeFileSync(concatPath, `${concatBody}\n`);
  const concat = spawnSync("ffmpeg", [
    "-y",
    "-v", "error",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c", "copy",
    outputPath
  ], { cwd: hyperframesDirectory, stdio: "inherit" });
  if (concat.status !== 0) process.exit(concat.status ?? 1);
  for (const candidate of renderedWindows) fs.unlinkSync(candidate);
  fs.unlinkSync(concatPath);
}
console.log(`Delta preview: ${path.relative(jobRoot, outputPath)}`);
