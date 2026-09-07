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

const prepareCaptionPlan = (job, axisMode = "a-axis-overlay") => {
  const transcriptPath = path.join(job, "state", "transcript.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), transcriptPath);
  const transcript = readJson(transcriptPath);
  const plan = readJson(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"));
  plan.status = "approved";
  plan.transcriptSha256 = sha256File(transcriptPath);
  writeJsonAtomic(path.join(job, "captions", "caption-review-plan.json"), plan);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "chatcut-caption-pages.example.json"), path.join(job, "captions", "chatcut-pages.json"));
  const beats = transcript.segments.map((segment, index) => ({
    id: `caption-beat-${index + 1}`, start: segment.start, end: segment.end,
    text: segment.text, audioAnchorTime: segment.start, sourceSegmentIds: [segment.id],
    axis: axisMode === "b-axis-stage" || (axisMode === "hybrid" && index === 1) ? "B" : "A",
    axisException: "Short synthetic regression fixture", sceneId: "caption-scene",
    mgScope: "none", recipe: "caption-only", components: [], microEvents: []
  }));
  writeJsonAtomic(path.join(job, "state", "beat-map.json"), { fps: 30, captionMode: "subtitles", beats });
  fs.writeFileSync(path.join(job, "docs", "motion-plan.md"), "Caption mode: subtitles\n| Time | Text |\n| --- | --- |\n"
    + beats.map((beat) => `| ${beat.start} | ${beat.text} |`).join("\n"));
  fs.appendFileSync(path.join(job, "docs", "caption-plan.md"), "\n" + plan.cues.map((cue) => `| ${cue.id} | ${cue.text} |`).join("\n"));
  const workflow = readJson(path.join(job, "state", "workflow.json"));
  const confirmationPath = path.join(job, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.captionModeDecision = { status: "acknowledged", source: workflow.captionModeSource };
  confirmation.visualAxisMode = axisMode;
  confirmation.visualAxisModeDecision = { status: "acknowledged", source: workflow.visualAxisModeSource };
  confirmation.storyboard.beatCount = beats.length;
  confirmation.review.status = "ready";
  writeJsonAtomic(confirmationPath, confirmation);
  const reconciliation = readJson(path.join(job, "state", "transcript-reconciliation.json"));
  reconciliation.mediaFingerprint = sha256File(path.join(job, "input", "source.mov"));
  reconciliation.verification = { ...reconciliation.verification, audioChecked: true, mediaFingerprintMatches: true, transcriptRevisionMatches: true };
  reconciliation.items = transcript.segments.map((segment) => ({
    id: `reconcile-${segment.id}`, segmentId: segment.id, type: "speech-only", resolution: "accepted-speech",
    start: segment.start, end: segment.end, heardText: segment.text, confidence: 1, releaseImpact: false,
    evidence: { audioChecked: true, note: "Synthetic fixture wording" }
  }));
  writeJsonAtomic(path.join(job, "state", "transcript-reconciliation.json"), reconciliation);
  return plan;
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
  const settledPlan = prepareCaptionPlan(defaultRouteJob);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  let defaultRouteState = readJson(defaultRouteWorkflowPath);
  assert.equal(defaultRouteState.currentState, "composition");
  assert.deepEqual(Object.keys(defaultRouteState.gates), ["rough-cut-review"]);
  assert.equal(defaultRouteState.pendingGate, null);
  assert.equal(defaultRouteState.creativeConfirmationSha256, null);
  script("promote-caption-review-plan.mjs", [defaultRouteJob]);
  const promotedPath = path.join(defaultRouteJob, "captions", "captions.json");
  const promoted = fs.readFileSync(promotedPath, "utf8");
  const planPath = path.join(defaultRouteJob, "captions", "caption-review-plan.json");
  for (const [mutate, failure] of [
    [(plan) => { plan.status = "proposed"; }, /must be approved/],
    [(plan) => { plan.transcriptSha256 = "0".repeat(64); }, /fingerprint is stale/],
    [(plan) => { plan.cues.pop(); }, /complete transcript|preserve/],
    [(plan) => { plan.cues[0].text = "错误字幕内容"; }, /preserve|does not match/],
    [(plan) => { plan.cues[1].start = 1; }, /overlap/]
  ]) {
    const invalid = structuredClone(settledPlan);
    mutate(invalid);
    writeJsonAtomic(planPath, invalid);
    script("promote-caption-review-plan.mjs", [defaultRouteJob], false, failure);
    assert.equal(fs.readFileSync(promotedPath, "utf8"), promoted, "failed promotion preserves released captions");
  }
  writeJsonAtomic(planPath, settledPlan);
  const pagesPath = path.join(defaultRouteJob, "captions", "chatcut-pages.json");
  const lockedPages = readJson(pagesPath);
  writeJsonAtomic(pagesPath, { ...lockedPages, captionRenderDisabled: false });
  script("promote-caption-review-plan.mjs", [defaultRouteJob], false, /timing evidence is not locked/);
  assert.equal(fs.readFileSync(promotedPath, "utf8"), promoted);
  writeJsonAtomic(pagesPath, { ...lockedPages, fps: 0 });
  script("promote-caption-review-plan.mjs", [defaultRouteJob], false, /fps must be positive/);
  assert.equal(fs.readFileSync(promotedPath, "utf8"), promoted);
  assert.equal(fs.readdirSync(path.dirname(promotedPath)).some((name) => name.startsWith(".captions-")), false);
  writeJsonAtomic(pagesPath, lockedPages);
  script("install-captions.mjs", [promotedPath, path.join(defaultRouteJob, "hyperframes", "index.html"), path.join(defaultRouteJob, "state", "design-system.json")]);
  script("workflow-state.mjs", [defaultRouteWorkflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  script("check-captions.mjs", [promotedPath, pagesPath, path.join(defaultRouteJob, "state", "design-system.json"), path.join(defaultRouteJob, "hyperframes", "index.html")]);
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

  for (const [axisMode, mode] of [["b-axis-stage", "auto"], ["hybrid", "review"]]) {
    const fixture = prepareChatcutReviewJob(`accepted-${axisMode}`, mode);
    script("workflow-state.mjs", [fixture.workflowPath, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Caption fixture"]);
    script("workflow-state.mjs", [fixture.workflowPath, "set-axis-mode", axisMode, "--actor", "agent", "--note", "Recorded B-axis recommendation"]);
    script("workflow-state.mjs", [fixture.workflowPath, "advance", "--artifact", "state/chatcut-roughcut.json"]);
    if (mode === "review") script("workflow-state.mjs", [fixture.workflowPath, "fallback-auto", "--actor", "user", "--note", "Explicit automatic fallback"]);
    const state = readJson(fixture.workflowPath);
    assert.equal(state.visualAxisModeSource, "auto");
    assert.equal(state.visualAxisModeAcknowledged, true);
    // Supply the locked-edit planning inputs; no real media export is needed for these regressions.
    state.currentState = "motion-plan";
    writeJsonAtomic(fixture.workflowPath, state);
    prepareCaptionPlan(fixture.job, axisMode);
    const advance = [fixture.workflowPath, "advance", "--artifact", "docs/motion-plan.md"];
    writeJsonAtomic(fixture.workflowPath, { ...state, visualAxisModeAcknowledged: false });
    script("workflow-state.mjs", advance, false, /preferences accepted/);
    writeJsonAtomic(fixture.workflowPath, { ...state, visualAxisModeSource: "default" });
    script("workflow-state.mjs", advance, false, /accepted user or authorized automatic decision/);
    writeJsonAtomic(fixture.workflowPath, state);
    const reconciliationPath = path.join(fixture.job, "state", "transcript-reconciliation.json");
    const reconciliation = readJson(reconciliationPath);
    writeJsonAtomic(reconciliationPath, { ...reconciliation, verification: { ...reconciliation.verification, audioChecked: false } });
    script("workflow-state.mjs", advance, false, /audioChecked must be true/);
    writeJsonAtomic(reconciliationPath, reconciliation);
    script("workflow-state.mjs", advance);
    const approved = readJson(fixture.workflowPath);
    assert.equal(approved.currentState, "composition");
    assert.equal(approved.pendingGate, null);
    const approvedPlanPath = path.join(fixture.job, "captions", "caption-review-plan.json");
    const planHash = sha256File(approvedPlanPath);
    script("promote-caption-review-plan.mjs", [fixture.job]);
    assert.equal(sha256File(approvedPlanPath), planHash, "promotion must not drift the approved plan hash");
    assert.equal(sha256File(path.join(fixture.job, "state", "creative-confirmation.json")), approved.creativeConfirmationSha256);
    const driftedPlan = readJson(approvedPlanPath);
    driftedPlan.approvalNote += " changed";
    writeJsonAtomic(approvedPlanPath, driftedPlan);
    script("promote-caption-review-plan.mjs", [fixture.job], false, /Creative authority drift/);
  }

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
