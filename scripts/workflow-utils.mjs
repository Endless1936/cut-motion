import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

export const writeJsonAtomic = (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  const descriptor = fs.openSync(temporaryPath, "r");
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  fs.renameSync(temporaryPath, filePath);
};

export const sha256File = (filePath) => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

export const sha256Text = (value) => crypto.createHash("sha256").update(value).digest("hex");

const defaultBrowserCachePath = () => {
  const version = process.env.HYPERFRAMES_BROWSER_VERSION ?? "152.0.7928.2";
  const platform = process.platform === "darwin"
    ? (process.arch === "arm64" ? "mac_arm" : "mac")
    : process.platform === "linux"
      ? (process.arch === "arm64" ? "linux_arm" : "linux")
      : process.platform === "win32"
        ? (process.arch === "arm64" || process.arch === "x64" ? "win64" : "win32")
        : null;
  if (!platform) return null;
  const executableDirectory = platform === "mac_arm"
    ? "chrome-headless-shell-mac-arm64"
    : platform === "mac"
      ? "chrome-headless-shell-mac-x64"
      : platform === "linux_arm"
        ? (version.localeCompare("153.0.8001.0", undefined, { numeric: true }) < 0
          ? "chrome-headless-shell-linux64" : "chrome-headless-shell-linux-arm64")
        : platform === "linux"
          ? "chrome-headless-shell-linux64"
          : platform === "win64"
            ? "chrome-headless-shell-win64"
            : "chrome-headless-shell-win32";
  const executableName = platform.startsWith("win") ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const exactPath = path.join(
    os.homedir(),
    ".cache",
    "hyperframes",
    "chrome",
    "chrome-headless-shell",
    `${platform}-${version}`,
    executableDirectory,
    executableName
  );
  try {
    if (fs.statSync(exactPath).isFile()) return exactPath;
    const puppeteerRoot = path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell");
    const versions = fs.readdirSync(puppeteerRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const installedVersion of versions) {
      const candidate = path.join(puppeteerRoot, installedVersion, executableDirectory, executableName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  } catch {
    // Keep the exact HyperFrames cache path in the fingerprint when no browser is installed yet.
  }
  return exactPath;
};

export const resolveLockedHyperframesCli = (jobRootInput) => {
  const jobRoot = path.resolve(jobRootInput);
  const hyperframesRoot = path.join(jobRoot, "hyperframes");
  const declaredPackagePath = path.join(hyperframesRoot, "package.json");
  const installedPackagePath = path.join(hyperframesRoot, "node_modules", "hyperframes", "package.json");
  if (!fs.existsSync(declaredPackagePath)) throw new Error("Job HyperFrames package.json is missing");
  if (!fs.existsSync(installedPackagePath)) throw new Error("Job-local HyperFrames is not installed");

  const declaredPackage = readJson(declaredPackagePath);
  const installedPackage = readJson(installedPackagePath);
  const expectedVersion = declaredPackage.devDependencies?.hyperframes
    ?? declaredPackage.dependencies?.hyperframes;
  if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
    throw new Error("Job package.json must declare an exact HyperFrames version");
  }
  if (expectedVersion !== installedPackage.version) {
    throw new Error(`Job-local HyperFrames version mismatch: expected ${expectedVersion}, installed ${installedPackage.version ?? "unknown"}`);
  }

  const binDeclaration = installedPackage.bin;
  const binRelativePath = typeof binDeclaration === "string"
    ? binDeclaration
    : binDeclaration?.hyperframes;
  if (typeof binRelativePath !== "string" || binRelativePath.length === 0) {
    throw new Error("Installed HyperFrames package does not declare its CLI binary");
  }
  const installedPackageRoot = path.dirname(installedPackagePath);
  const expectedBinaryPath = path.resolve(installedPackageRoot, binRelativePath);
  if (!isPathInside(installedPackageRoot, expectedBinaryPath)) {
    throw new Error("Installed HyperFrames CLI declaration escapes its package");
  }
  const localBinaryPath = path.join(hyperframesRoot, "node_modules", ".bin", "hyperframes");
  const expectedBinaryStat = fs.existsSync(expectedBinaryPath) ? fs.statSync(expectedBinaryPath) : null;
  if (!expectedBinaryStat?.isFile()
    || (process.platform !== "win32" && (expectedBinaryStat.mode & 0o111) === 0)) {
    throw new Error("Installed HyperFrames CLI binary is missing");
  }
  if (!fs.existsSync(localBinaryPath)) throw new Error("Job-local HyperFrames CLI link is missing");
  const expectedBinaryRealPath = fs.realpathSync(expectedBinaryPath);
  const localBinaryRealPath = fs.realpathSync(localBinaryPath);
  if (expectedBinaryRealPath !== localBinaryRealPath) {
    throw new Error("Job-local HyperFrames CLI does not resolve to the declared package binary");
  }

  const rendererEnvironmentKeys = [
    "HYPERFRAMES_BROWSER_PATH",
    "HYPERFRAMES_BROWSER_VERSION",
    "PRODUCER_HEADLESS_SHELL_PATH",
    "PRODUCER_BROWSER_GPU_MODE",
    "PRODUCER_EXPERIMENTAL_FAST_CAPTURE",
    "PRODUCER_MAX_WORKERS",
    "PRODUCER_ENABLE_BROWSER_POOL"
  ];
  const rendererEnvironment = Object.fromEntries(
    rendererEnvironmentKeys.map((key) => [key, process.env[key] ?? null])
  );
  const browserPath = process.env.HYPERFRAMES_BROWSER_PATH
    ?? process.env.PRODUCER_HEADLESS_SHELL_PATH
    ?? defaultBrowserCachePath();
  let browserSha256 = null;
  let browserMode = null;
  if (browserPath) {
    try {
      const browserStat = fs.statSync(browserPath);
      if (browserStat.isFile()) {
        browserSha256 = sha256File(browserPath);
        browserMode = browserStat.mode & 0o7777;
      }
    } catch {
      // The renderer will report an invalid browser path; keep it in the fingerprint.
    }
  }

  return {
    binaryPath: localBinaryPath,
    version: installedPackage.version,
    fingerprint: sha256Text([
      expectedVersion,
      installedPackage.version,
      sha256File(installedPackagePath),
      sha256File(expectedBinaryRealPath),
      JSON.stringify({
        platform: process.platform,
        architecture: process.arch,
        browserPath,
        browserSha256,
        browserMode,
        rendererEnvironment
      })
    ].join(":"))
  };
};

export const jobRootForWorkflow = (workflowPath) => path.dirname(path.dirname(path.resolve(workflowPath)));

export const isPathInside = (parent, candidate) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const assertRegularContainedFile = (parent, candidate, label = "File") => {
  const parentReal = fs.realpathSync(parent);
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a non-symlink regular file`);
  const candidateReal = fs.realpathSync(candidate);
  if (!isPathInside(parentReal, candidateReal)) throw new Error(`${label} escapes its allowed directory`);
  return candidateReal;
};

export const ensureWorkflowDefaults = (workflow) => {
  workflow.roughCutReviewDecision ??= "pending";
  workflow.lastKnownGoodDelivery ??= null;
  workflow.sourceTranscriptSha256 ??= null;
  workflow.history ??= [];
  workflow.gates ??= {};
  return workflow;
};
export const computeDesignLanguageFingerprint = (jobRoot, captionMode) => {
  const confirmation = readJson(path.join(jobRoot, "state", "creative-confirmation.json"));
  const beatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  const designSystemPath = path.join(jobRoot, "state", "design-system.json");
  const designSystem = readJson(designSystemPath);
  const visualBeats = (beatMap.beats ?? []).filter((beat) => captionMode === "motion-copy" || beat.mgScope === "local");
  const uniqueGrammar = [...new Set(visualBeats.map((beat) => JSON.stringify({
    axis: beat.axis,
    motionFamily: beat.motionFamily,
    transitionFamily: beat.transitionFamily,
    primaryFlowAxis: beat.primaryFlowAxis,
    semanticTopology: beat.semanticTopology,
    revealGrammar: (beat.microEvents ?? []).map((event) => ({
      visualRole: event.visualRole,
      topologyRole: event.topologyRole
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  })))].sort();
  const highAttention = visualBeats
    .filter((beat) => beat.attentionCost === "high")
    .map((beat) => ({
      axis: beat.axis,
      motionFamily: beat.motionFamily,
      transitionFamily: beat.transitionFamily,
      primaryFlowAxis: beat.primaryFlowAxis,
      semanticTopology: beat.semanticTopology,
      supportRole: beat.supportRole,
      visualEncoding: beat.visualEncoding
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return sha256Text(JSON.stringify({
    captionMode,
    visualAxisMode: confirmation.visualAxisMode,
    designSystem: {
      canvas: designSystem.canvas,
      typography: designSystem.typography,
      palette: designSystem.palette,
      spacing: designSystem.spacing,
      density: designSystem.density,
      surface: designSystem.surface,
      motionContract: designSystem.motionContract,
      axisPolicies: designSystem.axisPolicies
    },
    uniqueGrammar,
    highAttention
  }));
};

export const beginWorkflowRevision = (workflow, { invalidateVisualPlan = true } = {}) => {
  ensureWorkflowDefaults(workflow);
  workflow.revisionId += 1;
  if (invalidateVisualPlan) workflow.visualPlanSha256 = null;
};
export const saveWorkflow = (workflowPath, workflow, now = new Date().toISOString()) => {
  workflow.completed = workflow.currentState === "complete";
  workflow.updatedAt = now;
  writeJsonAtomic(workflowPath, workflow);
};

export const validateActiveReference = (workflowPath, workflow) => {
  if (workflow.referenceScriptStatus === "none") {
    if (workflow.referenceScriptPath !== null || workflow.referenceScriptSha256 !== null) {
      throw new Error("Reference status none requires a null path and SHA-256");
    }
    return;
  }
  if (workflow.referenceScriptStatus !== "provided") throw new Error("Reference-script decision is unresolved");
  if (!workflow.referenceScriptPath || !workflow.referenceScriptSha256) {
    throw new Error("Provided reference script requires path and SHA-256");
  }
  const jobRoot = jobRootForWorkflow(workflowPath);
  const inputRoot = path.join(jobRoot, "input");
  const referencePath = path.resolve(jobRoot, workflow.referenceScriptPath);
  if (!isPathInside(inputRoot, referencePath)) throw new Error("Reference script must stay inside job input/");
  assertRegularContainedFile(inputRoot, referencePath, "Reference script");
  const actual = sha256File(referencePath);
  if (actual !== workflow.referenceScriptSha256) throw new Error("Reference script SHA-256 mismatch");
};

export const creativeAuthorityPaths = (jobRoot, captionMode) => {
  const paths = {
    transcript: "state/transcript.json",
    beatMap: "state/beat-map.json"
  };
  if (captionMode === "subtitles") paths.captionPlan = "captions/caption-review-plan.json";
  return paths;
};

export const computeCreativeAuthorities = (jobRoot, captionMode) => Object.fromEntries(
  Object.entries(creativeAuthorityPaths(jobRoot, captionMode)).map(([name, relativePath]) => {
    const absolutePath = path.join(jobRoot, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Missing creative authority: ${relativePath}`);
    return [name, { path: relativePath, sha256: sha256File(absolutePath) }];
  })
);

