import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  beginWorkflowRevision,
  ensureWorkflowDefaults,
  jobRootForWorkflow,
  readJson,
  recoverTranscriptTransaction,
  sha256Text
} from "./workflow-utils.mjs";

const [workflowArgument, itemId, resolution, ...rawOptions] = process.argv.slice(2);
if (!workflowArgument || !itemId || !["accepted-speech", "accepted-reference", "omitted-unspoken"].includes(resolution)) {
  console.error("Usage: node resolve-transcript-item.mjs <workflow.json> <item-id> <accepted-speech|accepted-reference|omitted-unspoken> --actor name --note text");
  process.exit(64);
}
const options = {};
for (let index = 0; index < rawOptions.length; index += 2) options[rawOptions[index]?.replace(/^--/, "")] = rawOptions[index + 1];
if (!options.note) throw new Error("Resolution requires --note");
const actor = options.actor ?? "user";
const workflowPath = path.resolve(workflowArgument);
const jobRoot = jobRootForWorkflow(workflowPath);
recoverTranscriptTransaction(jobRoot);
const transcriptPath = path.join(jobRoot, "state", "transcript.json");
const reconciliationPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
const captionPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
const workflow = ensureWorkflowDefaults(readJson(workflowPath));
if (workflow.currentState !== "motion-plan") {
  throw new Error("Transcript ambiguity can only be resolved during motion planning");
}
const reconciliationCheck = spawnSync(process.execPath, [
  path.join(path.dirname(fileURLToPath(import.meta.url)), "check-transcript-reconciliation.mjs"),
  reconciliationPath,
  "--allow-review-pending"
], { encoding: "utf8" });
if (reconciliationCheck.status !== 0) {
  throw new Error(`Transcript reconciliation is stale or invalid: ${reconciliationCheck.stderr.trim() || reconciliationCheck.stdout.trim()}`);
}
const transcript = readJson(transcriptPath);
const reconciliation = readJson(reconciliationPath);
const item = reconciliation.items.find((candidate) => candidate.id === itemId);
if (!item) throw new Error(`Unknown reconciliation item: ${itemId}`);
if (item.type !== "ambiguous" || item.resolution !== "unresolved") throw new Error("Only unresolved ambiguous items can be resolved");
if (resolution === "accepted-reference" && item.evidence?.supportsReference !== true) throw new Error("Reference wording lacks audio support");

const selectedText = resolution === "accepted-reference"
  ? item.referenceText
  : resolution === "accepted-speech" ? item.heardText : "";
if (resolution !== "omitted-unspoken" && !String(selectedText ?? "").trim()) throw new Error("Selected resolution has no wording");
const segment = transcript.segments.find((candidate) => candidate.id === item.segmentId)
  ?? transcript.segments.find((candidate) => candidate.start <= item.start && candidate.end >= item.end);
if (!segment) throw new Error(`${item.id}: no transcript segment covers its acoustic span`);

const tokenize = (text) => {
  const groups = text.match(/[\p{Script=Han}]|[A-Za-z0-9]+|[^\s]/gu);
  return groups ?? [];
};
const before = (segment.words ?? []).filter((word) => word.end <= item.start);
const after = (segment.words ?? []).filter((word) => word.start >= item.end);
const tokens = tokenize(selectedText);
if (resolution !== "omitted-unspoken" && tokens.length === 0) throw new Error("Selected resolution has no renderable tokens");
const duration = Math.max(0, item.end - item.start);
const replacements = tokens.map((text, index) => ({
  id: `${segment.id}-${item.id}-${String(index + 1).padStart(3, "0")}`,
  text,
  start: Number((item.start + duration * index / tokens.length).toFixed(6)),
  end: Number((item.start + duration * (index + 1) / tokens.length).toFixed(6)),
  confidence: item.confidence
}));
segment.words = [...before, ...replacements, ...after].sort((a, b) => a.start - b.start);
segment.text = segment.words.map((word) => word.text).join("").replace(/([A-Za-z0-9])([\p{Script=Han}])/gu, "$1 $2").replace(/([\p{Script=Han}])([A-Za-z0-9])/gu, "$1 $2");
transcript.revision = (transcript.revision ?? 1) + 1;

const now = new Date().toISOString();
item.resolution = resolution;
item.decision = { actor, at: now, note: options.note };
reconciliation.transcriptRevision = transcript.revision;
reconciliation.verification.transcriptRevisionMatches = true;
reconciliation.verification.unresolvedReleaseImpactCount = reconciliation.items.filter(
  (candidate) => candidate.resolution === "unresolved" && candidate.releaseImpact === true
).length;
const previousState = workflow.currentState;
beginWorkflowRevision(workflow, now, "Transcript wording changed");
workflow.currentState = "motion-plan";
workflow.pendingGate = null;
workflow.reconciliationReturnState = null;
workflow.creativeConfirmationSha256 = null;
workflow.creativeDocumentFingerprints = null;
workflow.history.push({ at: now, action: "resolve-transcript-item", actor, from: previousState, to: "motion-plan", artifact: "state/transcript-reconciliation.json", note: options.note, itemId, resolution, revisionId: workflow.revisionId });
workflow.completed = false;
workflow.updatedAt = now;

const outputs = [
  ["state/transcript.json", transcript],
  ["state/transcript-reconciliation.json", reconciliation],
  ["state/workflow.json", workflow]
];
if (fs.existsSync(confirmationPath)) {
  const confirmation = readJson(confirmationPath);
  confirmation.review = { status: "revision-requested", note: "Transcript wording changed" };
  confirmation.authorities = {};
  outputs.push(["state/creative-confirmation.json", confirmation]);
}
if (fs.existsSync(captionPlanPath)) {
  const captionPlan = readJson(captionPlanPath);
  captionPlan.status = "proposed";
  delete captionPlan.approvedAt;
  delete captionPlan.approvalNote;
  outputs.push(["captions/caption-review-plan.json", captionPlan]);
}

const transactionId = `${Date.now()}-${process.pid}`;
const journalPath = path.join(jobRoot, "state", "transcript-resolution.transaction.json");
const files = outputs.map(([target, value]) => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const prepared = `${target}.${transactionId}.prepared`;
  const preparedPath = path.join(jobRoot, prepared);
  fs.writeFileSync(preparedPath, content);
  const descriptor = fs.openSync(preparedPath, "r");
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  return { target, prepared, sha256: sha256Text(content) };
});
const journalTemporaryPath = `${journalPath}.${transactionId}.tmp`;
fs.writeFileSync(journalTemporaryPath, `${JSON.stringify({ id: transactionId, files }, null, 2)}\n`);
const journalDescriptor = fs.openSync(journalTemporaryPath, "r");
fs.fsyncSync(journalDescriptor);
fs.closeSync(journalDescriptor);
fs.renameSync(journalTemporaryPath, journalPath);
recoverTranscriptTransaction(jobRoot);
console.log(`Resolved ${itemId}; transcript revision ${transcript.revision}; workflow returned to motion-plan.`);
