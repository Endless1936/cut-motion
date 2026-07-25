import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertRegularContainedFile,
  computeValidationBundleSha256,
  isPathInside,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [jobArgument, phase, checkId, sampleOrSubjectRelativePath, sourceRelativePath] = process.argv.slice(2);
if (!jobArgument || !["visual", "final"].includes(phase) || !checkId || !sampleOrSubjectRelativePath) {
  console.error("Usage: node scripts/run-validation-check.mjs <job> <visual|final> <check-id> <subject-relative-path> [visual-source-relative-path]");
  process.exit(64);
}

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const jobRoot = path.resolve(jobArgument);
const contracts = readJson(path.join(repositoryRoot, "config", "validation-evidence-contracts.json"));
const contract = contracts[phase]?.[checkId];
if (!contract) throw new Error(`Unknown validation contract: ${phase}/${checkId}`);
if (phase === "visual" && !sourceRelativePath) throw new Error("Visual validation requires the independent sample source path");
const subjectRelativePath = phase === "visual" && contract.subject === "source"
  ? sourceRelativePath
  : sampleOrSubjectRelativePath;
const subjectPath = path.resolve(jobRoot, subjectRelativePath);
if (!isPathInside(jobRoot, subjectPath)) throw new Error("Validation subject escapes the job");
assertRegularContainedFile(jobRoot, subjectPath, "Validation subject");
const subjectSha256 = sha256File(subjectPath);
const runnerSha256 = sha256File(path.join(repositoryRoot, contracts.runner));
const implementationPath = path.join(repositoryRoot, contracts.implementations[contract.validator]);
const validatorVersion = sha256File(implementationPath);
const workflow = readJson(path.join(jobRoot, "state", "workflow.json"));
const bundleSha256 = computeValidationBundleSha256(jobRoot, phase, subjectRelativePath, workflow.captionMode);
const canonicalCommand = phase === "visual"
  ? `node ${contracts.runner} ${jobRoot} ${phase} ${checkId} ${sampleOrSubjectRelativePath} ${sourceRelativePath}`
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
    output = run("npx", ["hyperframes", "check"], { cwd: path.dirname(subjectPath) });
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