export const computeCreativeDocumentFingerprints = (jobRoot, captionMode) => {
  const paths = {
    creativeConfirmationDoc: "docs/creative-confirmation.md",
    motionPlan: "docs/motion-plan.md",
    ...(captionMode === "subtitles" ? { captionPlanDoc: "docs/caption-plan.md" } : {})
  };
  return Object.fromEntries(Object.entries(paths).map(([name, relativePath]) => [
    name,
    { path: relativePath, sha256: sha256File(path.join(jobRoot, relativePath)) }
  ]));
};

export const assertCreativeAuthorities = (jobRoot, workflow, { requireApproved = true } = {}) => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (!fs.existsSync(confirmationPath)) throw new Error("Creative confirmation is missing");
  const confirmation = readJson(confirmationPath);
  if (requireApproved && confirmation.review?.status !== "approved") {
    throw new Error("Creative confirmation is not approved");
  }
  if (requireApproved && (!workflow.creativeConfirmationSha256
    || sha256File(confirmationPath) !== workflow.creativeConfirmationSha256)) {
    throw new Error("Creative confirmation package drift");
  }
  if (requireApproved) {
    const documents = computeCreativeDocumentFingerprints(jobRoot, workflow.captionMode);
    for (const [name, fingerprint] of Object.entries(documents)) {
      const recorded = workflow.creativeDocumentFingerprints?.[name];
      if (recorded?.path !== fingerprint.path || recorded?.sha256 !== fingerprint.sha256) {
        throw new Error(`Creative document drift: ${name}`);
      }
    }
  }
  const expected = computeCreativeAuthorities(jobRoot, workflow.captionMode);
  for (const [name, authority] of Object.entries(expected)) {
    const recorded = confirmation.authorities?.[name];
    if (recorded?.path !== authority.path || recorded?.sha256 !== authority.sha256) {
      throw new Error(`Creative authority drift: ${name}`);
    }
  }
  return confirmation;
};

