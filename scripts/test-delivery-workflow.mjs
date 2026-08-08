import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [fontPath] = process.argv.slice(2);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-delivery-"));
const jobRoot = path.join(temporaryRoot, "job");
const workflowPath = path.join(jobRoot, "state", "workflow.json");
const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};
const script = (name, argumentsList, options = {}) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  options
);
const writeJson = (relativePath, value) => writeJsonAtomic(path.join(jobRoot, relativePath), value);

try {
  const source = path.join(temporaryRoot, "source.mp4");
  run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "3.2", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    source
  ]);
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [jobRoot, source, "review", "subtitles"]);
  if (fontPath && path.isAbsolute(fontPath) && fs.existsSync(fontPath)) {
    fs.mkdirSync(path.join(jobRoot, "hyperframes", "assets", "fonts"), { recursive: true });
    fs.copyFileSync(fontPath, path.join(jobRoot, "hyperframes", "assets", "fonts", "smiley-sans-oblique.woff2"));
  }

  const projectPath = path.join(jobRoot, "state", "project.json");
 fs.copyFileSync(source, path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"));
 fs.copyFileSync(source, path.join(jobRoot, "roughcut", "a-roll.mp4"));

  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "transcript.example.json"),
    path.join(jobRoot, "state", "transcript.json")
  );
  const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
  const reconciliationItems = path.join(temporaryRoot, "reconciliation-items.json");
  fs.writeFileSync(reconciliationItems, JSON.stringify(transcript.segments.map((segment, index) => ({
    id: `speech-${index + 1}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: segment.confidence ?? 1,
    evidence: { audioChecked: true, supportsReference: false, note: "Runtime fixture" }
  }))));
  script("create-transcript-reconciliation.mjs", [jobRoot, "input/source.mp4", reconciliationItems]);
  script("workflow-state.mjs", [workflowPath, "advance"]);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "state/transcript.json"]);

  const workflow = readJson(workflowPath);
  workflow.currentState = "rough-cut";
  workflow.sourceTranscriptSha256 = sha256File(path.join(jobRoot, "state", "source-transcript.json"));
  workflow.gates["rough-cut-review"] = { status: "not-reached" };
  writeJsonAtomic(workflowPath, workflow);
  writeJson("state/chatcut-roughcut.json", {
    schemaVersion: "1.0.0",
    source: "chatcut",
    projectId: "runtime-project",
    timelineIds: ["runtime-timeline"],
    activeTimelineId: "runtime-timeline",
    recordedAt: new Date().toISOString()
  });
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "state/chatcut-roughcut.json"]);
  script("workflow-state.mjs", [workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Runtime caption recommendation"]);
 script("workflow-state.mjs", [workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Runtime A-axis recommendation"]);
 script("workflow-state.mjs", [workflowPath, "approve", "--actor", "user", "--note", "Approve the rough cut"]);
  const project = readJson(projectPath);
  project.mediaArtifacts = { roughcut: {
    path: "roughcut/a-roll.mp4",
    sha256: sha256File(path.join(jobRoot, "roughcut", "a-roll.mp4"))
  } };
  writeJsonAtomic(projectPath, project);
 script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "roughcut/a-roll.mp4"]);

  writeJson("state/beat-map.json", { fps: 30, duration: 3.2, captionMode: "subtitles", beats: [] });
  fs.writeFileSync(
    path.join(jobRoot, "docs", "motion-plan.md"),
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 0.0–3.2 | Runtime fixture | A | horizontal | none | caption-only | cut |\n\n"
      + "Caption mode: subtitles\n"
  );
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  assert.equal(readJson(workflowPath).currentState, "render");

  const finalPath = path.join(jobRoot, "output", "final.mp4");
  fs.copyFileSync(source, finalPath);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.mp4"]);
  let completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(completed.lastKnownGoodDelivery.path, "output/final.mp4");

  script("workflow-state.mjs", [workflowPath, "reopen", "delivery", "--actor", "user", "--note", "Retest delivery promotion"]);
  fs.copyFileSync(finalPath, path.join(jobRoot, "output", "final.candidate.mp4"));
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.candidate.mp4"]);
  completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(fs.existsSync(path.join(jobRoot, "output", "final.candidate.mp4")), false);
  assert.equal(sha256File(finalPath), completed.lastKnownGoodDelivery.sha256);

  script("workflow-state.mjs", [workflowPath, "reopen", "rough-cut", "--actor", "user", "--note", "Retest transcript lock"]);
  fs.appendFileSync(path.join(jobRoot, "state", "source-transcript.json"), "\n");
  const tampered = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath, "advance", "--artifact", "roughcut/a-roll.mp4"
  ], { encoding: "utf8" });
  assert.notEqual(tampered.status, 0);
  assert.match(`${tampered.stdout}\n${tampered.stderr}`, /Source transcript changed after its timeline lock/);

  const state = readJson(workflowPath);
  assert.deepEqual(Object.keys(state.gates), ["rough-cut-review"]);
  console.log("Delivery workflow runtime test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
