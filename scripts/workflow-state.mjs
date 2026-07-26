import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertCreativeAuthorities,
  assertRegularContainedFile,
  beginWorkflowRevision,
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  computePendingCreativePackageSha256,
  computeValidationBundleSha256,
  computeVisualSampleFingerprint,
  ensureWorkflowDefaults,
  intakeResolved,
  invalidateCreativeArtifacts,
  isPathInside,
  jobRootForWorkflow,
  readJson,
  recoverTranscriptTransaction,
  refreshIntakeBlock,
  saveWorkflow,
  sha256File,
  validateActiveReference,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [workflowPath, command, ...rawArguments] = process.argv.slice(2);

if (!workflowPath || !command) {
  console.error("Usage: node workflow-state.mjs <workflow.json> <status|advance|approve|revise|replan|reopen|set-mode|set-caption-mode|set-axis-mode> [value] [--actor name] [--artifact path] [--note text]");
  process.exit(64);
}

const stages = {
  intake: { next: "transcription" },
  transcription: { next: "rough-cut", artifact: true },
  "rough-cut": { next: "rough-cut-review", artifact: true },
  "rough-cut-review": { gate: true, next: "motion-plan", revise: "rough-cut" },
  "motion-plan": { next: "motion-plan-review", artifact: true },
  "motion-plan-review": { gate: true, next: null, revise: "motion-plan" },
  "visual-sample": { next: "visual-sample-review", artifact: true },
  "visual-sample-review": { gate: true, next: "composition", revise: "visual-sample" },
  composition: { next: "qa", artifact: true },
  qa: { next: "final-preview", artifact: true },
  "final-preview": { gate: true, next: "render", revise: "composition" },
  render: { next: "complete", artifact: true },
  complete: { terminal: true }
};

const options = {};
const positionals = [];
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  if (argument.startsWith("--")) {
    options[argument.slice(2)] = rawArguments[index + 1] ?? true;
    index += 1;
  } else {
    positionals.push(argument);
  }
}

const jobRoot = jobRootForWorkflow(workflowPath);
recoverTranscriptTransaction(jobRoot);
const workflowBeforeMigration = fs.readFileSync(workflowPath, "utf8");
const workflow = ensureWorkflowDefaults(JSON.parse(workflowBeforeMigration));
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const actor = String(options.actor ?? (command === "advance" ? "agent" : "user"));
const artifact = options.artifact ? String(options.artifact) : null;
const note = options.note ? String(options.note) : null;
const now = new Date().toISOString();

const appendHistory = (action, from, to, entryActor = actor) => {
  workflow.history.push({ at: now, action, actor: entryActor, from, to, artifact, note, revisionId: workflow.revisionId });
};

const move = (to, action, entryActor = actor) => {
  const from = workflow.currentState;
  workflow.currentState = to;
  workflow.pendingGate = stages[to]?.gate ? to : null;
  if (stages[to]?.gate) {
    workflow.gates[to] = { status: "pending", at: now, actor: entryActor, artifact, note, revisionId: workflow.revisionId };
  }
  appendHistory(action, from, to, entryActor);
};

const markGateSkipped = (gate, reason) => {
  workflow.gates[gate] = {
    status: "skipped",
    at: now,
    decidedAt: now,
    actor: "agent",
    note: reason,
    revisionId: workflow.revisionId
  };
};

