import fs from "node:fs";
import path from "node:path";
import {
  beginWorkflowRevision,
  ensureWorkflowDefaults,
  invalidateCreativeArtifacts,
  isPathInside,
  jobRootForWorkflow,
  readJson,
  recoverTranscriptTransaction,
  saveWorkflow,
  sha256Text,
  validateActiveReference,
  writeJsonAtomic
} from "./workflow-utils.mjs";
import { buildReferenceScriptAnnotations } from "./reference-script-annotations.mjs";

const [workflowArgument, decision, ...decisionArguments] = process.argv.slice(2);
if (!workflowArgument || !["none", "provided"].includes(decision)) {
  console.error("Usage: node register-reference-script.mjs <workflow.json> <none|provided> [source-path] [--actor name] [--note text]");
  process.exit(64);
}

const sourceArgument = decision === "provided" ? decisionArguments[0] : null;
const rawOptions = decision === "provided" ? decisionArguments.slice(1) : decisionArguments;
const options = {};
for (let index = 0; index < rawOptions.length; index += 2) options[rawOptions[index]?.replace(/^--/, "")] = rawOptions[index + 1];
const actor = options.actor ?? "user";
const note = options.note ?? null;
const workflowPath = path.resolve(workflowArgument);
const jobRoot = jobRootForWorkflow(workflowPath);
recoverTranscriptTransaction(jobRoot);
const workflow = ensureWorkflowDefaults(readJson(workflowPath));
const now = new Date().toISOString();
const previous = {
  status: workflow.referenceScriptStatus,
  path: workflow.referenceScriptPath,
  sha256: workflow.referenceScriptSha256
};
let annotationState;

if (decision === "provided") {
  if (!sourceArgument) throw new Error("provided requires a source path");
  const sourcePath = fs.realpathSync(path.resolve(sourceArgument));
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) throw new Error("Reference script must be a regular file");
  const extension = path.extname(sourcePath).toLowerCase();
  if (![".txt", ".md", ".markdown"].includes(extension)) throw new Error("Reference script must be UTF-8 plain text or Markdown");
  const bytes = fs.readFileSync(sourcePath);
  if (bytes.includes(0)) throw new Error("Reference script appears to be binary");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
  const sha256 = sha256Text(text);
  const relativePath = `input/reference-scripts/${sha256}.txt`;
  annotationState = buildReferenceScriptAnnotations({
    status: "provided",
    path: relativePath,
    sha256,
    text
  });
  const destination = path.join(jobRoot, relativePath);
  const inputDirectory = path.join(jobRoot, "input");
  const referenceDirectory = path.dirname(destination);
  if (!fs.lstatSync(inputDirectory).isDirectory() || fs.lstatSync(inputDirectory).isSymbolicLink()) throw new Error("Job input must be a non-symlink directory");
  fs.mkdirSync(referenceDirectory, { recursive: true });
  const referenceDirectoryStat = fs.lstatSync(referenceDirectory);
  if (!referenceDirectoryStat.isDirectory() || referenceDirectoryStat.isSymbolicLink()
    || !isPathInside(fs.realpathSync(inputDirectory), fs.realpathSync(referenceDirectory))) {
    throw new Error("Reference-script directory must stay inside job input");
  }
  if (fs.existsSync(destination)) {
    const destinationStat = fs.lstatSync(destination);
    if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
      throw new Error("Immutable reference destination must be a non-symlink regular file");
    }
  } else {
    const temporaryPath = `${destination}.${process.pid}.tmp`;
    const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, text);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    fs.renameSync(temporaryPath, destination);
  }
  workflow.referenceScriptStatus = "provided";
  workflow.referenceScriptPath = relativePath;
  workflow.referenceScriptSha256 = sha256;
} else {
  workflow.referenceScriptStatus = "none";
  workflow.referenceScriptPath = null;
  workflow.referenceScriptSha256 = null;
  annotationState = buildReferenceScriptAnnotations({
    status: "none",
    path: null,
    sha256: null
  });
}
workflow.referenceScriptAcknowledged = true;
validateActiveReference(workflowPath, workflow);
writeJsonAtomic(path.join(jobRoot, "state", "reference-script-annotations.json"), annotationState);

const changed = previous.status !== workflow.referenceScriptStatus
  || previous.path !== workflow.referenceScriptPath
  || previous.sha256 !== workflow.referenceScriptSha256;
const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
if (fs.existsSync(confirmationPath)) {
  const confirmation = readJson(confirmationPath);
  confirmation.scriptAnnotations ??= {
    source: "state/reference-script-annotations.json",
    role: "advisory",
    exhaustiveVisualPlan: false,
    decisions: []
  };
  if (changed) confirmation.scriptAnnotations.decisions = [];
  writeJsonAtomic(confirmationPath, confirmation);
}
const previousState = workflow.currentState;
let invalidated = [];
if (changed && previousState !== "intake") {
  const existingReturnState = previousState === "transcription" ? workflow.reconciliationReturnState : null;
  const beforeRoughCutApproval = ["transcription", "rough-cut", "rough-cut-review"].includes(previousState)
    && workflow.gates?.["rough-cut-review"]?.status !== "approved";
  workflow.reconciliationReturnState = existingReturnState
    ?? (beforeRoughCutApproval ? "rough-cut" : "motion-plan");
  if (workflow.reconciliationReturnState === "rough-cut") {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    workflow.authoritativeMediaPath = project.sourceVideo;
    workflow.authoritativeMediaSha256 = null;
    workflow.trimPlanSha256 = null;
  } else if (workflow.reconciliationReturnState === "motion-plan" && !workflow.authoritativeMediaPath) {
    const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
    const trimPlan = fs.existsSync(trimPlanPath) ? readJson(trimPlanPath) : null;
    workflow.authoritativeMediaPath = trimPlan?.verification?.exportArtifact ?? "roughcut/a-roll.mp4";
  }
  workflow.currentState = "transcription";
  workflow.pendingGate = null;
  invalidated = ["transcript-reconciliation", "creative-fingerprints"];
  if (!beforeRoughCutApproval) invalidated.push("caption-plan", "beat-map", "composition");
  beginWorkflowRevision(workflow, now, "Reference script changed");
  invalidateCreativeArtifacts(jobRoot, "Reference script changed");
  workflow.creativeConfirmationSha256 = null;
  workflow.creativeDocumentFingerprints = null;
}
workflow.history.push({
  at: now,
  action: "register-reference-script",
  actor,
  from: previousState,
  to: workflow.currentState,
  artifact: workflow.referenceScriptPath,
  note,
  previousSha256: previous.sha256,
  newSha256: workflow.referenceScriptSha256,
  reconciliationReturnState: workflow.reconciliationReturnState,
  reusedApprovals: workflow.reconciliationReturnState === "motion-plan"
    ? ["rough-cut-review"]
    : [],
  invalidated
});
saveWorkflow(workflowPath, workflow, now);
console.log(`Reference script: ${workflow.referenceScriptStatus}; ${annotationState.annotations.length} visual annotation(s); current state: ${workflow.currentState}`);
