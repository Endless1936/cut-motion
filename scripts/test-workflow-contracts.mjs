import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginWorkflowRevision,
  ensureWorkflowDefaults,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-workflow-"));
const run = (command, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${command} unexpectedly passed`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`Unexpected failure:\n${output}`);
  return result;
};
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  expectSuccess,
  failurePattern
);
const scaffold = (name, ...options) => {
  const source = path.join(temporaryRoot, `${name}.mov`);
  const job = path.join(temporaryRoot, name);
  fs.writeFileSync(source, "media");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [job, source, ...options]);
  return job;
};

try {
  const simple = ensureWorkflowDefaults({
    captionMode: "subtitles",
    visualAxisMode: "a-axis-overlay",
    currentState: "motion-plan",
    revisionId: 1,
    gates: { "rough-cut-review": { status: "approved", revisionId: 1 } },
    history: []
  });
  beginWorkflowRevision(simple);
  assert.equal(simple.revisionId, 2);
  assert.equal(simple.gates["rough-cut-review"].status, "approved");
  assert.deepEqual(Object.keys(simple.gates), ["rough-cut-review"]);

  const scaffolded = scaffold("scaffold", "review", "subtitles");
  assert.equal(fs.existsSync(path.join(scaffolded, "hyperframes", "index.html")), true);
  assert.equal(readJson(path.join(scaffolded, "state", "workflow.json")).captionMode, "subtitles");
  assert.equal(fs.existsSync(path.join(scaffolded, "docs", "caption-plan.md")), true);
  const status = script("workflow-state.mjs", [
    path.join(scaffolded, "state", "workflow.json"),
    "status"
  ]);
  assert.equal(JSON.parse(status.stdout).currentState, "intake");
  run(
    path.join(repositoryRoot, "scripts", "scaffold-project.sh"),
    [scaffolded, path.join(temporaryRoot, "scaffold.mov"), "review", "subtitles"],
    false,
    /not empty/
  );

  const extensionless = path.join(temporaryRoot, "source-without-extension");
  fs.writeFileSync(extensionless, "media");
  const extensionlessJob = path.join(temporaryRoot, "extensionless");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [extensionlessJob, extensionless, "review"]);
  assert.equal(fs.existsSync(path.join(extensionlessJob, "input", "source.media")), true);

  const modeJob = scaffold("mode", "review");
  const modeWorkflow = path.join(modeJob, "state", "workflow.json");
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "motion-copy", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), false);
  assert.equal(readJson(path.join(modeJob, "state", "creative-confirmation.json")).storyboard.captionPlan, undefined);
  script("workflow-state.mjs", [modeWorkflow, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  assert.equal(readJson(path.join(modeJob, "state", "creative-confirmation.json")).visualAxisMode, "b-axis-stage");
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "subtitles", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), true);

  const autoModeJob = scaffold("auto-mode", "auto");
  const autoModeWorkflow = readJson(path.join(autoModeJob, "state", "workflow.json"));
  assert.equal(autoModeWorkflow.mode, "auto");

  const prepareChatcutReviewJob = (name, mode = "review") => {
    const job = scaffold(name, mode);
    const workflowPath = path.join(job, "state", "workflow.json");
    const workflow = readJson(workflowPath);
    const sourceTranscriptPath = path.join(job, "state", "source-transcript.json");
    writeJsonAtomic(sourceTranscriptPath, { schemaVersion: "1.0.0", revision: 1, segments: [] });
    workflow.currentState = "rough-cut";
    workflow.pendingGate = null;
    workflow.sourceTranscriptSha256 = sha256File(sourceTranscriptPath);
    workflow.authoritativeMediaPath = null;
    workflow.authoritativeMediaSha256 = null;
    workflow.gates["rough-cut-review"] = { status: "not-reached" };
    writeJsonAtomic(workflowPath, workflow);
    writeJsonAtomic(path.join(job, "state", "chatcut-roughcut.json"), {
      schemaVersion: "1.0.0",
      source: "chatcut",
      projectId: "project-test",
      timelineIds: ["timeline-front", "timeline-back"],
      activeTimelineId: "timeline-back",
      recordedAt: "2026-08-06T00:00:00.000Z"
    });
    return { job, workflowPath };
  };

  const manualReview = prepareChatcutReviewJob("chatcut-manual-review");
  const manualProjectPath = path.join(manualReview.job, "state", "project.json");
  const manualProject = readJson(manualProjectPath);
  manualProject.mediaArtifacts = {
    roughcut: {
      path: "roughcut/a-roll.mp4",
      sha256: "a".repeat(64),
      duration: 1,
      updatedAt: "2026-08-05T00:00:00.000Z"
    }
  };
  writeJsonAtomic(manualProjectPath, manualProject);
  script("workflow-state.mjs", [
    manualReview.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  let manualWorkflow = readJson(manualReview.workflowPath);
  assert.equal(manualWorkflow.currentState, "rough-cut-review");
  assert.equal(readJson(manualProjectPath).mediaArtifacts.roughcut, undefined);
  assert.equal(fs.existsSync(path.join(manualReview.job, "roughcut", "a-roll.mp4")), false);
  script("workflow-state.mjs", [manualReview.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [manualReview.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  script("workflow-state.mjs", [manualReview.workflowPath, "approve", "--actor", "user", "--note", "ChatCut timeline reviewed and approved"]);
  manualWorkflow = readJson(manualReview.workflowPath);
  assert.equal(manualWorkflow.currentState, "rough-cut-export");
  assert.equal(manualWorkflow.roughCutReviewDecision, "manual-approved");
  assert.equal(fs.existsSync(path.join(manualReview.job, "roughcut", "a-roll.mp4")), false);

  const unresolvedReference = prepareChatcutReviewJob("chatcut-unresolved-reference");
  script("workflow-state.mjs", [
    unresolvedReference.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  const unresolvedWorkflow = readJson(unresolvedReference.workflowPath);
  unresolvedWorkflow.referenceScriptStatus = "unknown";
  unresolvedWorkflow.referenceScriptAcknowledged = false;
  writeJsonAtomic(unresolvedReference.workflowPath, unresolvedWorkflow);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  script("workflow-state.mjs", [unresolvedReference.workflowPath, "approve", "--actor", "user", "--note", "Do not infer an absent reference script"], false, /reference-script|unresolved/i);

  const automaticFallback = prepareChatcutReviewJob("chatcut-automatic-fallback");
  script("workflow-state.mjs", [
    automaticFallback.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  script("workflow-state.mjs", [automaticFallback.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [automaticFallback.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  const fallback = script("workflow-state.mjs", [
    automaticFallback.workflowPath,
    "fallback-auto",
    "--actor",
    "user",
    "--note",
    "Skip manual ChatCut review"
  ]);
  assert.match(`${fallback.stdout}\n${fallback.stderr}`, /may take a long time/i);
  const fallbackWorkflow = readJson(automaticFallback.workflowPath);
  assert.equal(fallbackWorkflow.currentState, "rough-cut-export");
  assert.equal(fallbackWorkflow.roughCutReviewDecision, "automatic-fallback");
  assert.equal(fallbackWorkflow.gates["rough-cut-review"].status, "automatic-fallback");
  assert.equal(fs.existsSync(path.join(automaticFallback.job, "roughcut", "a-roll.mp4")), false);

  const automaticMode = prepareChatcutReviewJob("chatcut-auto-mode", "auto");
  script("workflow-state.mjs", [automaticMode.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Keep recording-backed captions"]);
  script("workflow-state.mjs", [automaticMode.workflowPath, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "Keep the talking head full-frame"]);
  const automaticAdvance = script("workflow-state.mjs", [
    automaticMode.workflowPath,
    "advance",
    "--artifact",
    "state/chatcut-roughcut.json"
  ]);
  assert.match(`${automaticAdvance.stdout}\n${automaticAdvance.stderr}`, /may take a long time/i);
  const automaticWorkflow = readJson(automaticMode.workflowPath);
  assert.equal(automaticWorkflow.currentState, "rough-cut-export");
  assert.equal(automaticWorkflow.roughCutReviewDecision, "automatic-fallback");
  assert.equal(automaticWorkflow.gates["rough-cut-review"].status, "automatic-fallback");
  assert.equal(fs.existsSync(path.join(automaticMode.job, "roughcut", "a-roll.mp4")), false);

  const intakeJob = scaffold("intake", "review");
  const intakeWorkflow = path.join(intakeJob, "state", "workflow.json");
  script("workflow-state.mjs", [intakeWorkflow, "advance"]);
  assert.equal(readJson(intakeWorkflow).currentState, "transcription");
  script(
    "workflow-state.mjs",
    [intakeWorkflow, "set-caption-mode", "subtitles", "--actor", "agent"],
    false,
    /require --note/
  );
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-caption-mode",
    "subtitles",
    "--actor",
    "agent",
    "--note",
    "Readable captions fit this talking-head release"
  ]);
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-axis-mode",
    "a-axis-overlay",
    "--actor",
    "agent",
    "--note",
    "No B-axis evidence was supplied"
  ]);
  assert.equal(readJson(intakeWorkflow).captionModeSource, "auto");

  const referenceJob = scaffold("reference", "review", "subtitles");
  const referenceWorkflow = path.join(referenceJob, "state", "workflow.json");
  const reference = path.join(temporaryRoot, "reference.md");
  fs.writeFileSync(reference, "参考稿【MG：关键词】\n");
  script("register-reference-script.mjs", [referenceWorkflow, "provided", reference, "--actor", "user"]);
  const registered = readJson(referenceWorkflow);
  assert.match(registered.referenceScriptPath, /^input\/reference-scripts\/[a-f0-9]{64}\.txt$/);
  const registeredAnnotations = readJson(path.join(referenceJob, "state", "reference-script-annotations.json"));
  assert.equal(registeredAnnotations.source.status, "provided");
  assert.equal(registeredAnnotations.source.path, registered.referenceScriptPath);
  assert.equal(registeredAnnotations.source.sha256, registered.referenceScriptSha256);
  fs.appendFileSync(path.join(referenceJob, registered.referenceScriptPath), "tampered");
  script("workflow-state.mjs", [referenceWorkflow, "advance"], false, /changed|hash|reference/i);

  const defaultRouteJob = scaffold("default-route", "review");
  const defaultRouteWorkflowPath = path.join(defaultRouteJob, "state", "workflow.json");
  const defaultRouteWorkflow = readJson(defaultRouteWorkflowPath);
  defaultRouteWorkflow.currentState = "motion-plan";
  defaultRouteWorkflow.captionModeAcknowledged = true;
  defaultRouteWorkflow.visualAxisModeAcknowledged = true;
  defaultRouteWorkflow.referenceScriptAcknowledged = true;
  writeJsonAtomic(defaultRouteWorkflowPath, defaultRouteWorkflow);
  fs.writeFileSync(
    path.join(defaultRouteJob, "docs", "motion-plan.md"),
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |\n"
      + "| --- | --- | --- | --- | --- | --- | --- |\n"
      + "| 0.0–1.0 | 示例 | A | horizontal | none | caption-only | cut |\n\n"
      + "Caption mode: subtitles\n"
  );
  writeJsonAtomic(path.join(defaultRouteJob, "state", "beat-map.json"), { fps: 30, captionMode: "subtitles", beats: [] });
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  let defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "composition");
  assert.deepEqual(Object.keys(defaultRouteState.gates), ["rough-cut-review"]);
  assert.equal(defaultRouteState.pendingGate, null);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "render");
  const defaultRenderPath = path.join(defaultRouteJob, "output", "final.mp4");
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=2:d=1",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", defaultRenderPath
  ]);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "output/final.mp4"]);
  defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "complete");
  assert.equal(defaultRouteState.lastKnownGoodDelivery.path, "output/final.mp4");

  const staleReceiptJob = scaffold("stale-render-receipt", "auto");
  const staleReceiptWorkflowPath = path.join(staleReceiptJob, "state", "workflow.json");
  const staleReceiptWorkflow = readJson(staleReceiptWorkflowPath);
  staleReceiptWorkflow.currentState = "render";
  writeJsonAtomic(staleReceiptWorkflowPath, staleReceiptWorkflow);
  const staleReceiptOutput = path.join(staleReceiptJob, "output", "final.mp4");
  fs.copyFileSync(defaultRenderPath, staleReceiptOutput);
  writeJsonAtomic(path.join(staleReceiptJob, "state", "render-manifest.json"), {
    contentManifestSha256: "b".repeat(64),
    totalFrames: 2,
    fps: 2,
    width: 32,
    height: 32
  });
  writeJsonAtomic(`${staleReceiptOutput}.render.json`, {
    schemaVersion: "2.0.0",
    quality: "high",
    mode: "monolithic",
    reason: "test",
    artifactSha256: "a".repeat(64),
    contentManifestSha256: "b".repeat(64),
    totalFrames: 2,
    streamSignature: {}
  });
  script(
    "workflow-state.mjs",
    [staleReceiptWorkflowPath, "advance", "--artifact", "output/final.mp4"],
    false,
    /render receipt.*SHA-256 is stale/i
  );

  for (const [scope, expectedState] of [
    ["rough-cut", "rough-cut"],
    ["motion-plan", "motion-plan"],
    ["composition", "composition"],
    ["delivery", "render"]
  ]) {
    const job = scaffold(`reopen-${scope}`, "review", "subtitles");
    const workflowPath = path.join(job, "state", "workflow.json");
    const workflow = readJson(workflowPath);
    workflow.currentState = "complete";
    workflow.completed = true;
    workflow.gates = {
      "rough-cut-review": { status: "approved", revisionId: 1 }
    };
    workflow.roughCutReviewDecision = "manual-approved";
    workflow.visualPlanSha256 = "a".repeat(64);
    workflow.compositionArtifactPath = "hyperframes/index.html";
    workflow.compositionArtifactSha256 = "b".repeat(64);
    writeJsonAtomic(workflowPath, workflow);
    script("workflow-state.mjs", [workflowPath, "reopen", scope, "--actor", "user", "--note", `revise ${scope}`]);
    const reopened = readJson(workflowPath);
    assert.equal(reopened.currentState, expectedState);
    assert.equal(reopened.completed, false);
    assert.equal(reopened.revisionId, 2);
    assert.equal(
      reopened.visualPlanSha256,
      ["rough-cut", "motion-plan"].includes(scope) ? null : "a".repeat(64)
    );
    assert.deepEqual(Object.keys(reopened.gates), ["rough-cut-review"]);
    assert.equal(
      reopened.gates["rough-cut-review"].status,
      scope === "rough-cut" ? "not-reached" : "approved"
    );
    assert.equal(
      reopened.roughCutReviewDecision,
      scope === "rough-cut" ? "pending" : "manual-approved"
    );
  }

  const transactionJob = scaffold("transaction", "review", "subtitles");
  const prepared = path.join(transactionJob, "state", "workflow.json.bad.prepared");
  fs.writeFileSync(prepared, "{}\n");
  writeJsonAtomic(path.join(transactionJob, "state", "transcript-resolution.transaction.json"), {
    id: "bad",
    files: [{
      target: "../escaped.json",
      prepared: "state/workflow.json.bad.prepared",
      sha256: sha256File(prepared)
    }]
  });
  script("workflow-state.mjs", [path.join(transactionJob, "state", "workflow.json"), "status"], false);
  assert.equal(fs.existsSync(path.join(temporaryRoot, "escaped.json")), false);

  console.log("Workflow contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
