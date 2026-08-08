import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isPathInside,
  readJson,
  resolveLockedHyperframesCli,
  sha256File,
  sha256Text
} from "./workflow-utils.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractsPath = path.join(repositoryRoot, "config", "validation-evidence-contracts.json");
const receiptSchemaPath = path.join(repositoryRoot, "schemas", "validation-receipt.schema.json");
const localReferencePattern = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"'()]+)["']?\s*\)/gi;
const srcsetPattern = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
const imageSetPattern = /\bimage-set\(([^)]*)\)/gi;
const cssImportPattern = /@import\s+["']([^"']+)["']/gi;
const importPattern = /(?:from\s*|import\s*)["'](\.[^"']+)["']/g;
const dynamicAssetPattern = /\b(?:fetch|import)\s*\(|\bnew\s+URL\s*\(|\.(?:src|srcset|poster)\s*=|\bsetAttribute\s*\(\s*["'](?:src|srcset|poster)["']|\bbackgroundImage\s*=|url\(\s*var\(/;

const normalizeRelativePath = (value) => path.posix.normalize(String(value).replaceAll("\\", "/")).replace(/^\.\//, "");
const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const fileBinding = (prefix, root, absolutePath) => ({
  path: `${prefix}:${normalizeRelativePath(path.relative(root, absolutePath))}`,
  sha256: sha256File(absolutePath)
});

const requireRegularFile = (absolutePath, label) => {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label} is missing: ${absolutePath}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
};

const addRepositoryModuleClosure = (absolutePath, files) => {
  const resolved = path.resolve(absolutePath);
  if (files.has(resolved)) return;
  requireRegularFile(resolved, "Validation implementation");
  files.add(resolved);
  if (!/\.[cm]?js$/i.test(resolved)) return;
  const source = fs.readFileSync(resolved, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const imported = path.resolve(path.dirname(resolved), match[1]);
    if (isPathInside(repositoryRoot, imported)) addRepositoryModuleClosure(imported, files);
  }
};

const cleanLocalReference = (value) => {
  const reference = value.trim();
  if (!reference
    || reference.startsWith("#")
    || /^(?:data|blob|https?):/i.test(reference)
    || reference.startsWith("//")) return null;
  return decodeURIComponent(reference.split(/[?#]/, 1)[0]);
};

const addReferencedJobFiles = (jobRoot, sourcePath, files) => {
  const resolved = path.resolve(sourcePath);
  if (files.has(resolved)) return;
  requireRegularFile(resolved, "Validation input");
  const realJobRoot = fs.realpathSync(jobRoot);
  const realInput = fs.realpathSync(resolved);
  if (!isPathInside(realJobRoot, realInput)) throw new Error(`Validation input escapes the job: ${resolved}`);
  files.add(resolved);
  if (!/\.(?:html?|css)$/i.test(resolved)) return;
  const source = fs.readFileSync(resolved, "utf8");
  if (dynamicAssetPattern.test(source)) {
    throw new Error(`Dynamic validation media references are unsupported: ${resolved}`);
  }
  const references = [...source.matchAll(localReferencePattern)].map((match) => match[1] ?? match[2] ?? "");
  for (const match of source.matchAll(srcsetPattern)) {
    for (const candidate of match[1].split(",")) references.push(candidate.trim().split(/\s+/, 1)[0]);
  }
  for (const match of source.matchAll(imageSetPattern)) {
    for (const candidate of match[1].matchAll(/["']([^"']+)["']/g)) references.push(candidate[1]);
  }
  for (const referenceValue of references) {
    const reference = cleanLocalReference(referenceValue);
    if (!reference) continue;
    const referencedPath = path.resolve(path.dirname(resolved), reference);
    if (!isPathInside(jobRoot, referencedPath)) {
      throw new Error(`Local validation reference escapes the job: ${reference}`);
    }
    addReferencedJobFiles(jobRoot, referencedPath, files);
  }
  for (const match of source.matchAll(cssImportPattern)) {
    const reference = cleanLocalReference(match[1]);
    if (!reference) continue;
    const referencedPath = path.resolve(path.dirname(resolved), reference);
    if (!isPathInside(jobRoot, referencedPath)) {
      throw new Error(`Local validation reference escapes the job: ${reference}`);
    }
    addReferencedJobFiles(jobRoot, referencedPath, files);
  }
};

const addJobFile = (jobRoot, relativePath, files, required = true) => {
  const absolutePath = path.resolve(jobRoot, relativePath);
  if (!isPathInside(jobRoot, absolutePath)) throw new Error(`Validation input escapes the job: ${relativePath}`);
  if (!fs.existsSync(absolutePath)) {
    if (!required) return;
    throw new Error(`Validation input is missing: ${relativePath}`);
  }
  addReferencedJobFiles(jobRoot, absolutePath, files);
};

const jobDependencies = (jobRoot, phase, validator, subjectRelativePath) => {
  const files = new Set();
  const subjectPath = path.resolve(jobRoot, subjectRelativePath);
  addJobFile(jobRoot, subjectRelativePath, files);
  const add = (relativePath, required = true) => addJobFile(jobRoot, relativePath, files, required);
  const design = "state/design-system.json";

  if (["check-font", "check-layout-constraints", "check-information-value", "check-captions"].includes(validator)) {
    add(design);
  }
  if (validator === "check-captions") {
    add("captions/captions.json");
    add("captions/chatcut-pages.json");
    const captions = readJson(path.join(jobRoot, "captions", "captions.json"));
    add(captions.source?.reviewPlan ?? "captions/caption-review-plan.json");
    add("state/transcript.json");
  }
  if (validator === "capture-review-snapshots" && phase === "final") add("state/beat-map.json");

  const subjectDirectory = path.dirname(subjectPath);
  if (validator === "check-layout-constraints") {
    const captionCss = path.join(subjectDirectory, "caption.css");
    if (fs.existsSync(captionCss)) addReferencedJobFiles(jobRoot, captionCss, files);
  }
  if (validator === "check-font") {
    const designSystem = readJson(path.join(jobRoot, design));
    const fontAsset = designSystem.typography?.fontAsset;
    if (typeof fontAsset !== "string" || fontAsset.length === 0) throw new Error("Design system font asset is missing");
    addReferencedJobFiles(jobRoot, path.resolve(subjectDirectory, fontAsset), files);
  }
  if (validator === "hyperframes-check") {
    for (const sibling of ["caption.css", "hyperframes.json"]) {
      const candidate = path.join(subjectDirectory, sibling);
      if (fs.existsSync(candidate)) addReferencedJobFiles(jobRoot, candidate, files);
    }
    const matchingSidecarName = `${path.basename(subjectPath, path.extname(subjectPath))}.motion.json`;
    const unexpectedSidecars = fs.readdirSync(subjectDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".motion.json") && entry.name !== matchingSidecarName)
      .map((entry) => entry.name)
      .sort();
    if (unexpectedSidecars.length > 0) {
      throw new Error(`Motion sidecar basename must match ${path.basename(subjectPath)}: ${unexpectedSidecars.join(", ")}`);
    }
    const sidecar = path.join(
      subjectDirectory,
      matchingSidecarName
    );
    if (fs.existsSync(sidecar)) addReferencedJobFiles(jobRoot, sidecar, files);
    add("hyperframes/package.json");
  }

  files.delete(subjectPath);
  return [...files]
    .sort((left, right) => path.relative(jobRoot, left).localeCompare(path.relative(jobRoot, right)))
    .map((absolutePath) => fileBinding("job", jobRoot, absolutePath));
};

const implementationBinding = (contracts, contract) => {
  const files = new Set();
  addRepositoryModuleClosure(path.join(repositoryRoot, contracts.runner), files);
  addRepositoryModuleClosure(path.join(repositoryRoot, contracts.implementations[contract.validator]), files);
  files.add(contractsPath);
  files.add(receiptSchemaPath);
  for (const relativePath of contract.repositoryInputs ?? []) {
    files.add(path.join(repositoryRoot, relativePath));
  }
  const fingerprints = [...files]
    .sort((left, right) => path.relative(repositoryRoot, left).localeCompare(path.relative(repositoryRoot, right)))
    .map((absolutePath) => `${path.relative(repositoryRoot, absolutePath)}:${sha256File(absolutePath)}`);
  fingerprints.push(`contract:${stableJson(contract)}`);
  return sha256Text(fingerprints.join("\n"));
};

const runtimeBindings = (jobRoot, validator) => {
  if (validator !== "hyperframes-check") return [];
  const runtime = resolveLockedHyperframesCli(jobRoot);
  const installedPackagePath = path.join(jobRoot, "hyperframes", "node_modules", "hyperframes", "package.json");
  return [
    { path: "runtime:hyperframes/package.json", sha256: sha256File(installedPackagePath) },
    { path: "runtime:hyperframes/cli", sha256: sha256File(fs.realpathSync(runtime.binaryPath)) },
    { path: `runtime:hyperframes@${runtime.version}`, sha256: runtime.fingerprint }
  ];
};

export const resolveValidationInvocation = (
  jobRootInput,
  phase,
  checkId,
  subjectRelativePath,
  contracts = readJson(contractsPath)
) => {
  const jobRoot = path.resolve(jobRootInput);
  const contract = contracts[phase]?.[checkId];
  if (!contract) throw new Error(`Unknown validation contract: ${phase}/${checkId}`);
  const normalizedSubject = normalizeRelativePath(subjectRelativePath);
  const subjectPath = path.resolve(jobRoot, normalizedSubject);
  if (!isPathInside(jobRoot, subjectPath)) throw new Error("Validation subject escapes the job");
  requireRegularFile(subjectPath, "Validation subject");
  const inputs = [
    ...jobDependencies(jobRoot, phase, contract.validator, normalizedSubject),
    ...runtimeBindings(jobRoot, contract.validator)
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    contract,
    receiptRelativePath: `${contract.directory}/${phase}-${checkId}.json`,
    subject: { path: normalizedSubject, sha256: sha256File(subjectPath) },
    implementationSha256: implementationBinding(contracts, contract),
    inputs
  };
};

export const resolveCanonicalSubject = (jobRootInput, phase, contract) => {
  if (phase === "visual") {
    return contract.subject === "source"
      ? "hyperframes/visual-sample/index.html"
      : "previews/visual-sample.mp4";
  }
  const workflow = readJson(path.join(path.resolve(jobRootInput), "state", "workflow.json"));
  return contract.subject === "composition"
    ? workflow.compositionArtifactPath || "hyperframes/index.html"
    : "output/final.mp4";
};

const bindingsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const isCanonicalFile = (jobRoot, candidate, sha256) => {
  if (!isPathInside(jobRoot, candidate) || !fs.existsSync(candidate)) return false;
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  return isPathInside(fs.realpathSync(jobRoot), fs.realpathSync(candidate))
    && sha256File(candidate) === sha256;
};

export const validateReceipt = (jobRootInput, receipt, invocation) => {
  const jobRoot = path.resolve(jobRootInput);
  const receiptBase = path.basename(invocation.receiptRelativePath, ".json");
  const expectedOutput = `logs/${receiptBase}.log`;
  const allowedKeys = new Set([
    "schemaVersion",
    "status",
    "kind",
    "validator",
    "implementationSha256",
    "inputs",
    "output",
    "subject",
    "checkedAt",
    "snapshots",
    "metrics"
  ]);
  if (receipt?.schemaVersion !== "1.0.0"
    || Object.keys(receipt).some((key) => !allowedKeys.has(key))
    || receipt.status !== "pass"
    || receipt.kind !== invocation.contract.kind
    || receipt.validator !== invocation.contract.validator
    || receipt.implementationSha256 !== invocation.implementationSha256
    || !bindingsEqual(receipt.inputs, invocation.inputs)
    || !bindingsEqual(receipt.subject, invocation.subject)
    || typeof receipt.checkedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.checkedAt))) return false;

  const outputRelativePath = normalizeRelativePath(receipt.output?.path ?? "");
  const reservedPaths = new Set([
    normalizeRelativePath(invocation.receiptRelativePath),
    normalizeRelativePath(invocation.subject.path),
    ...invocation.inputs
      .filter((binding) => binding.path.startsWith("job:"))
      .map((binding) => normalizeRelativePath(binding.path.slice(4)))
  ]);
  const outputPath = path.resolve(jobRoot, outputRelativePath);
  if (outputRelativePath !== expectedOutput
    || reservedPaths.has(outputRelativePath)
    || !isCanonicalFile(jobRoot, outputPath, receipt.output?.sha256)) return false;
  if (receipt.kind === "snapshot-manifest") {
    if (!Array.isArray(receipt.snapshots) || receipt.snapshots.length < 3) return false;
    const snapshotTimes = new Set();
    const snapshotPaths = new Set();
    const snapshotPattern = new RegExp(`^checkpoints/${receiptBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{3}\\.png$`);
    for (const snapshot of receipt.snapshots) {
      if (!Number.isFinite(snapshot.time) || snapshot.time < 0 || snapshotTimes.has(snapshot.time)) return false;
      snapshotTimes.add(snapshot.time);
      const snapshotRelativePath = normalizeRelativePath(snapshot.path ?? "");
      if (!snapshotPattern.test(snapshotRelativePath)
        || snapshotPaths.has(snapshotRelativePath)
        || reservedPaths.has(snapshotRelativePath)
        || snapshotRelativePath === outputRelativePath) return false;
      snapshotPaths.add(snapshotRelativePath);
      const snapshotPath = path.resolve(jobRoot, snapshotRelativePath);
      if (!isCanonicalFile(jobRoot, snapshotPath, snapshot.sha256)) return false;
    }
  }
  return true;
};

export const validateCanonicalReceipt = (
  jobRootInput,
  phase,
  checkId,
  evidenceItem,
  { subjectRelativePath } = {}
) => {
  const jobRoot = path.resolve(jobRootInput);
  const contracts = readJson(contractsPath);
  const contract = contracts[phase]?.[checkId];
  if (!contract) throw new Error(`Unknown validation contract: ${phase}/${checkId}`);
  const expectedRelativePath = `${contract.directory}/${phase}-${checkId}.json`;
  if (!evidenceItem
    || Object.keys(evidenceItem).sort().join(",") !== "path,sha256"
    || normalizeRelativePath(evidenceItem.path) !== expectedRelativePath) {
    throw new Error(`${phase}/${checkId} must reference its canonical validation receipt`);
  }
  const receiptPath = path.join(jobRoot, expectedRelativePath);
  if (!isCanonicalFile(jobRoot, receiptPath, evidenceItem.sha256)) {
    throw new Error(`${phase}/${checkId} receipt SHA-256 mismatch or unsafe receipt path`);
  }
  const canonicalSubject = subjectRelativePath ?? resolveCanonicalSubject(jobRoot, phase, contract);
  const invocation = resolveValidationInvocation(jobRoot, phase, checkId, canonicalSubject, contracts);
  const receipt = readJson(receiptPath);
  if (!validateReceipt(jobRoot, receipt, invocation)) throw new Error(`${phase}/${checkId} validation receipt is stale or invalid`);
  return receipt;
};

export const validateSnapshotReviews = (reviews, snapshotReceipt) => {
  const snapshots = snapshotReceipt?.snapshots;
  if (!Array.isArray(reviews) || !Array.isArray(snapshots) || reviews.length !== snapshots.length) return false;
  const expected = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot.sha256]));
  const reviewed = new Set();
  for (const review of reviews) {
    if (!review || Object.keys(review).sort().join(",") !== "findings,path,sha256,status"
      || reviewed.has(review.path)
      || expected.get(review.path) !== review.sha256
      || review.status !== "pass"
      || !Array.isArray(review.findings)
      || review.findings.length !== 0) return false;
    reviewed.add(review.path);
  }
  return reviewed.size === expected.size;
};
