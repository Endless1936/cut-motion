import fs from "node:fs";
import path from "node:path";
import {
  assertRegularContainedFile,
  ensureWorkflowDefaults,
  jobRootForWorkflow,
  readJson,
  isPathInside,
  sha256File,
  validateActiveReference
} from "./workflow-utils.mjs";
import { buildReferenceScriptAnnotations } from "./reference-script-annotations.mjs";

const argumentsList = process.argv.slice(2);
const reconciliationArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const allowReviewPending = argumentsList.includes("--allow-review-pending");
const expectedMediaIndex = argumentsList.indexOf("--expected-media");
const expectedMediaArgument = expectedMediaIndex >= 0 ? argumentsList[expectedMediaIndex + 1] : null;
if (!reconciliationArgument) {
  console.error("Usage: node check-transcript-reconciliation.mjs <transcript-reconciliation.json> [--allow-review-pending]");
  process.exit(64);
}

const reconciliationPath = path.resolve(reconciliationArgument);
const jobRoot = path.dirname(path.dirname(reconciliationPath));
const reconciliation = readJson(reconciliationPath);
const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
const workflowPath = path.join(jobRoot, "state", "workflow.json");
const workflow = ensureWorkflowDefaults(readJson(workflowPath));
const errors = [];
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–-]/gu, "");

