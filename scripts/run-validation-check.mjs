import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertRegularContainedFile,
  computeValidationBundleSha256,
  computeValidationRunnerVersion,
  computeValidatorVersion,
  isPathInside,
  readJson,
  resolveLockedHyperframesCli,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [jobArgument, phase, checkId, suppliedSampleOrSubjectPath, suppliedSourcePath] = process.argv.slice(2);
if (!jobArgument || !["visual", "final"].includes(phase) || !checkId) {
  console.error("Usage: node scripts/run-validation-check.mjs <job> <visual|final> <check-id> [subject-relative-path] [visual-source-relative-path]");
  process.exit(64);
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const jobRoot = path.resolve(jobArgument);
const contracts = readJson(path.join(repositoryRoot, "config", "validation-evidence-contracts.json"));
const contract = contracts[phase]?.[checkId];
if (!contract) throw new Error(`Unknown validation contract: ${phase}/${checkId}`);
const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
const normalizeRelativePath = (value) => path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
const expectedPaths = phase === "visual"
  ? {
      sample: "previews/visual-sample.mp4",
      source: "hyperframes/visual-sample/index.html"
    }
  : {
      composition: workflow.compositionArtifactPath || "hyperframes/index.html",
      preview: workflow.gates?.["final-preview"]?.artifact || "previews/final-preview.mp4"
    };
const assertExpectedPath = (supplied, expected, label) => {
  if (supplied == null) return expected;
  const normalized = normalizeRelativePath(supplied);
  if (normalized !== expected) {
    throw new Error(`${label} must be ${expected}; received ${normalized}`);
  }
  return normalized;
};
let sampleRelativePath;
let sourceRelativePath;
let subjectRelativePath;
if (phase === "visual") {
  sampleRelativePath = assertExpectedPath(
    suppliedSampleOrSubjectPath,
    expectedPaths.sample,
    "Visual sample subject"
  );
  sourceRelativePath = assertExpectedPath(
    suppliedSourcePath,
    expectedPaths.source,
    "Visual sample source"
  );
  subjectRelativePath = contract.subject === "source" ? sourceRelativePath : sampleRelativePath;
} else {
  if (suppliedSourcePath != null) throw new Error("Final validation accepts only one subject path");
  subjectRelativePath = assertExpectedPath(
    suppliedSampleOrSubjectPath,
    expectedPaths[contract.subject],
    `Final ${contract.subject} subject`
  );
}
const subjectPath = path.resolve(jobRoot, subjectRelativePath);
if (!isPathInside(jobRoot, subjectPath)) throw new Error("Validation subject escapes the job");
assertRegularContainedFile(jobRoot, subjectPath, "Validation subject");
const subjectSha256 = sha256File(subjectPath);
const runnerSha256 = computeValidationRunnerVersion(repositoryRoot, contracts);
const validatorVersion = computeValidatorVersion(repositoryRoot, contracts, contract.validator, jobRoot);
const bundleSha256 = computeValidationBundleSha256(jobRoot, phase, subjectRelativePath, workflow.captionMode);
const canonicalCommand = phase === "visual"
  ? `node ${contracts.runner} ${jobRoot} ${phase} ${checkId} ${sampleRelativePath} ${sourceRelativePath}`
  : `node ${contracts.runner} ${jobRoot} ${phase} ${checkId} ${subjectRelativePath}`;
const receiptRelativePath = `${contract.directory}/${phase}-${checkId}.json`;
const receiptPath = path.join(jobRoot, receiptRelativePath);

const emitEvidence = (receipt) => {
  const evidence = {
    kind: contract.kind,
    path: receiptRelativePath,
    sha256: sha256File(receiptPath),
    subjectSha256,
    validator: contract.validator,
    validatorVersion,
    runnerSha256,
    bundleSha256,
    command: canonicalCommand
  };
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
};

if (fs.existsSync(receiptPath)) {
  const cached = readJson(receiptPath);
  const cachedOutputPath = cached.output?.path ? path.resolve(jobRoot, cached.output.path) : null;
  const outputValid = cachedOutputPath
    && isPathInside(jobRoot, cachedOutputPath)
    && fs.existsSync(cachedOutputPath)
    && sha256File(cachedOutputPath) === cached.output.sha256;
  const snapshotsValid = contract.kind !== "snapshot-manifest"
    || (Array.isArray(cached.snapshots)
      && cached.snapshots.length >= 3
      && cached.snapshots.every((snapshot) => {
        const snapshotPath = path.resolve(jobRoot, snapshot.path ?? "");
        return isPathInside(jobRoot, snapshotPath)
          && fs.existsSync(snapshotPath)
          && sha256File(snapshotPath) === snapshot.sha256;
      }));
  if (cached.schemaVersion === "1.0.0"
    && cached.status === "pass"
    && cached.kind === contract.kind
    && cached.validator === contract.validator
    && cached.validatorVersion === validatorVersion
    && cached.runnerSha256 === runnerSha256
    && cached.bundleSha256 === bundleSha256
    && cached.command === canonicalCommand
    && cached.subject?.path === subjectRelativePath
    && cached.subject?.sha256 === subjectSha256
    && outputValid
    && snapshotsValid) {
    emitEvidence(cached);
    process.exit(0);
  }
}

const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", ...options });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) throw new Error(output || `${contract.validator} failed`);
  return output;
};
const node = (script, argumentsList) => run(process.execPath, [path.join(repositoryRoot, "scripts", script), ...argumentsList]);
const design = path.join(jobRoot, "state", "design-system.json");
let output = "";
const extra = {};

