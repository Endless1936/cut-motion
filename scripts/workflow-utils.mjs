import crypto from "node:crypto";
import fs from "node:fs";
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
  const legacyIntakeMissing = workflow.referenceScriptStatus == null
    || workflow.referenceScriptAcknowledged == null;
  workflow.captionModeSource ??= "default";
  workflow.captionModeAcknowledged ??= false;
  workflow.visualAxisMode ??= "a-axis-overlay";
  workflow.visualAxisModeSource ??= "default";
  workflow.visualAxisModeAcknowledged ??= false;
  workflow.referenceScriptStatus ??= "unknown";
  workflow.referenceScriptAcknowledged ??= false;
  workflow.referenceScriptPath ??= null;
  workflow.referenceScriptSha256 ??= null;
  workflow.reconciliationReturnState ??= null;
  workflow.creativeConfirmationSha256 ??= null;
  workflow.pendingCreativePackageSha256 ??= null;
  workflow.creativeDocumentFingerprints ??= null;
  workflow.authoritativeMediaPath ??= null;
  workflow.authoritativeMediaSha256 ??= null;
  workflow.trimPlanSha256 ??= null;
  workflow.visualPlanSha256 ??= null;
  workflow.compositionArtifactPath ??= null;
  workflow.compositionArtifactSha256 ??= null;
  workflow.lastKnownGoodDelivery ??= null;
  workflow.history ??= [];
  const legacyRevisionCount = workflow.history.filter((entry) => entry.revisionId == null && (
    ["replan", "resolve-transcript-item"].includes(entry.action)
    || (["set-caption-mode", "set-axis-mode"].includes(entry.action) && entry.from !== entry.to)
    || (entry.action === "revise" && ["rough-cut-review", "motion-plan-review"].includes(entry.from))
    || (entry.action === "register-reference-script" && entry.from !== "intake" && entry.to === "transcription")
  )).length;
  if (workflow.revisionId == null || (workflow.revisionId === 1 && legacyRevisionCount > 0)) {
    workflow.revisionId = 1 + legacyRevisionCount;
  }
  workflow.approvedVisualSampleFingerprint ??= null;
  for (const legacyField of ["gateHistory", "creativeReviewRequested", "creativeReviewRequired", "creativeReviewReasons", "visualSampleRequested", "visualSampleRequired", "visualSampleReasons", "pendingVisualSampleFingerprint"]) delete workflow[legacyField];
  workflow.intakeDecisionBlock ??= legacyIntakeMissing && workflow.currentState !== "intake";
  workflow.gates ??= {};
  if (workflow.pendingGate && workflow.gates[workflow.pendingGate]) {
    workflow.gates[workflow.pendingGate].revisionId ??= workflow.revisionId;
  }
  return workflow;
};

