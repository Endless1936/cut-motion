import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertCreativeAuthorities,
  beginWorkflowRevision,
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  computePendingCreativePackageSha256,
  computeVisualSampleFingerprint,
  ensureWorkflowDefaults,
  readJson,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-workflow-"));
const run = (command, argumentsList, expectSuccess = true, expectedFailure = null) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  if (expectSuccess && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (!expectSuccess && result.status === 0) throw new Error(`Unexpected success: ${command} ${argumentsList.join(" ")}`);
  if (!expectSuccess && expectedFailure && !expectedFailure.test(`${result.stderr}\n${result.stdout}`)) {
    throw new Error(`Unexpected failure reason for ${command} ${argumentsList.join(" ")}:\n${result.stderr || result.stdout}`);
  }
  return result;
};
const nodeScript = (name, argumentsList, expectSuccess = true, expectedFailure = null) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  expectSuccess,
  expectedFailure
);
const scaffold = (name, explicitCaption = false) => {
  const job = path.join(temporaryRoot, name);
  const source = path.join(temporaryRoot, `${name}.mov`);
  fs.writeFileSync(source, "media");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [job, source, "review", ...(explicitCaption ? ["subtitles"] : [])]);
  return job;
};
const writeSpeechOnlyItems = (job, name, transform = (items) => items) => {
  const transcript = readJson(path.join(job, "state", "transcript.json"));
  const items = transcript.segments.map((segment, index) => ({
    id: `speech-${String(index + 1).padStart(3, "0")}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: segment.confidence ?? 1,
    evidence: { audioChecked: true, supportsReference: false, note: "Audio reviewed against this segment" }
  }));
  const output = path.join(temporaryRoot, `${name}.json`);
  fs.writeFileSync(output, `${JSON.stringify(transform(items), null, 2)}\n`);
  return output;
};

try {
  const simpleWorkflow = ensureWorkflowDefaults({
    captionMode: "subtitles",
    visualAxisMode: "a-axis-overlay",
    currentState: "motion-plan",
    gates: {},
    history: []
  });
  simpleWorkflow.gates["visual-sample-review"] = { status: "approved", revisionId: 1 };
  beginWorkflowRevision(simpleWorkflow, "2026-07-25T00:00:00.000Z", "test replan");
  assert.equal(simpleWorkflow.revisionId, 2);
  assert.equal(simpleWorkflow.gates["visual-sample-review"].status, "superseded");
  assert.equal(simpleWorkflow.history.at(-1).action, "supersede-gates");

  for (const [scope, expectedState, supersededGates] of [
    ["rough-cut", "rough-cut", ["rough-cut-review", "motion-plan-review", "visual-sample-review", "final-preview"]],
    ["motion-plan", "motion-plan", ["motion-plan-review", "visual-sample-review", "final-preview"]],
    ["composition", "composition", ["final-preview"]],
    ["delivery", "render", []]
  ]) {
    const reopenJob = scaffold(`reopen-${scope}`, true);
    const reopenWorkflowPath = path.join(reopenJob, "state", "workflow.json");
    const reopenWorkflow = readJson(reopenWorkflowPath);
    reopenWorkflow.currentState = "complete";
    reopenWorkflow.completed = true;
    reopenWorkflow.referenceScriptStatus = "none";
    reopenWorkflow.referenceScriptAcknowledged = true;
    reopenWorkflow.gates["rough-cut-review"] = { status: "approved", revisionId: 1 };
    reopenWorkflow.gates["motion-plan-review"] = { status: "approved", revisionId: 1 };
    reopenWorkflow.gates["visual-sample-review"] = { status: "approved", revisionId: 1 };
    reopenWorkflow.gates["final-preview"] = { status: "approved", revisionId: 1 };
    reopenWorkflow.visualPlanSha256 = "a".repeat(64);
    reopenWorkflow.compositionArtifactPath = "hyperframes/index.html";
    reopenWorkflow.compositionArtifactSha256 = "b".repeat(64);
    writeJsonAtomic(reopenWorkflowPath, reopenWorkflow);
    nodeScript("workflow-state.mjs", [reopenWorkflowPath, "reopen", scope, "--actor", "user", "--note", `revise ${scope}`]);
    const reopened = readJson(reopenWorkflowPath);
    assert.equal(reopened.currentState, expectedState);
    assert.equal(reopened.completed, false);
    assert.equal(reopened.revisionId, 2);
    for (const gate of ["rough-cut-review", "motion-plan-review", "visual-sample-review", "final-preview"]) {
      assert.equal(reopened.gates[gate].status, supersededGates.includes(gate) ? "superseded" : "approved");
    }
    assert.equal(reopened.visualPlanSha256, ["rough-cut", "motion-plan"].includes(scope) ? null : "a".repeat(64));
    assert.equal(reopened.compositionArtifactSha256, scope === "delivery" ? "b".repeat(64) : null);
  }

  const modeSwitchJob = scaffold("mode-switch");
  const modeSwitchWorkflow = path.join(modeSwitchJob, "state", "workflow.json");
  nodeScript("workflow-state.mjs", [modeSwitchWorkflow, "set-caption-mode", "motion-copy", "--actor", "user"]);
  assert.equal(readJson(path.join(modeSwitchJob, "state", "creative-confirmation.json")).storyboard.captionPlan, undefined);
  assert.equal(fs.existsSync(path.join(modeSwitchJob, "docs", "caption-plan.md")), false);
  assert.match(fs.readFileSync(path.join(modeSwitchJob, "docs", "creative-confirmation.md"), "utf8"), /字幕模式：`motion-copy`/);
  nodeScript("workflow-state.mjs", [modeSwitchWorkflow, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  assert.deepEqual(readJson(path.join(modeSwitchJob, "state", "creative-confirmation.json")).visualSample.requiredAxes, ["B"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.example.json"), path.join(modeSwitchJob, "state", "beat-map.json"));
  const motionCopyFingerprint = computeVisualSampleFingerprint(modeSwitchJob, "motion-copy");
  const motionCopyMap = readJson(path.join(modeSwitchJob, "state", "beat-map.json"));
  motionCopyMap.beats[0].entryAnchorWordId = "seg-001:word-002";
  writeJsonAtomic(path.join(modeSwitchJob, "state", "beat-map.json"), motionCopyMap);
  assert.equal(computeVisualSampleFingerprint(modeSwitchJob, "motion-copy"), motionCopyFingerprint);
  motionCopyMap.beats[0].attentionCost = "medium";
  writeJsonAtomic(path.join(modeSwitchJob, "state", "beat-map.json"), motionCopyMap);
  const costFingerprint = computeVisualSampleFingerprint(modeSwitchJob, "motion-copy");
  motionCopyMap.beats[0].attentionCost = "low";
  writeJsonAtomic(path.join(modeSwitchJob, "state", "beat-map.json"), motionCopyMap);
  assert.equal(computeVisualSampleFingerprint(modeSwitchJob, "motion-copy"), costFingerprint);
  motionCopyMap.beats[0].transitionFamily = "changed-grammar";
  writeJsonAtomic(path.join(modeSwitchJob, "state", "beat-map.json"), motionCopyMap);
  assert.notEqual(computeVisualSampleFingerprint(modeSwitchJob, "motion-copy"), motionCopyFingerprint);
  nodeScript("workflow-state.mjs", [modeSwitchWorkflow, "set-caption-mode", "subtitles", "--actor", "user"]);
  assert.equal(readJson(path.join(modeSwitchJob, "state", "creative-confirmation.json")).storyboard.captionPlan, "docs/caption-plan.md");
  assert.equal(fs.existsSync(path.join(modeSwitchJob, "docs", "caption-plan.md")), true);

  const motionCopyJob = scaffold("motion-copy-route");
  const motionCopyWorkflowPath = path.join(motionCopyJob, "state", "workflow.json");
  nodeScript("workflow-state.mjs", [motionCopyWorkflowPath, "set-caption-mode", "motion-copy", "--actor", "user"]);
  nodeScript("workflow-state.mjs", [motionCopyWorkflowPath, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  nodeScript("register-reference-script.mjs", [motionCopyWorkflowPath, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(motionCopyJob, "state", "transcript.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.example.json"), path.join(motionCopyJob, "state", "beat-map.json"));
  nodeScript("create-transcript-reconciliation.mjs", [motionCopyJob, "input/source.mov", writeSpeechOnlyItems(motionCopyJob, "motion-copy-items")]);
  fs.writeFileSync(
    path.join(motionCopyJob, "docs", "motion-plan.md"),
    "# Motion Plan\n\n- Caption mode: motion-copy\n\n| Time | Audio phrase |\n| --- | --- |\n| 0–1.5 | 看看这些特效 |\n| 1.5–3.2 | 看看这些动画 |\n"
  );
  const motionCopyConfirmationPath = path.join(motionCopyJob, "state", "creative-confirmation.json");
  const motionCopyConfirmation = readJson(motionCopyConfirmationPath);
  motionCopyConfirmation.storyboard.beatCount = 2;
  motionCopyConfirmation.review = { status: "ready" };
  motionCopyConfirmation.authorities = computeCreativeAuthorities(motionCopyJob, "motion-copy");
  writeJsonAtomic(motionCopyConfirmationPath, motionCopyConfirmation);
  const motionCopyWorkflow = readJson(motionCopyWorkflowPath);
  motionCopyWorkflow.currentState = "motion-plan";
  motionCopyWorkflow.pendingGate = null;
  writeJsonAtomic(motionCopyWorkflowPath, motionCopyWorkflow);
  nodeScript("workflow-state.mjs", [motionCopyWorkflowPath, "advance", "--artifact", "docs/motion-plan.md"]);
  assert.equal(readJson(motionCopyWorkflowPath).currentState, "motion-plan-review");
  nodeScript("workflow-state.mjs", [motionCopyWorkflowPath, "approve", "--actor", "user", "--note", "approve motion-copy"]);
  assert.equal(readJson(motionCopyWorkflowPath).currentState, "visual-sample");

  const captionOnlyMap = readJson(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"));
  for (const beat of captionOnlyMap.beats) Object.assign(beat, { mgScope: "none", recipe: "caption-only", axis: "A", components: [], microEvents: [] });
  const captionOnlyMapPath = path.join(temporaryRoot, "caption-only-map.json");
  writeJsonAtomic(captionOnlyMapPath, captionOnlyMap);
  const captionOnlyTimes = nodeScript("review-times.mjs", [captionOnlyMapPath]).stdout.trim().split(",");
  assert.equal(captionOnlyTimes.length, 3);

  const extensionlessSource = path.join(temporaryRoot, "extensionless-source");
  const extensionlessJob = path.join(temporaryRoot, "extensionless-job");
  fs.writeFileSync(extensionlessSource, "media");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [extensionlessJob, extensionlessSource, "review", "subtitles"]);
  assert.equal(fs.existsSync(path.join(extensionlessJob, "input", "source.media")), true);
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [path.join(temporaryRoot, "missing-job"), path.join(temporaryRoot, "missing.mov")], false);

  const intakeJob = scaffold("intake");
  const intakeWorkflow = path.join(intakeJob, "state", "workflow.json");
  nodeScript("workflow-state.mjs", [intakeWorkflow, "advance"]);
  const deferredIntake = readJson(intakeWorkflow);
  assert.equal(deferredIntake.currentState, "transcription");
  assert.equal(deferredIntake.captionModeAcknowledged, false);
  assert.equal(deferredIntake.referenceScriptStatus, "none");
  assert.equal(deferredIntake.referenceScriptAcknowledged, false);
  nodeScript("workflow-state.mjs", [intakeWorkflow, "set-caption-mode", "subtitles", "--actor", "agent"], false, /require --note/);
  nodeScript("workflow-state.mjs", [intakeWorkflow, "set-caption-mode", "subtitles", "--actor", "agent", "--note", "Talking-head release benefits from readable captions"]);
  nodeScript("workflow-state.mjs", [intakeWorkflow, "set-axis-mode", "a-axis-overlay", "--actor", "agent", "--note", "No supporting B-axis media was supplied"]);
  assert.equal(readJson(intakeWorkflow).captionModeSource, "auto");
  assert.equal(readJson(intakeWorkflow).visualAxisModeSource, "auto");

  const referenceJob = scaffold("reference");
  const referenceWorkflow = path.join(referenceJob, "state", "workflow.json");
  const referenceSource = path.join(temporaryRoot, "reference.md");
  fs.writeFileSync(referenceSource, "参考稿\n");
  nodeScript("register-reference-script.mjs", [referenceWorkflow, "provided", referenceSource, "--actor", "user"]);
  const registered = readJson(referenceWorkflow);
  assert.equal(registered.referenceScriptStatus, "provided");
  assert.match(registered.referenceScriptPath, /^input\/reference-scripts\/[a-f0-9]{64}\.txt$/);
  fs.appendFileSync(path.join(referenceJob, registered.referenceScriptPath), "tampered");
  nodeScript("workflow-state.mjs", [referenceWorkflow, "advance"], false);
  const binaryReference = path.join(temporaryRoot, "binary.txt");
  fs.writeFileSync(binaryReference, Buffer.from([0, 1, 2]));
  nodeScript("register-reference-script.mjs", [intakeWorkflow, "provided", binaryReference], false);
  nodeScript("register-reference-script.mjs", [intakeWorkflow, "provided", temporaryRoot], false);

  const symlinkJob = scaffold("symlink", true);
  const symlinkWorkflow = path.join(symlinkJob, "state", "workflow.json");
  const normalizedReference = "参考稿\n";
  const symlinkHash = sha256Text(normalizedReference);
  const externalReference = path.join(temporaryRoot, "external-reference.txt");
  fs.writeFileSync(externalReference, normalizedReference);
  fs.symlinkSync(externalReference, path.join(symlinkJob, "input", "reference-scripts", `${symlinkHash}.txt`));
  nodeScript("register-reference-script.mjs", [symlinkWorkflow, "provided", referenceSource], false);

  const legacyJob = scaffold("legacy", true);
  const legacyWorkflowPath = path.join(legacyJob, "state", "workflow.json");
  const legacy = readJson(legacyWorkflowPath);
  legacy.currentState = "visual-sample-review";
  legacy.pendingGate = "visual-sample-review";
  legacy.gates["visual-sample-review"] = { status: "pending", artifact: "previews/visual-sample.mp4" };
  delete legacy.referenceScriptStatus;
  delete legacy.referenceScriptAcknowledged;
  delete legacy.referenceScriptPath;
  delete legacy.referenceScriptSha256;
  writeJsonAtomic(legacyWorkflowPath, legacy);
  nodeScript("workflow-state.mjs", [legacyWorkflowPath, "status"]);
  assert.equal("intakeDecisionBlock" in readJson(legacyWorkflowPath), false);
  nodeScript("workflow-state.mjs", [legacyWorkflowPath, "set-mode", "auto"], false);
  fs.mkdirSync(path.join(legacyJob, "previews"), { recursive: true });
  fs.writeFileSync(path.join(legacyJob, "previews", "visual-sample.mp4"), "not video");
  nodeScript("workflow-state.mjs", [legacyWorkflowPath, "set-mode", "auto"], false);

  const axisJob = scaffold("axis-consent", true);
  const axisWorkflowPath = path.join(axisJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [axisWorkflowPath, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(axisJob, "state", "transcript.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"), path.join(axisJob, "state", "beat-map.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"), path.join(axisJob, "captions", "caption-review-plan.json"));
  fs.writeFileSync(path.join(axisJob, "docs", "motion-plan.md"), "# Motion Plan\n\n关键帧 / GSAP\n\n30 FPS / 实时同步\n");
  nodeScript("build-caption-review-plan.mjs", [axisJob]);
  nodeScript("create-transcript-reconciliation.mjs", [axisJob, "input/source.mov", writeSpeechOnlyItems(axisJob, "axis-items")]);
  const axisConfirmationPath = path.join(axisJob, "state", "creative-confirmation.json");
  const axisConfirmation = readJson(axisConfirmationPath);
  axisConfirmation.visualAxisMode = "b-axis-stage";
  axisConfirmation.visualAxisModeDecision = { status: "default-proposed", source: "default" };
  axisConfirmation.storyboard.beatCount = 2;
  axisConfirmation.visualSample = { scope: "selective-mg", requiredAxes: ["B"], purpose: "verify-selected-mg" };
  axisConfirmation.authorities = computeCreativeAuthorities(axisJob, "subtitles");
  axisConfirmation.review = { status: "ready" };
  writeJsonAtomic(axisConfirmationPath, axisConfirmation);
  fs.appendFileSync(
    path.join(axisJob, "docs", "creative-confirmation.md"),
    `\n${JSON.stringify(readJson(path.join(axisJob, "state", "beat-map.json")), null, 2)}\n`
  );
  const axisWorkflow = readJson(axisWorkflowPath);
  axisWorkflow.currentState = "motion-plan-review";
  axisWorkflow.pendingGate = "motion-plan-review";
  axisWorkflow.visualAxisMode = "b-axis-stage";
  axisWorkflow.visualAxisModeSource = "default";
  axisWorkflow.visualAxisModeAcknowledged = false;
  axisWorkflow.gates["motion-plan-review"] = { status: "pending", artifact: "docs/motion-plan.md" };
  axisWorkflow.pendingCreativePackageSha256 = computePendingCreativePackageSha256(axisJob, "subtitles");
  writeJsonAtomic(axisWorkflowPath, axisWorkflow);
  nodeScript(
    "workflow-state.mjs",
    [axisWorkflowPath, "set-mode", "auto", "--actor", "user"],
    false,
    /explicit user acknowledgement/
  );
  const axisDocPath = path.join(axisJob, "docs", "creative-confirmation.md");
  const axisDoc = fs.readFileSync(axisDocPath, "utf8");
  fs.appendFileSync(axisDocPath, "\ntampered\n");
  nodeScript(
    "workflow-state.mjs",
    [axisWorkflowPath, "set-mode", "auto", "--actor", "user"],
    false,
    /Pending creative review package changed/
  );
  fs.writeFileSync(axisDocPath, axisDoc);
  nodeScript("workflow-state.mjs", [legacyWorkflowPath, "set-caption-mode", "subtitles", "--actor", "user"]);
  nodeScript("register-reference-script.mjs", [legacyWorkflowPath, "none", "--actor", "user"]);
  assert.equal(readJson(legacyWorkflowPath).currentState, "visual-sample-review");
  nodeScript("workflow-state.mjs", [legacyWorkflowPath, "set-mode", "auto"], false);

  const lateJob = scaffold("late", true);
  const lateWorkflowPath = path.join(lateJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [lateWorkflowPath, "none", "--actor", "user"]);
  const late = readJson(lateWorkflowPath);
  late.currentState = "motion-plan-review";
  late.pendingGate = "motion-plan-review";
  writeJsonAtomic(lateWorkflowPath, late);
  nodeScript("register-reference-script.mjs", [lateWorkflowPath, "provided", referenceSource, "--actor", "user"]);
  const changed = readJson(lateWorkflowPath);
  assert.equal(changed.currentState, "transcription");
  assert.equal(changed.reconciliationReturnState, "motion-plan");
  nodeScript("register-reference-script.mjs", [lateWorkflowPath, "provided", referenceSource, "--actor", "user"]);
  assert.equal(readJson(lateWorkflowPath).reconciliationReturnState, "motion-plan");

  const reconciliationJob = scaffold("reconciliation", true);
  const reconciliationWorkflow = path.join(reconciliationJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [reconciliationWorkflow, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(reconciliationJob, "state", "transcript.json"));
  nodeScript("create-transcript-reconciliation.mjs", [reconciliationJob, "input/source.mov", writeSpeechOnlyItems(reconciliationJob, "reconciliation-items")]);
  nodeScript("check-transcript-reconciliation.mjs", [path.join(reconciliationJob, "state", "transcript-reconciliation.json")]);
  const invalidSpanJob = scaffold("invalid-span", true);
  const invalidSpanWorkflow = path.join(invalidSpanJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [invalidSpanWorkflow, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(invalidSpanJob, "state", "transcript.json"));
  const zeroSpanItems = writeSpeechOnlyItems(invalidSpanJob, "invalid-span-items", (items) => items.map((item) => ({
    ...item,
    start: 0,
    end: 0
  })));
  nodeScript("create-transcript-reconciliation.mjs", [invalidSpanJob, "input/source.mov", zeroSpanItems]);
  nodeScript(
    "check-transcript-reconciliation.mjs",
    [path.join(invalidSpanJob, "state", "transcript-reconciliation.json")],
    false,
    /positive acoustic span/
  );
  const transcript = readJson(path.join(reconciliationJob, "state", "transcript.json"));
  transcript.revision += 1;
  writeJsonAtomic(path.join(reconciliationJob, "state", "transcript.json"), transcript);
  nodeScript("check-transcript-reconciliation.mjs", [path.join(reconciliationJob, "state", "transcript-reconciliation.json")], false);

  const resolutionJob = scaffold("resolution", true);
  const resolutionWorkflowPath = path.join(resolutionJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [resolutionWorkflowPath, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(resolutionJob, "state", "transcript.json"));
  const resolutionItems = writeSpeechOnlyItems(resolutionJob, "resolution-items", (items) => [{
    id: "amb-001",
    type: "ambiguous",
    segmentId: "seg-001",
    start: 0,
    end: 1.5,
    referenceText: "看看这些动画",
    heardText: "看看这些特效",
    resolution: "unresolved",
    releaseImpact: true,
    confidence: 0.7,
    evidence: { audioChecked: true, supportsReference: false, note: "Consonant remains ambiguous" }
  }, ...items.slice(1)]);
  nodeScript("create-transcript-reconciliation.mjs", [resolutionJob, "input/source.mov", resolutionItems]);
  const resolutionWorkflow = readJson(resolutionWorkflowPath);
  resolutionWorkflow.currentState = "motion-plan-review";
  resolutionWorkflow.pendingGate = "motion-plan-review";
  resolutionWorkflow.gates["motion-plan-review"] = { status: "pending", artifact: "docs/motion-plan.md" };
  writeJsonAtomic(resolutionWorkflowPath, resolutionWorkflow);
  nodeScript("resolve-transcript-item.mjs", [resolutionWorkflowPath, "amb-001", "accepted-speech", "--actor", "user", "--note", "按录音"]);
  assert.equal(readJson(path.join(resolutionJob, "state", "transcript.json")).revision, 2);
  assert.equal(readJson(resolutionWorkflowPath).currentState, "motion-plan");
  assert.equal(fs.existsSync(path.join(resolutionJob, "state", "transcript-resolution.transaction.json")), false);
  nodeScript("check-transcript-reconciliation.mjs", [path.join(resolutionJob, "state", "transcript-reconciliation.json")]);

  const fingerprintJob = scaffold("fingerprint", true);
  const fingerprintWorkflowPath = path.join(fingerprintJob, "state", "workflow.json");
  nodeScript("register-reference-script.mjs", [fingerprintWorkflowPath, "none", "--actor", "user"]);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(fingerprintJob, "state", "transcript.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"), path.join(fingerprintJob, "state", "beat-map.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"), path.join(fingerprintJob, "captions", "caption-review-plan.json"));
  const confirmationPath = path.join(fingerprintJob, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.authorities = computeCreativeAuthorities(fingerprintJob, "subtitles");
  confirmation.review = { status: "approved", actor: "user", decidedAt: new Date().toISOString(), note: "approved" };
  writeJsonAtomic(confirmationPath, confirmation);
  const fingerprintWorkflow = ensureWorkflowDefaults(readJson(fingerprintWorkflowPath));
  fingerprintWorkflow.creativeConfirmationSha256 = sha256File(confirmationPath);
  fingerprintWorkflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(fingerprintJob, "subtitles");
  writeJsonAtomic(fingerprintWorkflowPath, fingerprintWorkflow);
  const sampleFingerprint = computeVisualSampleFingerprint(fingerprintJob, "subtitles");
  const repeatedGrammar = readJson(path.join(fingerprintJob, "state", "beat-map.json"));
  repeatedGrammar.beats.push({ ...repeatedGrammar.beats[0], id: "repeated-grammar" });
  writeJsonAtomic(path.join(fingerprintJob, "state", "beat-map.json"), repeatedGrammar);
  assert.equal(computeVisualSampleFingerprint(fingerprintJob, "subtitles"), sampleFingerprint);
  repeatedGrammar.beats.at(-1).attentionCost = "high";
  writeJsonAtomic(path.join(fingerprintJob, "state", "beat-map.json"), repeatedGrammar);
  assert.notEqual(computeVisualSampleFingerprint(fingerprintJob, "subtitles"), sampleFingerprint);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"), path.join(fingerprintJob, "state", "beat-map.json"));
  assertCreativeAuthorities(fingerprintJob, fingerprintWorkflow);
  fs.appendFileSync(path.join(fingerprintJob, "state", "beat-map.json"), "\n");
  assert.throws(() => assertCreativeAuthorities(fingerprintJob, fingerprintWorkflow), /drift/);
  const driftedConfirmation = readJson(confirmationPath);
  driftedConfirmation.visualSample.scope = "selective-mg";
  writeJsonAtomic(confirmationPath, driftedConfirmation);
  assert.throws(() => assertCreativeAuthorities(fingerprintJob, fingerprintWorkflow), /package drift/);

  const transactionJob = scaffold("transaction", true);
  const transactionWorkflowPath = path.join(transactionJob, "state", "workflow.json");
  const preparedRelative = "state/workflow.json.bad.prepared";
  fs.writeFileSync(path.join(transactionJob, preparedRelative), "{}\n");
  writeJsonAtomic(path.join(transactionJob, "state", "transcript-resolution.transaction.json"), {
    id: "bad",
    files: [{ target: "../escaped.json", prepared: preparedRelative, sha256: sha256File(path.join(transactionJob, preparedRelative)) }]
  });
  nodeScript("workflow-state.mjs", [transactionWorkflowPath, "status"], false);
  assert.equal(fs.existsSync(path.join(temporaryRoot, "escaped.json")), false);

  console.log("Workflow contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
