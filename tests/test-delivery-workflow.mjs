import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, sha256File, writeJsonAtomic } from "../scripts/workflow-utils.mjs";

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
  const jobPackage = readJson(path.join(jobRoot, "hyperframes", "package.json"));
  assert.equal(jobPackage.scripts["render:revision"], "npm run render");
  if (fontPath && path.isAbsolute(fontPath) && fs.existsSync(fontPath)) {
    fs.mkdirSync(path.join(jobRoot, "hyperframes", "assets", "fonts"), { recursive: true });
    fs.copyFileSync(fontPath, path.join(jobRoot, "hyperframes", "assets", "fonts", "smiley-sans-oblique.woff2"));
  }

  const projectPath = path.join(jobRoot, "state", "project.json");
 fs.copyFileSync(source, path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"));
 fs.copyFileSync(source, path.join(jobRoot, "roughcut", "a-roll.mp4"));

  fs.copyFileSync(
    path.join(repositoryRoot, "tests", "fixtures", "transcript.json"),
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
    evidence: { supportsReference: false }
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

  writeJson("state/chatcut-main-timeline.json", {
    state: { id: "runtime-timeline", fps: 30, durationFrames: 96 },
    transcript: { coverage: { status: "complete", candidateItemCount: 2, coveredItemCount: 2, missingItemIds: [] },
      entries: transcript.segments.map((segment, index) => ({
      itemId: `runtime-item-${index + 1}`, text: segment.text,
      timelineRange: { fromFrame: Math.round(segment.start * 30), toFrame: Math.round(segment.end * 30) }
    })) }
  });
  writeJson("state/planning-inputs.json", { scenes: [{ id: "intro", start: 0, end: 3.2 }],
    beats: [{ id: "b01-effects", sceneId: "intro", sourceSegmentIds: ["main-001"], text: "看看这些特效",
      start: 0, end: 1.5, intent: "强调演示", templateId: "annotation", onScreenCopy: ["特效示例"],
      entryAnchorWordId: "main-001:word-001", exitAnchorWordId: "main-001:word-001",
      exitAnchorOffsetFrames: 0, exitFrames: 6, entranceFrames: 6,
      viewerQuestion: "展示什么", supportRole: "clarification", removalLoss: "缺少特效演示标注",
      visualEncoding: "单条标注", stillFrameValue: "暂停仍可读", attentionCost: "low" }],
    documents: { globalDirection: ["Runtime fixture"], rhythmNotes: [], openQuestions: [] }
  });
  script("generate-plan.mjs", [jobRoot, "--write", "--replace-existing"]);
  assert.equal(fs.existsSync(path.join(jobRoot, "state/motion-index.json")), false);
  const composeSummary = script("compose-job.mjs", [jobRoot]);
  assert.equal(fs.existsSync(path.join(jobRoot, "state/motion-index.json")), false);
  const assembly = readJson(path.join(jobRoot, "state/mg-assembly.json"));
  assert.ok(assembly.files["hyperframes/mg/b01-effects/fragment.html"]);
  assert.match(fs.readFileSync(path.join(jobRoot, "hyperframes/index.html"), "utf8"), /data-mg-beat-id="b01-effects"/);
  assert.match(composeSummary, /snapshot --at 1\.466667 --no-end --describe false --output/);
  assert.ok(composeSummary.includes(`npm --prefix '${path.join(jobRoot, "hyperframes")}' run render`));
  assert.equal(readJson(workflowPath).currentState, "render");

  const finalPath = path.join(jobRoot, "output", "final.mp4");
  fs.copyFileSync(source, finalPath);
  assert.match(script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.mp4"]), /Final delivery: output\/final\.mp4/);
  let completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(completed.lastKnownGoodDelivery.path, "output/final.mp4");

  const firstDeliveryHash = completed.lastKnownGoodDelivery.sha256;
  script("workflow-state.mjs", [workflowPath, "reopen", "delivery", "--actor", "user", "--note", "Retest direct final delivery"]);
  run("ffmpeg", ["-v", "error", "-y", "-i", source, "-c", "copy", "-metadata", "comment=delivery revision", finalPath]);
  assert.notEqual(sha256File(finalPath), firstDeliveryHash);
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "output/final.mp4"]);
  completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(completed.lastKnownGoodDelivery.path, "output/final.mp4");
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