export const computeVisualSampleFingerprint = (jobRoot, captionMode) => {
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
    revealGroups: (beat.microEvents ?? []).map((event) => ({
      visualRole: event.visualRole,
      topologyRole: event.topologyRole
    })),
    visualStyle: beat.visualStyle,
    typography: beat.typography,
    visualReference: beat.visualReference
  })))].sort();
  const highAttention = visualBeats
    .filter((beat) => beat.attentionCost === "high")
    .map((beat) => ({
      axis: beat.axis,
      motionFamily: beat.motionFamily,
      transitionFamily: beat.transitionFamily,
      primaryFlowAxis: beat.primaryFlowAxis,
      semanticTopology: beat.semanticTopology,
      visualStyle: beat.visualStyle,
      typography: beat.typography,
      visualEncoding: beat.visualEncoding,
      visualReference: beat.visualReference
    }));
  return sha256Text(JSON.stringify({
    captionMode,
    visualAxisMode: confirmation.visualAxisMode,
    visualSample: confirmation.visualSample,
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

export const beginWorkflowRevision = (workflow, now, reason, options = {}) => {
  ensureWorkflowDefaults(workflow);
  const gates = options.gates ?? ["motion-plan-review", "visual-sample-review", "final-preview"];
  const superseded = [];
  for (const gate of gates) {
    const record = workflow.gates?.[gate];
    if (!record || ["not-reached", "superseded"].includes(record.status)) continue;
    superseded.push({ gate, status: record.status, artifact: record.artifact ?? null });
    workflow.gates[gate] = {
      ...record,
      previousStatus: record.status,
      status: "superseded",
      supersededAt: now,
      supersededByRevision: workflow.revisionId + 1,
      note: reason
    };
  }
  if (superseded.length > 0) {
    workflow.history.push({ at: now, action: "supersede-gates", actor: "agent", from: workflow.currentState, to: workflow.currentState, note: reason, revisionId: workflow.revisionId, gates: superseded });
  }
  workflow.revisionId += 1;
  if (options.invalidateVisualPlan !== false) workflow.visualPlanSha256 = null;
};

export const intakeResolved = (workflow) => workflow.captionModeAcknowledged === true
  && workflow.referenceScriptAcknowledged === true
  && ["none", "provided"].includes(workflow.referenceScriptStatus);

export const refreshIntakeBlock = (workflow) => {
  workflow.intakeDecisionBlock = workflow.currentState === "intake" ? false : !intakeResolved(workflow);
};

export const mirrorWorkflowToProject = (workflowPath, workflow) => {
  const projectPath = path.join(path.dirname(workflowPath), "project.json");
  if (!fs.existsSync(projectPath)) return;
  const project = readJson(projectPath);
  for (const field of [
    "mode",
    "captionMode",
    "captionModeSource",
    "captionModeAcknowledged",
    "visualAxisMode",
    "visualAxisModeSource",
    "visualAxisModeAcknowledged",
    "referenceScriptStatus",
    "referenceScriptAcknowledged",
    "referenceScriptPath",
    "referenceScriptSha256",
    "intakeDecisionBlock",
    "authoritativeMediaPath",
    "authoritativeMediaSha256",
    "revisionId",
    "lastKnownGoodDelivery"
  ]) project[field] = workflow[field];
  project.status = workflow.currentState;
  writeJsonAtomic(projectPath, project);
};

export const saveWorkflow = (workflowPath, workflow, now = new Date().toISOString()) => {
  workflow.completed = workflow.currentState === "complete";
  workflow.updatedAt = now;
  writeJsonAtomic(workflowPath, workflow);
  mirrorWorkflowToProject(workflowPath, workflow);
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

export const computePendingCreativePackageSha256 = (jobRoot, captionMode) => {
  const parts = [
    sha256File(path.join(jobRoot, "state", "creative-confirmation.json")),
    ...Object.values(computeCreativeDocumentFingerprints(jobRoot, captionMode)).map((entry) => entry.sha256)
  ];
  return sha256Text(parts.join(":"));
};

export const computeValidationBundleSha256 = (jobRoot, phase, subjectRelativePath, captionMode) => {
  const relativePaths = new Set([
    subjectRelativePath,
    "state/design-system.json",
    "state/beat-map.json",
    "state/transcript.json",
    "state/transcript-reconciliation.json",
    "state/trim-plan.json"
  ]);
  if (captionMode === "subtitles") {
    for (const relativePath of [
      "captions/caption-review-plan.json",
      "captions/chatcut-pages.json",
      "captions/captions.json"
    ]) {
      if (fs.existsSync(path.join(jobRoot, relativePath))) relativePaths.add(relativePath);
    }
  }
  const hyperframesRoot = path.join(jobRoot, "hyperframes");
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".hyperframes", "snapshots"].includes(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && !entry.isSymbolicLink()) relativePaths.add(path.relative(jobRoot, absolutePath));
    }
  };
  if (fs.existsSync(hyperframesRoot)) visit(hyperframesRoot);
  const fingerprints = [...relativePaths].sort().map((relativePath) => {
    const absolutePath = path.join(jobRoot, relativePath);
    assertRegularContainedFile(jobRoot, absolutePath, `${phase} validation input`);
    return `${relativePath}:${sha256File(absolutePath)}`;
  });
  return sha256Text(fingerprints.join("\n"));
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
  const workflowPath = path.join(jobRoot, "state", "workflow.json");
  if (fs.existsSync(workflowPath)) mirrorWorkflowToProject(workflowPath, ensureWorkflowDefaults(readJson(workflowPath)));
  return true;
};