if (reconciliation.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
if (!/^[a-f0-9]{64}$/.test(reconciliation.mediaFingerprint ?? "")) errors.push("mediaFingerprint must be SHA-256");
if (!Number.isInteger(reconciliation.transcriptRevision) || reconciliation.transcriptRevision < 1) errors.push("transcriptRevision must be a positive integer");
const transcriptRevision = transcript.revision ?? 1;
if (reconciliation.transcriptRevision !== transcriptRevision) errors.push("transcript revision is stale");
if (reconciliation.verification?.transcriptRevisionMatches !== true) errors.push("transcriptRevisionMatches must be true");

const mediaRelativePath = reconciliation.verification?.mediaPath;
const expectedMediaPath = expectedMediaArgument ?? workflow.authoritativeMediaPath;
if (expectedMediaPath && mediaRelativePath !== expectedMediaPath) errors.push(`reconciliation must target authoritative media ${expectedMediaPath}`);
const mediaPath = mediaRelativePath ? path.resolve(jobRoot, mediaRelativePath) : null;
if (!mediaPath || !fs.existsSync(mediaPath)) {
  errors.push("reconciliation media does not exist");
} else {
  try {
    assertRegularContainedFile(jobRoot, mediaPath, "Reconciliation media");
    if (sha256File(mediaPath) !== reconciliation.mediaFingerprint) errors.push("media fingerprint is stale");
  } catch (error) {
    errors.push(error.message);
  }
}
if (reconciliation.verification?.mediaFingerprintMatches !== true) errors.push("mediaFingerprintMatches must be true");
if (reconciliation.verification?.audioChecked !== true) errors.push("audioChecked must be true");

if (reconciliation.referenceScript?.status !== workflow.referenceScriptStatus
  || reconciliation.referenceScript?.path !== workflow.referenceScriptPath
  || reconciliation.referenceScript?.sha256 !== workflow.referenceScriptSha256) {
  errors.push("reference-script snapshot does not match workflow");
}
if ((transcript.segments?.length ?? 0) > 0 && (reconciliation.items?.length ?? 0) === 0) errors.push("transcript requires explicit audio-reviewed reconciliation items");
try {
  validateActiveReference(workflowPath, workflow);
} catch (error) {
  errors.push(error.message);
}

const ids = new Set();
let unresolvedReleaseImpactCount = 0;
let previousAcousticEnd = -Infinity;
for (const item of reconciliation.items ?? []) {
  if (!item.id || ids.has(item.id)) errors.push("reconciliation item IDs must be unique");
  ids.add(item.id);
  if (!["matched", "script-only", "speech-only", "asr-correction", "ambiguous"].includes(item.type)) errors.push(`${item.id}: invalid type`);
  if (!["accepted-speech", "accepted-reference", "omitted-unspoken", "unresolved"].includes(item.resolution)) errors.push(`${item.id}: invalid resolution`);
  if (typeof item.releaseImpact !== "boolean") errors.push(`${item.id}: releaseImpact must be boolean`);
  if (!(Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1)) errors.push(`${item.id}: invalid confidence`);
  if (!(Number.isFinite(item.start) && Number.isFinite(item.end) && item.end >= item.start)) errors.push(`${item.id}: invalid acoustic span`);
  const timedSegment = transcript.segments.find((candidate) => candidate.id === item.segmentId);
  if (item.type !== "script-only") {
    if (!(item.end > item.start)) errors.push(`${item.id}: recorded speech requires a positive acoustic span`);
    if (!timedSegment) {
      errors.push(`${item.id}: recorded speech requires a valid transcript segment`);
    } else if (item.start < timedSegment.start - 0.05 || item.end > timedSegment.end + 0.05) {
      errors.push(`${item.id}: acoustic span must stay inside its transcript segment`);
    }
    if (item.start < previousAcousticEnd - 0.001) errors.push(`${item.id}: acoustic spans must be ordered and non-overlapping`);
    previousAcousticEnd = Math.max(previousAcousticEnd, item.end);
  }
  if (item.evidence?.audioChecked !== true || typeof item.evidence?.note !== "string" || !item.evidence.note.trim()) {
    errors.push(`${item.id}: acoustic evidence is required`);
  }
  if (item.type === "script-only" && item.resolution === "accepted-reference") errors.push(`${item.id}: unspoken script text cannot be accepted`);
  if (item.type === "script-only" && item.resolution !== "omitted-unspoken") errors.push(`${item.id}: script-only text must be omitted-unspoken`);
  if (item.type === "speech-only" && item.resolution !== "accepted-speech") errors.push(`${item.id}: speech-only text must be accepted-speech`);
  if (item.type !== "ambiguous" && item.resolution === "unresolved") errors.push(`${item.id}: only ambiguous items may remain unresolved`);
  if (item.resolution === "accepted-speech" && !normalize(item.heardText)) errors.push(`${item.id}: accepted speech requires heardText`);
  if (item.resolution === "accepted-reference" && !normalize(item.referenceText)) errors.push(`${item.id}: accepted reference requires referenceText`);
  if (item.resolution === "omitted-unspoken" && !["script-only", "ambiguous"].includes(item.type)) errors.push(`${item.id}: only script-only or user-resolved ambiguous text may be omitted`);
  if (item.resolution === "accepted-reference" && item.evidence?.supportsReference !== true) {
    errors.push(`${item.id}: reference wording lacks audio support`);
  }
  if (["accepted-speech", "accepted-reference"].includes(item.resolution)) {
    const selected = item.resolution === "accepted-speech" ? item.heardText : item.referenceText;
    const segment = timedSegment
      ?? transcript.segments.find((candidate) => candidate.start <= item.start && candidate.end >= item.end);
    if (!segment || !normalize(segment.text).includes(normalize(selected))) {
      errors.push(`${item.id}: accepted wording is not present in the reconciled transcript span`);
    }
  }
  if (item.resolution === "unresolved" && item.releaseImpact === true) unresolvedReleaseImpactCount += 1;
}
const classifiedSpeech = (reconciliation.items ?? []).map((item) => item.heardText ?? "").join("");
const transcriptText = transcript.segments.map((segment) => segment.text).join("");
if (normalize(classifiedSpeech) !== normalize(transcriptText)) errors.push("recorded speech is not exhaustively classified");
if (workflow.referenceScriptStatus === "provided") {
  const referenceText = fs.readFileSync(path.resolve(jobRoot, workflow.referenceScriptPath), "utf8");
  const expectedAnnotations = buildReferenceScriptAnnotations({
    status: "provided",
    path: workflow.referenceScriptPath,
    sha256: workflow.referenceScriptSha256,
    text: referenceText
  });
  const annotationsPath = path.join(jobRoot, "state", "reference-script-annotations.json");
  if (!fs.existsSync(annotationsPath)) {
    errors.push("reference-script visual annotations are missing; register the reference script again");
  } else {
    const actualAnnotations = readJson(annotationsPath);
    if (JSON.stringify(actualAnnotations) !== JSON.stringify(expectedAnnotations)) {
      errors.push("reference-script visual annotations are stale or do not match the immutable source");
    }
  }
  const classifiedReference = (reconciliation.items ?? []).map((item) => item.referenceText ?? "").join("");
  if (normalize(classifiedReference) !== normalize(expectedAnnotations.speechText)) {
    errors.push("reference-script spoken text is not exhaustively classified");
  }
}
if (reconciliation.verification?.unresolvedReleaseImpactCount !== unresolvedReleaseImpactCount) {
  errors.push("unresolved release-impact count is stale");
}
if (!allowReviewPending && unresolvedReleaseImpactCount > 0) {
  errors.push(`${unresolvedReleaseImpactCount} release-impact item(s) remain unresolved`);
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length) process.exit(1);
console.log(`Transcript reconciliation passed: ${reconciliation.items?.length ?? 0} item(s).`);
