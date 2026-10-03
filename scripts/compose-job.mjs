#!/usr/bin/env node
// Run after the plan package is approved in Review mode, or after plan generation in explicitly selected Auto mode.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readJson } from "./workflow-utils.mjs";

const [job, ...extra] = process.argv.slice(2);
if (!job || extra.length) {
  console.error("Usage: node scripts/compose-job.mjs <job-directory>");
  process.exit(64);
}
const root = path.resolve(job);
const workflowPath = path.join(root, "state", "workflow.json");
const directory = path.dirname(fileURLToPath(import.meta.url));
const run = (script, args) => {
  const result = spawnSync(process.execPath, [path.join(directory, script), ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
let workflow = readJson(workflowPath);
if (!["motion-plan", "composition"].includes(workflow.currentState)) throw new Error("Compose after generating plans, or reopen composition for a revision");
if (workflow.currentState === "motion-plan") {
  run("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  workflow = readJson(workflowPath);
}
run("assemble-mg.mjs", [root, "--write"]);
if (workflow.captionMode === "subtitles") {
  run("promote-caption-review-plan.mjs", [root]);
  run("install-captions.mjs", [
    path.join(root, "captions", "captions.json"), path.join(root, "hyperframes", "index.html"),
    path.join(root, "state", "design-system.json"), "--defer-build"
  ]);
}
// The transition rebuilds once and binds the actual output for rendering.
run("workflow-state.mjs", [workflowPath, "advance", "--artifact", "hyperframes/index.html"]);
console.log("Composition ready. Run npm run render from the job's hyperframes directory (render:revision for a delivery revision).");