switch (contract.validator) {
  case "check-font":
    output = run("bash", [path.join(repositoryRoot, "scripts", "check-font.sh"), path.dirname(subjectPath), design]);
    break;
  case "check-layout-constraints":
    output = node("check-layout-constraints.mjs", [subjectPath, design]);
    break;
  case "check-information-value":
    output = node("check-information-value.mjs", [subjectPath, design]);
    break;
  case "check-trim-plan":
    output = node("check-trim-plan.mjs", [path.join(jobRoot, "state", "trim-plan.json"), "--require-audit"]);
    break;
  case "check-visual-plan":
  case "check-motion-copy-coverage":
    output = node("check-visual-plan.mjs", [
      path.join(jobRoot, "state", "beat-map.json"),
      path.join(jobRoot, "state", "transcript.json"),
      design
    ]);
    break;
  case "check-captions":
    output = node("check-captions.mjs", [
      path.join(jobRoot, "captions", "captions.json"),
      path.join(jobRoot, "captions", "chatcut-pages.json"),
      design
    ]);
    break;
  case "hyperframes-check":
    {
      const stagingParent = path.join(jobRoot, "checkpoints");
      fs.mkdirSync(stagingParent, { recursive: true });
      const stagingDirectory = fs.mkdtempSync(path.join(stagingParent, "hyperframes-check-"));
      try {
        fs.copyFileSync(subjectPath, path.join(stagingDirectory, "index.html"));
        const subjectDirectory = path.dirname(subjectPath);
        for (const sibling of ["caption.css", "hyperframes.json"]) {
          const source = path.join(subjectDirectory, sibling);
          if (!fs.existsSync(source)) continue;
          assertRegularContainedFile(jobRoot, source, `HyperFrames ${sibling}`);
          fs.copyFileSync(source, path.join(stagingDirectory, sibling));
        }
        const subjectBaseName = path.basename(subjectPath, path.extname(subjectPath));
        const motionSidecarNames = fs.readdirSync(subjectDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".motion.json"))
          .map((entry) => entry.name)
          .sort();
        const matchingMotionSidecarName = `${subjectBaseName}.motion.json`;
        const unexpectedMotionSidecars = motionSidecarNames.filter((name) => name !== matchingMotionSidecarName);
        if (unexpectedMotionSidecars.length > 0) {
          throw new Error(`Motion sidecar basename must match ${path.basename(subjectPath)}: ${unexpectedMotionSidecars.join(", ")}`);
        }
        if (motionSidecarNames.includes(matchingMotionSidecarName)) {
          const motionSidecar = path.join(subjectDirectory, matchingMotionSidecarName);
          assertRegularContainedFile(jobRoot, motionSidecar, "HyperFrames motion sidecar");
          fs.copyFileSync(motionSidecar, path.join(stagingDirectory, "index.motion.json"));
        }
        const assetsSource = path.join(subjectDirectory, "assets");
        if (fs.existsSync(assetsSource)) {
          const assetsTarget = fs.realpathSync(assetsSource);
          if (!fs.statSync(assetsTarget).isDirectory()
            || !isPathInside(fs.realpathSync(jobRoot), assetsTarget)) {
            throw new Error("HyperFrames assets must resolve to a directory inside the job");
          }
          fs.symlinkSync(
            assetsTarget,
            path.join(stagingDirectory, "assets"),
            process.platform === "win32" ? "junction" : "dir"
          );
        }
        const runtime = resolveLockedHyperframesCli(jobRoot);
        output = run(runtime.binaryPath, ["check"], { cwd: stagingDirectory });
      } finally {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
      }
    }
    break;
  case "capture-review-snapshots": {
    const reviewTimes = phase === "final"
      ? node("review-times.mjs", [path.join(jobRoot, "state", "beat-map.json")])
        .split(",")
        .map(Number)
        .filter(Number.isFinite)
      : (() => {
        const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", subjectPath]));
        const duration = Number(probe.format?.duration);
        return [0.08, 0.32, 0.68, 0.92].map((ratio) => Number((duration * ratio).toFixed(3)));
      })();
    if (reviewTimes.length === 0) throw new Error("Beat map produced no review times");
    const snapshots = [];
    for (const [index, time] of reviewTimes.entries()) {
      const relative = `checkpoints/${phase}-${checkId}-${String(index + 1).padStart(3, "0")}.png`;
      const absolute = path.join(jobRoot, relative);
      run("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(time), "-i", subjectPath, "-frames:v", "1", absolute]);
      snapshots.push({ time, path: relative, sha256: sha256File(absolute) });
    }
    extra.snapshots = snapshots;
    output = `Captured ${snapshots.length} review snapshots`;
    break;
  }
  case "audio-silence-check": {
    const analysis = run("ffmpeg", ["-hide_banner", "-nostats", "-i", subjectPath, "-af", "volumedetect", "-f", "null", "-"]);
    const meanVolumeDb = Number(/mean_volume:\s*(-?[0-9.]+)\s*dB/.exec(analysis)?.[1]);
    if (!Number.isFinite(meanVolumeDb) || meanVolumeDb <= -60) throw new Error("Audio is silent or unreadable");
    extra.metrics = { meanVolumeDb };
    output = analysis;
    break;
  }
  case "ffprobe":
    output = run("ffprobe", ["-v", "error", "-show_streams", "-show_format", subjectPath]);
    break;
  default:
    throw new Error(`No runner implementation for ${contract.validator}`);
}

const directory = path.join(jobRoot, contract.directory);
fs.mkdirSync(directory, { recursive: true });
const outputRelativePath = `logs/${phase}-${checkId}.log`;
const outputPath = path.join(jobRoot, outputRelativePath);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${output}\n`);
const receipt = {
  schemaVersion: "1.0.0",
  status: "pass",
  kind: contract.kind,
  validator: contract.validator,
  validatorVersion,
  runnerSha256,
  bundleSha256,
  command: canonicalCommand,
  exitCode: 0,
  output: { path: outputRelativePath, sha256: sha256File(outputPath) },
  subject: { path: subjectRelativePath, sha256: subjectSha256 },
  checkedAt: new Date().toISOString(),
  ...extra
};
writeJsonAtomic(receiptPath, receipt);
emitEvidence(receipt);