const runCheck = (scriptName, argumentsList, failurePrefix) => {
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, scriptName), ...argumentsList], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${failurePrefix}: ${result.stderr.trim() || result.stdout.trim()}`);
};

const reconciliationPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
const checkReconciliation = (allowPending, expectedMedia = null) => {
  if (!fs.existsSync(reconciliationPath)) throw new Error("Transcript reconciliation is missing");
  runCheck(
    "check-transcript-reconciliation.mjs",
    [reconciliationPath, ...(allowPending ? ["--allow-review-pending"] : []), ...(expectedMedia ? ["--expected-media", expectedMedia] : [])],
    "Transcript reconciliation failed"
  );
};

const recordCreativeAuthorities = () => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.authorities = computeCreativeAuthorities(jobRoot, workflow.captionMode);
  writeJsonAtomic(confirmationPath, confirmation);
};

const assertJobArtifact = (relativePath, expectedDirectory) => {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Artifacts must use a job-relative path");
  const absolutePath = path.resolve(jobRoot, relativePath);
  assertRegularContainedFile(path.join(jobRoot, expectedDirectory), absolutePath, "Workflow artifact");
  return absolutePath;
};

const probeReviewVideo = (videoPath, label) => {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", videoPath], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`${label} is not a readable media file`);
  const result = JSON.parse(probe.stdout || "{}");
  const duration = Number(result.format?.duration);
  if (!(duration > 0)) throw new Error(`${label} has no positive duration`);
  if (label === "Visual sample" && (duration < 3 || duration > 5.05)) throw new Error("Visual sample must be 3–5 seconds");
  const streamTypes = new Set((result.streams ?? []).map((stream) => stream.codec_type));
  if (!streamTypes.has("video") || !streamTypes.has("audio")) throw new Error(`${label} requires video and audio streams`);
  const video = result.streams.find((stream) => stream.codec_type === "video");
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  const [numerator, denominator] = String(video?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = denominator ? numerator / denominator : 0;
  const videoDuration = Number(video?.duration);
  const audioDuration = Number(audio?.duration);
  if (Number.isFinite(videoDuration) && Number.isFinite(audioDuration)
    && Math.abs(videoDuration - audioDuration) > Math.max(0.1, 2 / Math.max(fps, 1))) {
    throw new Error(`${label} audio and video durations differ`);
  }
  return { duration, width: video?.width, height: video?.height, fps };
};

const probeReviewSignal = (videoPath, duration, label) => {
  const audio = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", videoPath, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const meanVolume = Number(/mean_volume:\s*(-?[0-9.]+)\s*dB/.exec(audio.stderr)?.[1]);
  if (audio.status !== 0 || !Number.isFinite(meanVolume) || meanVolume <= -60) {
    throw new Error(`${label} audio is silent or unreadable`);
  }
  const video = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", videoPath, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const blackDuration = [...video.stderr.matchAll(/black_duration:([0-9.]+)/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
  if (video.status !== 0 || blackDuration >= duration * 0.8) {
    throw new Error(`${label} is predominantly black or unreadable`);
  }
};

const verifyEditorialMatch = (deliveryPath, previewPath) => {
  const video = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", deliveryPath, "-i", previewPath, "-filter_complex", "[0:v][1:v]ssim", "-an", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const videoScore = Number(/All:([0-9.]+)/.exec(video.stderr)?.[1]);
  if (video.status !== 0 || !Number.isFinite(videoScore) || videoScore < 0.92) {
    throw new Error("Final delivery picture differs from the approved preview");
  }
  const audio = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", deliveryPath, "-i", previewPath, "-filter_complex", "[0:a][1:a]apsnr", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  const audioScores = [...audio.stderr.matchAll(/PSNR ch\d+:\s*(inf|[0-9.]+)\s*dB/g)]
    .map((match) => match[1] === "inf" ? Infinity : Number(match[1]));
  if (audio.status !== 0 || audioScores.length === 0 || audioScores.some((score) => score < 20)) {
    throw new Error("Final delivery audio differs from the approved preview");
  }
};

const evidenceContracts = readJson(path.join(scriptDirectory, "..", "config", "validation-evidence-contracts.json"));

const validateEvidenceReceipt = (item, contract, subject, usedPaths, invocation = null) => {
  const repositoryRoot = path.join(scriptDirectory, "..");
  const expectedCommand = contract.phase === "visual"
    ? `node ${evidenceContracts.runner} ${jobRoot} ${contract.phase} ${contract.checkId} ${invocation.sample.path} ${invocation.source.path}`
    : `node ${evidenceContracts.runner} ${jobRoot} ${contract.phase} ${contract.checkId} ${subject.path}`;
  const expectedRunnerSha256 = sha256File(path.join(repositoryRoot, evidenceContracts.runner));
  const expectedValidatorVersion = sha256File(path.join(repositoryRoot, evidenceContracts.implementations[contract.validator]));
  const expectedBundleSha256 = computeValidationBundleSha256(jobRoot, contract.phase, subject.path, workflow.captionMode);
  if (item.kind !== contract.kind || item.validator !== contract.validator) {
    throw new Error(`Evidence contract mismatch for ${contract.validator}`);
  }
  if (item.command !== expectedCommand
    || item.runnerSha256 !== expectedRunnerSha256
    || item.validatorVersion !== expectedValidatorVersion
    || item.bundleSha256 !== expectedBundleSha256
    || item.subjectSha256 !== subject.sha256) {
    throw new Error(`Evidence metadata is incomplete for ${contract.validator}`);
  }
  const invocationSubjects = invocation ? Object.values(invocation).map((candidate) => candidate.path) : [];
  if (item.path === subject.path || invocationSubjects.includes(item.path) || usedPaths.has(item.path)) {
    throw new Error(`Evidence must be an independent receipt for ${contract.validator}`);
  }
  usedPaths.add(item.path);
  const receiptPath = assertJobArtifact(item.path, contract.directory);
  if (sha256File(receiptPath) !== item.sha256 || path.extname(receiptPath) !== ".json") {
    throw new Error(`Evidence receipt is stale or not JSON: ${item.path}`);
  }
  const receipt = readJson(receiptPath);
  if (receipt.schemaVersion !== "1.0.0"
    || receipt.status !== "pass"
    || receipt.kind !== item.kind
    || receipt.validator !== item.validator
    || receipt.validatorVersion !== item.validatorVersion
    || receipt.runnerSha256 !== item.runnerSha256
    || receipt.bundleSha256 !== item.bundleSha256
    || receipt.command !== item.command
    || receipt.exitCode !== 0
    || receipt.subject?.path !== subject.path
    || receipt.subject?.sha256 !== subject.sha256) {
    throw new Error(`Evidence receipt metadata mismatch: ${item.path}`);
  }
  const outputPath = assertJobArtifact(receipt.output?.path, "logs");
  if (receipt.output?.sha256 !== sha256File(outputPath)) {
    throw new Error(`Evidence output is stale: ${receipt.output?.path}`);
  }
  if (item.kind === "snapshot-manifest") {
    if (!Array.isArray(receipt.snapshots) || receipt.snapshots.length < 3) {
      throw new Error("Snapshot evidence requires at least three review frames");
    }
    const timestamps = new Set();
    for (const snapshot of receipt.snapshots) {
      if (!Number.isFinite(snapshot.time) || timestamps.has(snapshot.time)) throw new Error("Snapshot times must be distinct");
      timestamps.add(snapshot.time);
      const snapshotPath = assertJobArtifact(snapshot.path, "checkpoints");
      if (sha256File(snapshotPath) !== snapshot.sha256 || !/\.(png|jpe?g)$/i.test(snapshot.path)) {
        throw new Error(`Snapshot evidence is invalid: ${snapshot.path}`);
      }
    }
  }
};

const validateFinalQa = (previewRelativePath) => {
  const reportPath = path.join(jobRoot, "state", "qa-report.json");
  assertRegularContainedFile(path.join(jobRoot, "state"), reportPath, "QA report");
  const report = readJson(reportPath);
  const requiredChecks = ["hyperframes", "font", "information-value", "layout", "snapshots", workflow.captionMode === "subtitles" ? "captions" : "motion-copy-coverage", "audio", "media"];
  const passed = new Set((report.checks ?? []).filter((check) => check.status === "pass").map((check) => check.id));
  if (report.passed !== true || requiredChecks.some((id) => !passed.has(id))) {
    throw new Error("Final preview requires a passing QA report with every required check");
  }
  const previewPath = assertJobArtifact(previewRelativePath, "previews");
  const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
  const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
  if (!workflow.trimPlanSha256 || sha256File(trimPlanPath) !== workflow.trimPlanSha256) {
    throw new Error("Approved trim plan changed after edit lock");
  }
  if (!workflow.visualPlanSha256 || sha256File(beatMapPath) !== workflow.visualPlanSha256) {
    throw new Error("Approved visual plan changed after planning validation");
  }
  const previewProbe = probeReviewVideo(previewPath, "Final preview");
  probeReviewSignal(previewPath, previewProbe.duration, "Final preview");
  if (report.artifacts?.composition?.path !== workflow.compositionArtifactPath
    || report.artifacts?.composition?.sha256 !== workflow.compositionArtifactSha256
    || report.artifacts?.preview?.path !== previewRelativePath
    || report.artifacts?.preview?.sha256 !== sha256File(previewPath)) {
    throw new Error("QA report artifact fingerprints are stale");
  }
  const subjects = {
    composition: { path: workflow.compositionArtifactPath, sha256: workflow.compositionArtifactSha256 },
    preview: { path: previewRelativePath, sha256: sha256File(previewPath) }
  };
  const usedEvidencePaths = new Set();
  for (const checkId of requiredChecks) {
    const check = (report.checks ?? []).find((candidate) => candidate.id === checkId);
    if (!Array.isArray(check?.evidence) || check.evidence.length === 0) throw new Error(`QA check ${checkId} lacks evidence`);
    const contract = { ...evidenceContracts.final[checkId], phase: "final", checkId };
    for (const item of check.evidence) {
      validateEvidenceReceipt(item, contract, subjects[contract.subject], usedEvidencePaths);
    }
  }
};

const validateVisualSampleReport = (sampleRelativePath) => {
  const reportPath = path.join(jobRoot, "state", "visual-sample-report.json");
  assertRegularContainedFile(path.join(jobRoot, "state"), reportPath, "Visual-sample report");
  const report = readJson(reportPath);
  const samplePath = assertJobArtifact(sampleRelativePath, "previews");
  const sampleProbe = probeReviewVideo(samplePath, "Visual sample");
  probeReviewSignal(samplePath, sampleProbe.duration, "Visual sample");
  const sourcePath = assertJobArtifact(report.source?.path, "hyperframes");
  const sampleSubject = { path: sampleRelativePath, sha256: sha256File(samplePath) };
  const sourceSubject = { path: report.source.path, sha256: sha256File(sourcePath) };
  const requiredChecks = Object.keys(evidenceContracts.visual);
  const checks = new Map((report.checks ?? []).map((check) => [check.id, check]));
  if (report.passed !== true
    || report.artifact?.path !== sampleRelativePath
    || report.artifact?.sha256 !== sampleSubject.sha256
    || report.source?.sha256 !== sourceSubject.sha256
    || report.creativePackageSha256 !== workflow.creativeConfirmationSha256
    || requiredChecks.some((id) => checks.get(id)?.status !== "pass")) {
    throw new Error("Visual sample requires a current passing validation report");
  }
  const usedEvidencePaths = new Set();
  const subjects = { sample: sampleSubject, source: sourceSubject };
  for (const id of requiredChecks) {
    const evidence = checks.get(id)?.evidence ?? [];
    if (evidence.length === 0) throw new Error(`Visual-sample check ${id} lacks evidence`);
    for (const item of evidence) {
      const contract = { ...evidenceContracts.visual[id], phase: "visual", checkId: id };
      validateEvidenceReceipt(item, contract, subjects[contract.subject], usedEvidencePaths, subjects);
    }
  }
};

const validateGateArtifact = (gate) => {
  const recordedArtifact = workflow.gates?.[gate]?.artifact;
  if (!recordedArtifact) throw new Error(`Gate ${gate} has no recorded artifact`);
  const expectedDirectory = {
    "rough-cut-review": "roughcut",
    "motion-plan-review": "docs",
    "visual-sample-review": "previews",
    "final-preview": "previews"
  }[gate];
  const recordedArtifactPath = assertJobArtifact(recordedArtifact, expectedDirectory);
  if (gate === "rough-cut-review") {
    probeReviewVideo(recordedArtifactPath, "Rough cut");
    const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
    if (!workflow.trimPlanSha256 || sha256File(trimPlanPath) !== workflow.trimPlanSha256) {
      throw new Error("Rough-cut trim audit changed after the locked edit was produced");
    }
    if (!workflow.authoritativeMediaSha256 || sha256File(recordedArtifactPath) !== workflow.authoritativeMediaSha256) {
      throw new Error("Rough-cut media changed after the locked edit was produced");
    }
  }
  if (gate === "motion-plan-review") {
    checkReconciliation(false);
    assertCreativeAuthorities(jobRoot, workflow, { requireApproved: false });
    if (!workflow.pendingCreativePackageSha256
      || computePendingCreativePackageSha256(jobRoot, workflow.captionMode) !== workflow.pendingCreativePackageSha256) {
      throw new Error("Pending creative review package changed; replan is required");
    }
    runCheck(
      "check-creative-confirmation.mjs",
      [
        path.join(jobRoot, "state", "creative-confirmation.json"),
        path.join(jobRoot, "docs", "creative-confirmation.md"),
        path.join(jobRoot, "state", "beat-map.json"),
        workflowPath
      ],
      "Creative confirmation revalidation failed"
    );
  }
  if (["visual-sample-review", "final-preview"].includes(gate)) {
    probeReviewVideo(recordedArtifactPath, gate === "final-preview" ? "Final preview" : "Visual sample");
    assertCreativeAuthorities(jobRoot, workflow);
    checkReconciliation(false);
  }
  if (gate === "visual-sample-review") {
    validateVisualSampleReport(recordedArtifact);
  }
  if (gate === "final-preview") validateFinalQa(recordedArtifact);
};

const approveCreativePackage = (approvalNote, approvalActor) => {
  if (!workflow.captionModeAcknowledged) throw new Error("Caption mode requires explicit user acknowledgement");
  if (["b-axis-stage", "hybrid"].includes(workflow.visualAxisMode)
    && (!workflow.visualAxisModeAcknowledged || workflow.visualAxisModeSource !== "user")) {
    throw new Error("B-axis or hybrid plans require explicit user acknowledgement");
  }
  checkReconciliation(false);
  approveCaptionReviewPlan(approvalNote);
  recordCreativeAuthorities();
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.review = { status: "approved", actor: approvalActor, decidedAt: now, note: approvalNote };
  writeJsonAtomic(confirmationPath, confirmation);
  workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
  workflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(jobRoot, workflow.captionMode);
  workflow.pendingCreativePackageSha256 = null;
};

const creativeReviewRequired = () => {
  const beatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  const reconciliation = readJson(reconciliationPath);
  const confirmation = readJson(path.join(jobRoot, "state", "creative-confirmation.json"));
  return confirmation.review?.required === true
    || workflow.captionMode === "motion-copy"
    || ["b-axis-stage", "hybrid"].includes(workflow.visualAxisMode)
    || (beatMap.beats ?? []).some((beat) => beat.mgScope && beat.mgScope !== "none")
    || (reconciliation.items ?? []).some((item) => item.releaseImpact === true && item.resolution === "unresolved");
};

const visualSampleRequired = () => {
  const beatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  const confirmation = readJson(path.join(jobRoot, "state", "creative-confirmation.json"));
  const hasMotion = workflow.captionMode === "motion-copy"
    || (beatMap.beats ?? []).some((beat) => beat.mgScope && beat.mgScope !== "none");
  const fingerprint = computeVisualSampleFingerprint(jobRoot, workflow.captionMode);
  return confirmation.visualSample?.required === true
    || (hasMotion && workflow.approvedVisualSampleFingerprint !== fingerprint);
};

const continueAfterCreativeApproval = (action, entryActor) => {
  if (visualSampleRequired()) {
    move("visual-sample", action, entryActor);
    return;
  }
  markGateSkipped("visual-sample-review", "No new visual language, axis behavior, typography system, or high-attention MG requires a sample");
  move("composition", "skip-visual-sample", entryActor);
};

const autoApproveGate = () => {
  const gate = workflow.currentState;
  const gateStage = stages[gate];
  validateGateArtifact(gate);
  if (gate === "motion-plan-review") approveCreativePackage(note ?? "Validated recommended creative package", "agent");
  workflow.gates[gate] = {
    ...workflow.gates[gate],
    status: "auto-approved",
    decidedAt: now,
    actor: "agent",
    note: note ?? "Recommended option applied automatically"
  };
  if (gate === "motion-plan-review") {
    continueAfterCreativeApproval("auto-approve", "agent");
    return;
  }
  if (gate === "visual-sample-review") {
    workflow.approvedVisualSampleFingerprint = computeVisualSampleFingerprint(jobRoot, workflow.captionMode);
  }
  move(gateStage.next, "auto-approve", "agent");
};

const save = () => {
  saveWorkflow(workflowPath, workflow, now);
};

const invalidateCreativeConfirmation = () => {
  invalidateCreativeArtifacts(jobRoot);
};

const syncCaptionModeArtifacts = (captionMode, resetDocuments) => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (!fs.existsSync(confirmationPath)) return;
  const confirmation = readJson(confirmationPath);
  confirmation.captionMode = captionMode;
  confirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  confirmation.storyboard ??= {};
  if (captionMode === "subtitles") {
    confirmation.storyboard.captionPlan = "docs/caption-plan.md";
    confirmation.visualSample = { required: false, scope: "caption-only", requiredAxes: [], purpose: "verify-caption-layout" };
  } else {
    delete confirmation.storyboard.captionPlan;
    const requiredAxes = workflow.visualAxisMode === "b-axis-stage" ? ["B"] : workflow.visualAxisMode === "hybrid" ? ["A", "B"] : ["A"];
    confirmation.visualSample = { required: false, scope: "axis-behavior", requiredAxes, purpose: "verify-axis-behavior-and-surface" };
  }
  writeJsonAtomic(confirmationPath, confirmation);
  if (!resetDocuments) return;
  const templates = path.join(scriptDirectory, "..", "templates", "job");
  fs.copyFileSync(
    path.join(templates, captionMode === "subtitles" ? "creative-confirmation.md" : "creative-confirmation.motion-copy.md"),
    path.join(jobRoot, "docs", "creative-confirmation.md")
  );
  const captionPlanPath = path.join(jobRoot, "docs", "caption-plan.md");
  if (captionMode === "subtitles") fs.copyFileSync(path.join(templates, "caption-plan.md"), captionPlanPath);
  else if (fs.existsSync(captionPlanPath)) fs.unlinkSync(captionPlanPath);
};

const approveCaptionReviewPlan = (approvalNote) => {
  if (workflow.captionMode !== "subtitles") return;
  const captionReviewPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
  if (!fs.existsSync(captionReviewPlanPath)) throw new Error("Subtitle plan approval requires captions/caption-review-plan.json");
  const captionReviewCheck = spawnSync(process.execPath, [path.join(scriptDirectory, "check-caption-review-plan.mjs"), captionReviewPlanPath], { encoding: "utf8" });
  if (captionReviewCheck.status !== 0) throw new Error(`Subtitle plan approval requires valid semantic cues: ${captionReviewCheck.stderr.trim() || captionReviewCheck.stdout.trim()}`);
  const captionReviewPlan = readJson(captionReviewPlanPath);
  captionReviewPlan.status = "approved";
  captionReviewPlan.approvedAt = now;
  captionReviewPlan.approvalNote = approvalNote;
  writeJsonAtomic(captionReviewPlanPath, captionReviewPlan);
};

if (command === "status") {
  if (`${JSON.stringify(workflow, null, 2)}\n` !== workflowBeforeMigration) save();
  console.log(JSON.stringify(workflow, null, 2));
  process.exit(0);
}

if ((workflow.intakeDecisionBlock || (workflow.currentState !== "intake" && !intakeResolved(workflow)))
  && command !== "set-caption-mode") {
  throw new Error("Legacy intake decisions are unresolved; only caption-mode and reference-script decisions are allowed");
}

if (command === "set-mode") {
  const mode = positionals[0];
  if (!['review', 'auto'].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  const previousMode = workflow.mode;
  workflow.mode = mode;
  appendHistory("set-mode", workflow.currentState, workflow.currentState, actor);
  if (mode === "auto" && stages[workflow.currentState]?.gate) autoApproveGate();
  save();
  console.log(`Mode changed: ${previousMode} → ${workflow.mode}; current state: ${workflow.currentState}`);
  process.exit(0);
}

if (command === "set-caption-mode") {
  const captionMode = positionals[0];
  if (!["motion-copy", "subtitles"].includes(captionMode)) throw new Error(`Invalid caption mode: ${captionMode}`);
  const previousCaptionMode = workflow.captionMode;
  const previousState = workflow.currentState;
  workflow.captionMode = captionMode;
  workflow.captionModeSource = "user";
  workflow.captionModeAcknowledged = true;
  const planningOrLater = ["motion-plan", "motion-plan-review", "visual-sample", "visual-sample-review", "composition", "qa", "final-preview", "render", "complete"].includes(previousState);
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  syncCaptionModeArtifacts(captionMode, !planningOrLater);
  const requiresReplan = previousCaptionMode !== captionMode && planningOrLater;
  if (requiresReplan) {
    if (stages[previousState]?.gate) {
      workflow.gates[previousState] = {
        ...workflow.gates[previousState],
        status: "revision-requested",
        decidedAt: now,
        actor,
        note: note ?? `Caption mode changed to ${captionMode}`
      };
    }
    beginWorkflowRevision(workflow, now, note ?? `Caption mode changed to ${captionMode}`);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.pendingCreativePackageSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-caption-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-caption-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    } else if (previousState === "motion-plan-review") {
      workflow.pendingCreativePackageSha256 = computePendingCreativePackageSha256(jobRoot, workflow.captionMode);
    }
  }
  refreshIntakeBlock(workflow);
  if (intakeResolved(workflow)) workflow.intakeDecisionBlock = false;
  save();
  console.log(`Caption mode changed: ${previousCaptionMode} → ${workflow.captionMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}

