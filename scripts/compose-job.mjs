#!/usr/bin/env node
// Run after the plan package is approved in Review mode, or after plan generation in explicitly selected Auto mode.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readJson } from "./workflow-utils.mjs";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";

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
const beatMap = readJson(path.join(root, "state", "beat-map.json"));
const modules = beatMap.beats.filter(beat => ["fragment.html", "style.css", "timeline.mjs"].every(file =>
  fs.existsSync(path.join(root, "hyperframes", "mg", beat.id, file))));
const wordsById = modules.length ? transcriptWordsById(readJson(path.join(root, "state", "transcript.json"))) : new Map();
const fps = Number(beatMap.fps);
const snapshotTimes = [...new Set(modules.map(beat => {
  const window = resolveBeatRenderWindow(beat, beatMap, wordsById);
  // Inspect the fully expanded card immediately before its exit begins.
  const frame = Math.min(Math.ceil(window.exitStartTime * fps) - 1, Math.ceil(window.end * fps) - 1);
  return Number((Math.max(window.start, frame / fps)).toFixed(6));
}))].sort((left, right) => left - right);
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
console.log(`Composition ready: ${path.join(root, "hyperframes", "index.html")}`);
if (snapshotTimes.length) {
  console.log(`Inspect ${snapshotTimes.length} MG final states in one batch from ${path.join(root, "hyperframes")}:`);
  console.log(`./node_modules/.bin/hyperframes snapshot --at ${snapshotTimes.join(",")} --no-end --describe false --output ../previews/mg-final-state`);
}
console.log(`After inspecting${snapshotTimes.length ? " the MG snapshots" : " the composition"}, render once: npm --prefix ${shellQuote(path.join(root, "hyperframes"))} run render`);
console.log(`Delivery: ${path.join(root, "output", "final.mp4")}`);
