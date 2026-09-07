import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isPathInside, readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [jobArgument, kind, sourceArgument, ...rawOptions] = process.argv.slice(2);
const targets = {
  roughcut: "roughcut/a-roll.mp4",
 final: "output/final.mp4"
};
if (!jobArgument || !targets[kind] || !sourceArgument) {
  console.error("Usage: node promote-job-media.mjs <job> <roughcut|final> <source-media> [--consume-source]");
  process.exit(64);
}

const consumeSource = rawOptions.includes("--consume-source");
const jobRoot = fs.realpathSync(path.resolve(jobArgument));
const projectPath = path.join(jobRoot, "state", "project.json");
const workflowPath = path.join(jobRoot, "state", "workflow.json");
const project = readJson(projectPath);
const sourcePath = fs.realpathSync(path.resolve(sourceArgument));
const targetPath = path.join(jobRoot, targets[kind]);
const sourceStat = fs.lstatSync(sourcePath);
if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("Source media must be a non-symlink regular file");
const assertOwnedDirectory = (directory) => {
  if (fs.lstatSync(directory).isSymbolicLink() || !isPathInside(jobRoot, fs.realpathSync(directory))) {
    throw new Error(`Job media directory is not owned by the job: ${directory}`);
  }
};
assertOwnedDirectory(path.dirname(targetPath));
if (consumeSource) {
  const immutableSource = fs.realpathSync(path.resolve(jobRoot, project.sourceVideo));
  if (sourcePath === immutableSource || isPathInside(path.join(jobRoot, "input"), sourcePath)) {
    throw new Error("Cannot consume immutable input media");
  }
}
if (fs.existsSync(workflowPath)) {
  const workflow = readJson(workflowPath);
  const gate = workflow.gates?.["rough-cut-review"];
  if (kind === "roughcut" && gate?.status === "approved" && gate.artifact === targets[kind]) {
    throw new Error("Cannot replace approved roughcut media before reopening its producing stage");
  }
  if (kind === "final" && workflow.lastKnownGoodDelivery?.path === targets.final) {
    throw new Error("Render a delivery revision to output/final.candidate.mp4 and let the workflow promote it after validation");
  }
}

const probeMedia = (mediaPath) => {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_type,width,height,r_frame_rate",
    "-of", "json",
    mediaPath
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Unreadable media: ${mediaPath}`);
  const probe = JSON.parse(result.stdout || "{}");
  const duration = Number(probe.format?.duration);
  const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams ?? []).find((stream) => stream.codec_type === "audio");
  if (!Number.isFinite(duration) || duration <= 0 || !video || !audio) throw new Error("Media must contain readable video and audio streams");
  return { duration, width: video.width, height: video.height, fps: video.r_frame_rate };
};

const sourceProbe = probeMedia(sourcePath);
const sourceSha256 = sha256File(sourcePath);
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
const sourceIsCanonical = sourcePath === targetPath;

const pendingPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.pending`);
const previousPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.previous`);
const hyperframesAsset = kind === "roughcut" ? path.join(jobRoot, "hyperframes", "assets", "input-video.mp4") : null;
const pendingAsset = hyperframesAsset ? `${hyperframesAsset}.${process.pid}.pending` : null;
const previousAsset = hyperframesAsset ? `${hyperframesAsset}.${process.pid}.previous` : null;
let sourceMoved = false;
let targetReplaced = false;
let assetReplaced = false;

const backupFile = (currentPath, backupPath) => {
  if (!fs.existsSync(currentPath)) return;
  try {
    fs.linkSync(currentPath, backupPath);
  } catch {
    fs.copyFileSync(currentPath, backupPath, fs.constants.COPYFILE_EXCL);
  }
};

const restore = () => {
  if (assetReplaced && fs.existsSync(hyperframesAsset)) fs.rmSync(hyperframesAsset);
  if (previousAsset && fs.existsSync(previousAsset)) fs.renameSync(previousAsset, hyperframesAsset);
  if (targetReplaced && fs.existsSync(targetPath)) {
    if (sourceMoved) fs.renameSync(targetPath, sourcePath);
    else fs.rmSync(targetPath);
  } else if (sourceMoved && fs.existsSync(pendingPath)) {
    fs.renameSync(pendingPath, sourcePath);
  }
  if (fs.existsSync(previousPath)) fs.renameSync(previousPath, targetPath);
  for (const temporary of [pendingPath, pendingAsset].filter(Boolean)) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
};

try {
  if (!sourceIsCanonical) {
    if (consumeSource && sourceStat.dev === fs.statSync(path.dirname(targetPath)).dev) {
      fs.renameSync(sourcePath, pendingPath);
      sourceMoved = true;
    } else {
      fs.copyFileSync(sourcePath, pendingPath, fs.constants.COPYFILE_EXCL);
    }
    if (sha256File(pendingPath) !== sourceSha256) throw new Error("Temporary media hash differs from source");
    probeMedia(pendingPath);
    backupFile(targetPath, previousPath);
    fs.renameSync(pendingPath, targetPath);
    targetReplaced = true;
  }

  if (hyperframesAsset) {
    assertOwnedDirectory(path.join(jobRoot, "hyperframes"));
    fs.mkdirSync(path.dirname(hyperframesAsset), { recursive: true });
    assertOwnedDirectory(path.dirname(hyperframesAsset));
    try {
      fs.linkSync(targetPath, pendingAsset);
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error.code)) throw error;
      fs.copyFileSync(targetPath, pendingAsset, fs.constants.COPYFILE_EXCL);
    }
    backupFile(hyperframesAsset, previousAsset);
    fs.renameSync(pendingAsset, hyperframesAsset);
    assetReplaced = true;
  }

  project.mediaArtifacts ??= {};
  project.mediaArtifacts[kind] = { path: targets[kind], sha256: sourceSha256, ...sourceProbe, updatedAt: new Date().toISOString() };
  writeJsonAtomic(projectPath, project);

  for (const obsoletePath of [
    previousPath,
    previousAsset,
    // POSIX rename can be a no-op when the asset already links to the target.
    pendingAsset,
    consumeSource && !sourceMoved && !sourceIsCanonical ? sourcePath : null
  ].filter(Boolean)) {
    try {
      if (fs.existsSync(obsoletePath)) fs.rmSync(obsoletePath);
    } catch (error) {
      console.error(`Warning: promoted media but could not remove ${obsoletePath}: ${error.message}`);
    }
  }
} catch (error) {
  restore();
  throw error;
}

console.log(`${sourceIsCanonical ? "Media already canonical" : `Promoted ${kind}`}: ${targets[kind]}${consumeSource && !sourceIsCanonical ? " and consumed source" : ""}`);