if (command === "set-axis-mode") {
  const axisMode = positionals[0];
  if (!["a-axis-overlay", "b-axis-stage", "hybrid"].includes(axisMode)) throw new Error(`Invalid visual axis mode: ${axisMode}`);
  const previousAxisMode = workflow.visualAxisMode;
  const previousState = workflow.currentState;
  workflow.visualAxisMode = axisMode;
  workflow.visualAxisModeSource = "user";
  workflow.visualAxisModeAcknowledged = true;
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (fs.existsSync(confirmationPath)) {
    const confirmation = readJson(confirmationPath);
    confirmation.visualAxisMode = axisMode;
    confirmation.visualAxisModeDecision = { status: "acknowledged", source: "user" };
    if (confirmation.captionMode === "motion-copy" && confirmation.visualSample?.scope === "axis-behavior") {
      confirmation.visualSample.requiredAxes = axisMode === "b-axis-stage" ? ["B"] : axisMode === "hybrid" ? ["A", "B"] : ["A"];
    }
    writeJsonAtomic(confirmationPath, confirmation);
  }
  const planningOrLater = ["motion-plan-review", "visual-sample", "visual-sample-review", "composition", "qa", "final-preview", "render", "complete"].includes(previousState);
  if (previousAxisMode !== axisMode && planningOrLater) {
    if (stages[previousState]?.gate) {
      workflow.gates[previousState] = { ...workflow.gates[previousState], status: "revision-requested", decidedAt: now, actor, note: note ?? `Visual axis changed to ${axisMode}` };
    }
    beginWorkflowRevision(workflow, now, note ?? `Visual axis changed to ${axisMode}`);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.pendingCreativePackageSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-axis-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-axis-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    } else if (previousState === "motion-plan-review") {
      workflow.pendingCreativePackageSha256 = computePendingCreativePackageSha256(jobRoot, workflow.captionMode);
    }
  }
  save();
  console.log(`Visual axis mode changed: ${previousAxisMode} → ${workflow.visualAxisMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}

if (command === "replan") {
  if (!["motion-plan-review", "visual-sample", "visual-sample-review", "composition", "qa", "final-preview", "render"].includes(workflow.currentState)) {
    throw new Error(`State ${workflow.currentState} cannot return to motion-plan`);
  }
  if (!note) throw new Error("Replan requires --note");
  const previousState = workflow.currentState;
  if (stages[previousState]?.gate) {
    workflow.gates[previousState] = {
      ...workflow.gates[previousState],
      status: "revision-requested",
      decidedAt: now,
      actor,
      note
    };
  }
  beginWorkflowRevision(workflow, now, note);
  invalidateCreativeConfirmation();
  workflow.creativeConfirmationSha256 = null;
  workflow.pendingCreativePackageSha256 = null;
  workflow.creativeDocumentFingerprints = null;
  workflow.currentState = "motion-plan";
  workflow.pendingGate = null;
  appendHistory("replan", previousState, "motion-plan", actor);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}

if (command === "reopen") {
  const scope = positionals[0];
  const configurations = {
    "rough-cut": {
      target: "rough-cut",
      gates: ["rough-cut-review", "motion-plan-review", "visual-sample-review", "final-preview"]
    },
    "motion-plan": {
      target: "motion-plan",
      gates: ["motion-plan-review", "visual-sample-review", "final-preview"]
    },
    composition: {
      target: "composition",
      gates: ["final-preview"]
    },
    delivery: {
      target: "render",
      gates: []
    }
  };
  const configuration = configurations[scope];
  if (workflow.currentState !== "complete") throw new Error("Only a completed job can be reopened");
  if (!configuration) throw new Error("Reopen scope must be rough-cut, motion-plan, composition, or delivery");
  if (actor !== "user") throw new Error("Reopen requires --actor user");
  if (!note) throw new Error("Reopen requires --note");
  const previousState = workflow.currentState;
  beginWorkflowRevision(workflow, now, note, {
    gates: configuration.gates,
    invalidateVisualPlan: ["rough-cut", "motion-plan"].includes(scope)
  });
  if (scope === "rough-cut") {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    workflow.authoritativeMediaPath = project.sourceVideo;
    workflow.authoritativeMediaSha256 = null;
    workflow.trimPlanSha256 = null;
  }
  if (["rough-cut", "motion-plan"].includes(scope)) {
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.pendingCreativePackageSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
  }
  if (scope !== "delivery") {
    workflow.compositionArtifactPath = null;
    workflow.compositionArtifactSha256 = null;
  }
  workflow.currentState = configuration.target;
  workflow.pendingGate = null;
  workflow.completed = false;
  appendHistory("reopen", previousState, configuration.target, actor);
  workflow.history.at(-1).scope = scope;
  save();
  console.log(`Workflow reopened at ${configuration.target}: ${scope}`);
  process.exit(0);
}

const currentStage = stages[workflow.currentState];
if (!currentStage) throw new Error(`Unknown current state: ${workflow.currentState}`);

if (command === "advance") {
  if (currentStage.terminal) throw new Error("Workflow is already complete");
  if (currentStage.gate) throw new Error(`Gate ${workflow.currentState} requires approve or revise`);
  if (workflow.currentState === "intake") {
    if (!intakeResolved(workflow)) throw new Error("Intake requires explicit caption-mode and reference-script decisions");
    const projectPath = path.join(jobRoot, "state", "project.json");
    if (!fs.existsSync(projectPath)) throw new Error("Project state is missing");
    const project = readJson(projectPath);
    const sourcePath = path.resolve(jobRoot, project.sourceVideo ?? "");
    if (!fs.existsSync(sourcePath)) throw new Error("Resolved source media is missing");
    assertRegularContainedFile(path.join(jobRoot, "input"), sourcePath, "Source media");
    validateActiveReference(workflowPath, workflow);
  }
  if (currentStage.artifact && !artifact) throw new Error(`State ${workflow.currentState} requires --artifact`);
  if (currentStage.artifact) {
    const expectedDirectory = {
      transcription: "state",
      "rough-cut": "roughcut",
      "motion-plan": "docs",
      "visual-sample": "previews",
      composition: "hyperframes",
      qa: "previews",
      render: "output"
    }[workflow.currentState];
    const artifactPath = assertJobArtifact(artifact, expectedDirectory);
    if (workflow.currentState === "rough-cut") {
      if (path.resolve(jobRoot, artifact) !== path.join(jobRoot, "roughcut", "a-roll.mp4")) throw new Error("Rough cut must use roughcut/a-roll.mp4");
      const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
      probeReviewVideo(artifactPath, "Rough cut");
      runCheck("audit-roughcut-seams.mjs", [trimPlanPath, artifactPath], "Locked edit failed final-media seam measurement");
      runCheck("check-trim-plan.mjs", [trimPlanPath, "--require-audit", "--media", artifactPath], "Locked edit requires a complete seam audit");
      checkReconciliation(true, artifact);
      workflow.authoritativeMediaPath = artifact;
      workflow.authoritativeMediaSha256 = sha256File(artifactPath);
      workflow.trimPlanSha256 = sha256File(trimPlanPath);
    }
    if (workflow.currentState === "transcription") checkReconciliation(true);
    if (workflow.currentState === "motion-plan") {
      const motionPlan = fs.readFileSync(artifactPath, "utf8");
      const tableRows = motionPlan.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
      const hasCaptionMode = /(?:Caption mode|当前字幕模式).*?(?:motion-copy|subtitles)/i.test(motionPlan);
      if (tableRows.length < 3) throw new Error("Motion plan must contain at least one storyboard row");
      if (!hasCaptionMode) throw new Error("Motion plan must state the active caption mode");
      const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
      const confirmationDocPath = path.join(jobRoot, "docs", "creative-confirmation.md");
      const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
      if (!fs.existsSync(confirmationPath) || !fs.existsSync(confirmationDocPath)) {
        throw new Error("Motion plan requires a creative confirmation package");
      }
      const proposedConfirmation = readJson(confirmationPath);
      if (!workflow.visualAxisModeAcknowledged) {
        workflow.visualAxisMode = proposedConfirmation.visualAxisMode;
        workflow.visualAxisModeSource = "default";
      }
      if (!fs.existsSync(beatMapPath)) throw new Error("Motion plan requires state/beat-map.json");
      const transcriptPath = path.join(jobRoot, "state", "transcript.json");
      const designSystemPath = path.join(jobRoot, "state", "design-system.json");
      const visualPlanCheck = spawnSync(process.execPath, [path.join(scriptDirectory, "check-visual-plan.mjs"), beatMapPath, transcriptPath, designSystemPath], { encoding: "utf8" });
      if (visualPlanCheck.status !== 0) throw new Error(`Motion plan requires a valid beat map: ${visualPlanCheck.stderr.trim() || visualPlanCheck.stdout.trim()}`);
      workflow.visualPlanSha256 = sha256File(beatMapPath);
      checkReconciliation(true);
      recordCreativeAuthorities();
      const creativeConfirmationCheck = spawnSync(process.execPath, [path.join(scriptDirectory, "check-creative-confirmation.mjs"), confirmationPath, confirmationDocPath, beatMapPath, workflowPath], { encoding: "utf8" });
      if (creativeConfirmationCheck.status !== 0) throw new Error(`Motion plan requires a valid creative confirmation package: ${creativeConfirmationCheck.stderr.trim() || creativeConfirmationCheck.stdout.trim()}`);
      workflow.pendingCreativePackageSha256 = computePendingCreativePackageSha256(jobRoot, workflow.captionMode);
    }
    if (["visual-sample", "composition", "qa", "render"].includes(workflow.currentState)) {
      assertCreativeAuthorities(jobRoot, workflow);
      checkReconciliation(false);
    }
    if (workflow.currentState === "visual-sample") {
      probeReviewVideo(artifactPath, "Visual sample");
      validateVisualSampleReport(artifact);
    }
    if (workflow.currentState === "qa") {
      probeReviewVideo(artifactPath, "Final preview");
      validateFinalQa(artifact);
    }
    if (workflow.currentState === "render") {
      const canonicalDeliveryPath = path.join(jobRoot, "output", "final.mp4");
      if (workflow.lastKnownGoodDelivery
        && artifactPath === canonicalDeliveryPath
        && sha256File(artifactPath) !== workflow.lastKnownGoodDelivery.sha256) {
        throw new Error("A delivery revision must render to output/final.candidate.mp4 before replacing the last known-good file");
      }
      const delivery = probeReviewVideo(artifactPath, "Final delivery");
      probeReviewSignal(artifactPath, delivery.duration, "Final delivery");
      const previewRelativePath = workflow.gates?.["final-preview"]?.artifact;
      const previewPath = assertJobArtifact(previewRelativePath, "previews");
      const preview = probeReviewVideo(previewPath, "Final preview");
      if (delivery.width !== preview.width || delivery.height !== preview.height
        || Math.abs(delivery.fps - preview.fps) > 0.001
        || Math.abs(delivery.duration - preview.duration) > 1 / Math.max(preview.fps, 1)) {
        throw new Error("Final delivery metadata differs from the approved preview");
      }
      verifyEditorialMatch(artifactPath, previewPath);
      validateFinalQa(workflow.gates?.["final-preview"]?.artifact);
      if (artifactPath !== canonicalDeliveryPath) fs.renameSync(artifactPath, canonicalDeliveryPath);
      workflow.lastKnownGoodDelivery = {
        path: "output/final.mp4",
        sha256: sha256File(canonicalDeliveryPath),
        validatedAt: now
      };
    }
    if (workflow.currentState === "composition") {
      workflow.compositionArtifactPath = artifact;
      workflow.compositionArtifactSha256 = sha256File(artifactPath);
    }
  }
  if (workflow.currentState === "motion-plan" && !creativeReviewRequired()) {
    approveCreativePackage("Conditional creative review skipped because the plan contains no MG, motion-copy, B-axis treatment, or release-impact ambiguity", "agent");
    markGateSkipped("motion-plan-review", "No user-facing creative decision was required");
    continueAfterCreativeApproval("skip-creative-review", "agent");
    save();
    console.log(`Workflow state: ${workflow.currentState}`);
    process.exit(0);
  }
  const nextState = workflow.currentState === "transcription" && workflow.reconciliationReturnState
    ? workflow.reconciliationReturnState
    : currentStage.next;
  if (workflow.currentState === "transcription") workflow.reconciliationReturnState = null;
  move(nextState, "advance");
  if (workflow.mode === "auto" && stages[workflow.currentState]?.gate) autoApproveGate();
} else if (command === "approve") {
  if (!currentStage.gate) throw new Error(`State ${workflow.currentState} is not an approval gate`);
  if (!note) throw new Error(`Gate ${workflow.currentState} approval requires --note`);
  if (workflow.mode === "review" && actor !== "user") throw new Error("Review-mode approval requires actor user");
  validateGateArtifact(workflow.currentState);
  if (workflow.currentState === "motion-plan-review" && !workflow.captionModeAcknowledged) {
    throw new Error("Caption mode must be explicitly acknowledged before motion-plan approval");
  }
  if (workflow.currentState === "motion-plan-review"
    && ["b-axis-stage", "hybrid"].includes(workflow.visualAxisMode)
    && (!workflow.visualAxisModeAcknowledged || workflow.visualAxisModeSource !== "user")) {
    throw new Error("B-axis or hybrid plans require explicit user acknowledgement");
  }
  if (workflow.currentState === "motion-plan-review") approveCreativePackage(note, actor);
  if (workflow.currentState === "visual-sample-review" && !workflow.captionModeAcknowledged) {
    throw new Error("Caption mode must be explicitly acknowledged before composition");
  }
  workflow.gates[workflow.currentState] = {
    ...workflow.gates[workflow.currentState],
    status: "approved",
    decidedAt: now,
    actor,
    note
  };
  if (workflow.currentState === "motion-plan-review") {
    continueAfterCreativeApproval("approve", actor);
  } else {
    if (workflow.currentState === "visual-sample-review") {
      workflow.approvedVisualSampleFingerprint = computeVisualSampleFingerprint(jobRoot, workflow.captionMode);
    }
    move(currentStage.next, "approve");
  }
} else if (command === "revise") {
  if (!currentStage.gate) throw new Error(`State ${workflow.currentState} is not an approval gate`);
  workflow.gates[workflow.currentState] = {
    ...workflow.gates[workflow.currentState],
    status: "revision-requested",
    decidedAt: now,
    actor,
    note
  };
  if (["rough-cut-review", "motion-plan-review"].includes(workflow.currentState)) {
    beginWorkflowRevision(workflow, now, note ?? `${workflow.currentState} revision requested`);
  }
  move(currentStage.revise, "revise");
  if (workflow.currentState === "motion-plan") invalidateCreativeConfirmation();
} else {
  throw new Error(`Unknown command: ${command}`);
}

save();
console.log(`Workflow state: ${workflow.currentState}`);