export const invalidateCreativeArtifacts = (jobRoot, note = "Dependent creative inputs changed") => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (fs.existsSync(confirmationPath)) {
    const confirmation = readJson(confirmationPath);
    confirmation.review = { status: "revision-requested", note };
    confirmation.authorities = {};
    writeJsonAtomic(confirmationPath, confirmation);
  }
  const captionPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
  if (fs.existsSync(captionPlanPath)) {
    const plan = readJson(captionPlanPath);
    plan.status = "proposed";
    delete plan.approvedAt;
    delete plan.approvalNote;
    writeJsonAtomic(captionPlanPath, plan);
  }
};

export const recoverTranscriptTransaction = (jobRoot) => {
  const journalPath = path.join(jobRoot, "state", "transcript-resolution.transaction.json");
  if (!fs.existsSync(journalPath)) return false;
  const journal = readJson(journalPath);
  const allowedTargets = new Set([
    "state/transcript.json",
    "state/transcript-reconciliation.json",
    "state/workflow.json",
    "state/creative-confirmation.json",
    "captions/caption-review-plan.json"
  ]);
  const seenTargets = new Set();
  for (const entry of journal.files ?? []) {
    if (!allowedTargets.has(entry.target) || seenTargets.has(entry.target)) {
      throw new Error(`Unsafe transcript transaction target: ${entry.target}`);
    }
    seenTargets.add(entry.target);
    if (entry.prepared !== `${entry.target}.${journal.id}.prepared`) {
      throw new Error(`Unsafe transcript transaction prepared path: ${entry.prepared}`);
    }
    const target = path.join(jobRoot, entry.target);
    const prepared = path.join(jobRoot, entry.prepared);
    if (!isPathInside(jobRoot, target) || !isPathInside(jobRoot, prepared)) throw new Error("Transcript transaction path escapes the job");
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Transcript transaction target is a symlink: ${entry.target}`);
    if (fs.existsSync(target) && sha256File(target) === entry.sha256) continue;
    if (!fs.existsSync(prepared) || fs.lstatSync(prepared).isSymbolicLink() || !fs.lstatSync(prepared).isFile() || sha256File(prepared) !== entry.sha256) {
      throw new Error(`Cannot recover transcript transaction ${journal.id}: ${entry.target}`);
    }
    fs.renameSync(prepared, target);
  }
  fs.unlinkSync(journalPath);
  return true;
};
