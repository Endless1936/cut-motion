import fs from "node:fs";
import path from "node:path";
import {
  assertRegularContainedFile,
  ensureWorkflowDefaults,
  readJson,
  sha256File,
  validateActiveReference,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [jobArgument, mediaArgument, itemsArgument] = process.argv.slice(2);
if (!jobArgument || !mediaArgument) {
  console.error("Usage: node create-transcript-reconciliation.mjs <job-directory> <job-relative-media-path> [items.json]");
  process.exit(64);
}
const jobRoot = path.resolve(jobArgument);
const workflowPath = path.join(jobRoot, "state", "workflow.json");
const workflow = ensureWorkflowDefaults(readJson(workflowPath));
validateActiveReference(workflowPath, workflow);
const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
const mediaPath = path.resolve(jobRoot, mediaArgument);
if (!fs.existsSync(mediaPath)) throw new Error("Reconciliation media must be a regular file");
assertRegularContainedFile(jobRoot, mediaPath, "Reconciliation media");
const items = itemsArgument ? readJson(path.resolve(itemsArgument)) : [];
if (!Array.isArray(items)) throw new Error("Items file must contain a JSON array");
if (transcript.segments.length > 0 && items.length === 0) throw new Error("Transcript reconciliation requires explicit audio-reviewed items");
const reconciliation = {
  $schema: "../../../schemas/transcript-reconciliation.schema.json",
  schemaVersion: "1.0.0",
  mediaFingerprint: sha256File(mediaPath),
  transcriptRevision: transcript.revision ?? 1,
  referenceScript: {
    status: workflow.referenceScriptStatus,
    path: workflow.referenceScriptPath,
    sha256: workflow.referenceScriptSha256
  },
  items,
  verification: {
    audioChecked: items.length > 0 && items.every((item) => item.evidence?.audioChecked === true),
    mediaPath: path.relative(jobRoot, mediaPath),
    mediaFingerprintMatches: true,
    transcriptRevisionMatches: true,
    unresolvedReleaseImpactCount: items.filter((item) => item.resolution === "unresolved" && item.releaseImpact === true).length
  }
};
const outputPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
writeJsonAtomic(outputPath, reconciliation);
console.log(`Created transcript reconciliation: ${outputPath}`);
