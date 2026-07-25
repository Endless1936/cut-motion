import path from "node:path";
import { assertCreativeAuthorities, ensureWorkflowDefaults, jobRootForWorkflow, readJson } from "./workflow-utils.mjs";

const [workflowArgument] = process.argv.slice(2);
if (!workflowArgument) {
  console.error("Usage: node check-creative-fingerprints.mjs <workflow.json>");
  process.exit(64);
}
const workflowPath = path.resolve(workflowArgument);
const workflow = ensureWorkflowDefaults(readJson(workflowPath));
assertCreativeAuthorities(jobRootForWorkflow(workflowPath), workflow);
console.log("Creative fingerprints passed.");
