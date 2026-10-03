import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertRegularContainedFile,
  beginWorkflowRevision,
  collectCreativeAuthorityDrift,
  collectWorkflowDrift,
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  ensureWorkflowDefaults,
  invalidateCreativeArtifacts,
  jobRootForWorkflow,
  readJson,
  recoverTranscriptTransaction,
  saveWorkflow,
  sha256File,
  validateActiveReference,
  visualPlanChanges,
  writeJsonAtomic
} from "./workflow-utils.mjs";
import { buildComposition } from "./build-composition.mjs";

const [workflowPath, command, ...rawArguments] = process.argv.slice(2);

if (!workflowPath || !command) {
  console.error("Usage: node workflow-state.mjs <workflow.json> <status|verify|advance|review-cut|lock-transcript|approve|revise|fallback-auto|replan|reopen|set-mode|set-caption-mode|set-axis-mode> [value] [--actor name] [--artifact path] [--note text]\nreview-cut --project-id <id> --timeline-id <id> records a ChatCut cut for listening; lock-transcript binds state/transcript.json after review.");
  process.exit(64);
}

const stages = {
  intake: { next: "transcription" },
  transcription: { next: "rough-cut", artifact: true },
  "rough-cut": { next: "rough-cut-review", artifact: true },
  "rough-cut-review": { gate: true, next: "rough-cut-export", revise: "rough-cut" },
  "rough-cut-export": { next: "motion-plan", artifact: true },
  "motion-plan": { next: "composition", artifact: true },
  composition: { next: "render", artifact: true },
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
const workflow = ensureWorkflowDefaults(JSON.parse(fs.readFileSync(workflowPath, "utf8")));
const initialState = workflow.currentState;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowGuideSections = {
  intake: "intake",
  transcription: "transcript-and-alignment",
  "rough-cut": "rough-cut",
  "rough-cut-review": "rough-cut-review-and-export",
  "rough-cut-export": "rough-cut-review-and-export",
  "motion-plan": "motion-plan",
  composition: "composition",
  render: "delivery",
  complete: "revisions"
};
const printStageGuideHint = (state) => {
  const section = workflowGuideSections[state];
  if (section) console.error(`Stage guidance: docs/workflow.md#${section}`);
};
const actor = String(options.actor ?? (["advance", "review-cut", "lock-transcript"].includes(command) ? "agent" : "user"));
const artifact = command === "review-cut" ? "state/chatcut-roughcut.json" : options.artifact ? String(options.artifact) : null;
const note = options.note ? String(options.note) : null;
const now = new Date().toISOString();
const visualBaselinePath = path.join(jobRoot, "state", "visual-plan-baseline.json");
let pendingVisualBaseline = null;

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

const runCheck = (scriptName, argumentsList, failurePrefix) => {
  const result = spawnSync(process.execPath, [path.join(scriptDirectory, scriptName), ...argumentsList], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${failurePrefix}: ${result.stderr.trim() || result.stdout.trim()}`);
};

const reconciliationPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
const sourceTranscriptPath = path.join(jobRoot, "state", "source-transcript.json");
const checkReconciliation = (allowPending, expectedMedia = null) => {
  if (!fs.existsSync(reconciliationPath)) throw new Error("Transcript reconciliation is missing");
  runCheck(
    "check-transcript-reconciliation.mjs",
    [reconciliationPath, ...(allowPending ? ["--allow-review-pending"] : []), ...(expectedMedia ? ["--expected-media", expectedMedia] : [])],
    "Transcript reconciliation failed"
  );
};

const lockRoughCutMedia = (artifactPath, { audit = false, trimPlanAudit = false, requirePromotion = false } = {}) => {
  const mediaPath = path.relative(jobRoot, artifactPath);
  const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");

  probeReviewVideo(artifactPath, "Rough-cut export");
  const mediaSha256 = sha256File(artifactPath);
  const projectForLock = readJson(path.join(jobRoot, "state", "project.json"));
  if (workflow.sourceTranscriptSha256 || projectForLock.roughCutEngine !== "chatcut") assertSourceTranscriptLock();

  if (requirePromotion) {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    const recorded = project.mediaArtifacts?.roughcut;
    if (recorded?.path !== mediaPath || recorded.sha256 !== mediaSha256) {
      throw new Error("Rough-cut export must be promoted after the ChatCut review");
    }
  }

  if (audit) {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    checkReconciliation(true, project.sourceVideo);
  }

  if (trimPlanAudit) {
    runCheck("finalize-trim-plan.mjs", [
      trimPlanPath,
      artifactPath,
      "--expected-source-transcript-sha",
      workflow.sourceTranscriptSha256
    ], "Automatic rough-cut fallback failed canonical trim finalization");
    assertSourceTranscriptLock();
    runCheck("check-trim-plan.mjs", [trimPlanPath, "--require-audit", "--media", artifactPath], "Automatic rough-cut fallback requires a complete seam audit");
  }

  workflow.authoritativeMediaPath = mediaPath;
  workflow.authoritativeMediaSha256 = mediaSha256;
  workflow.trimPlanSha256 = sha256File(trimPlanPath);
};

const assertSourceTranscriptLock = () => {
  if (!workflow.sourceTranscriptSha256) throw new Error("Source transcript has not been locked");
  assertRegularContainedFile(path.join(jobRoot, "state"), sourceTranscriptPath, "Source transcript");
  if (sha256File(sourceTranscriptPath) !== workflow.sourceTranscriptSha256) {
    throw new Error("Source transcript changed after its timeline lock");
  }
};
const lockSourceTranscript = (transcriptPath) => {
  if (workflow.sourceTranscriptSha256) {
    assertSourceTranscriptLock();
    return;
  }
  if (fs.existsSync(sourceTranscriptPath)) {
    if (sha256File(sourceTranscriptPath) !== sha256File(transcriptPath)) {
      throw new Error("Unbound source transcript differs from the incoming transcript");
    }
  } else {
    writeJsonAtomic(sourceTranscriptPath, readJson(transcriptPath));
  }
  workflow.sourceTranscriptSha256 = sha256File(sourceTranscriptPath);
};

const assertJobArtifact = (relativePath, expectedDirectory) => {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error("Artifacts must use a job-relative path");
  const absolutePath = path.resolve(jobRoot, relativePath);
  assertRegularContainedFile(path.join(jobRoot, expectedDirectory), absolutePath, "Workflow artifact");
  return absolutePath;
};

const validateChatcutRoughCutRecord = (recordedArtifactPath) => {
  const record = readJson(recordedArtifactPath);
  if (record.schemaVersion !== "1.0.0") throw new Error("ChatCut rough-cut record must use schemaVersion 1.0.0");
  if (record.source !== "chatcut") throw new Error("ChatCut rough-cut record must identify ChatCut as its source");
  if (typeof record.projectId !== "string" || !record.projectId.trim()) {
    throw new Error("ChatCut rough-cut record requires a projectId");
  }
  if (!Array.isArray(record.timelineIds) || record.timelineIds.length === 0
    || record.timelineIds.some((timelineId) => typeof timelineId !== "string" || !timelineId.trim())) {
    throw new Error("ChatCut rough-cut record requires at least one timelineId");
  }
  if (record.activeTimelineId != null && !record.timelineIds.includes(record.activeTimelineId)) {
    throw new Error("ChatCut rough-cut activeTimelineId must be listed in timelineIds");
  }
  if (typeof record.recordedAt !== "string" || !record.recordedAt.trim()) {
    throw new Error("ChatCut rough-cut record requires recordedAt");
  }
  return record;
};

const chatcutRoughCutArtifact = (relativePath) => relativePath === "state/chatcut-roughcut.json";

const probeReviewVideo = (videoPath, label) => {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", videoPath], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`${label} is not a readable media file`);
  const result = JSON.parse(probe.stdout || "{}");
  const duration = Number(result.format?.duration);
  if (!(duration > 0)) throw new Error(`${label} has no positive duration`);
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

const validateRoughCutReview = () => {
  const recordedArtifact = workflow.gates?.["rough-cut-review"]?.artifact;
  if (!recordedArtifact) throw new Error("Rough-cut review has no recorded artifact");
  const expectedDirectory = chatcutRoughCutArtifact(recordedArtifact) ? "state" : "roughcut";
  const recordedArtifactPath = assertJobArtifact(recordedArtifact, expectedDirectory);
  if (chatcutRoughCutArtifact(recordedArtifact)) {
    validateChatcutRoughCutRecord(recordedArtifactPath);
    if (workflow.sourceTranscriptSha256) assertSourceTranscriptLock();
    return;
  }
  probeReviewVideo(recordedArtifactPath, "Rough cut");
  assertSourceTranscriptLock();
  const trimPlanPath = path.join(jobRoot, "state", "trim-plan.json");
  if (!workflow.trimPlanSha256 || sha256File(trimPlanPath) !== workflow.trimPlanSha256) {
    throw new Error("Rough-cut trim audit changed after the locked edit was produced");
  }
  if (!workflow.authoritativeMediaSha256 || sha256File(recordedArtifactPath) !== workflow.authoritativeMediaSha256) {
    throw new Error("Rough-cut media changed after the locked edit was produced");
  }
};

const recordRoughCutDecision = (status, decision, entryActor, decisionNote) => {
  workflow.roughCutReviewDecision = decision;
  workflow.gates["rough-cut-review"] = {
    ...workflow.gates["rough-cut-review"],
    status,
    decidedAt: now,
    actor: entryActor,
    note: decisionNote
  };
};

const selectAutomaticFallback = (entryActor, decisionNote) => {
  validateRoughCutReview();
  acceptDeferredPreferences("auto");
  const warning = "Automatic export and validation may take a long time";
  recordRoughCutDecision("automatic-fallback", "automatic-fallback", entryActor, `${decisionNote} ${warning}.`);
  move("rough-cut-export", "automatic-fallback", entryActor);
  console.warn(`${warning}.`);
};
const save = () => {
  saveWorkflow(workflowPath, workflow, now);
  if (pendingVisualBaseline) {
    try { writeJsonAtomic(visualBaselinePath, pendingVisualBaseline); }
    catch { console.warn("Visual revision baseline could not be saved; future revisions will report unavailable prior field values."); }
  }
  if (workflow.currentState !== initialState) printStageGuideHint(workflow.currentState);
};

const invalidateCreativeConfirmation = () => {
  invalidateCreativeArtifacts(jobRoot);
};

const syncPreferenceArtifacts = (resetDocuments = false) => {
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  if (!fs.existsSync(confirmationPath)) return;
  const confirmation = readJson(confirmationPath);
  confirmation.captionMode = workflow.captionMode;
  confirmation.captionModeDecision = {
    status: workflow.captionModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.captionModeSource
  };
  confirmation.visualAxisMode = workflow.visualAxisMode;
  confirmation.visualAxisModeDecision = {
    status: workflow.visualAxisModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.visualAxisModeSource
  };
  confirmation.storyboard ??= {};
  if (workflow.captionMode === "subtitles") {
    confirmation.storyboard.captionPlan = "docs/caption-plan.md";
  } else {
    delete confirmation.storyboard.captionPlan;
  }
  writeJsonAtomic(confirmationPath, confirmation);
  if (!resetDocuments) return;
  const templates = path.join(scriptDirectory, "..", "templates", "job");
  fs.copyFileSync(
    path.join(templates, workflow.captionMode === "subtitles" ? "creative-confirmation.md" : "creative-confirmation.motion-copy.md"),
    path.join(jobRoot, "docs", "creative-confirmation.md")
  );
  const captionPlanPath = path.join(jobRoot, "docs", "caption-plan.md");
  if (workflow.captionMode === "subtitles") fs.copyFileSync(path.join(templates, "caption-plan.md"), captionPlanPath);
  else if (fs.existsSync(captionPlanPath)) fs.unlinkSync(captionPlanPath);
};

const acceptDeferredPreferences = (decisionSource) => {
  validateActiveReference(workflowPath, workflow);
  let changed = false;
  if (!workflow.captionModeAcknowledged) {
    workflow.captionModeAcknowledged = true;
    workflow.captionModeSource = decisionSource;
    changed = true;
  }
  if (!workflow.visualAxisModeAcknowledged) {
    workflow.visualAxisModeAcknowledged = true;
    workflow.visualAxisModeSource = decisionSource;
    changed = true;
  }
  if (!workflow.referenceScriptAcknowledged) {
    workflow.referenceScriptAcknowledged = true;
    changed = true;
  }
  if (!changed) return;
  syncPreferenceArtifacts();
  appendHistory(
    "accept-deferred-preferences",
    workflow.currentState,
    workflow.currentState,
    decisionSource === "user" ? "user" : "agent"
  );
};

if (command === "status") {
  console.log(JSON.stringify(workflow, null, 2));
  printStageGuideHint(workflow.currentState);
  process.exit(0);
}

if (command === "verify") {
  const findings = collectWorkflowDrift(jobRoot, workflow);
  const settled = ["composition", "render", "complete"].includes(workflow.currentState);
  if (settled || workflow.currentState === "motion-plan") {
    findings.push(...collectCreativeAuthorityDrift(jobRoot, workflow));
  }
  if (findings.length === 0) {
    console.log(`Workflow fingerprints verified: ${workflow.currentState} (revision ${workflow.revisionId})`);
    process.exit(0);
  }
  for (const finding of findings) console.error(`Error: ${finding}`);
  console.error(`Workflow fingerprints no longer describe the job: ${findings.length} finding(s).`);
  process.exit(1);
}

if (command === "set-mode") {
  const mode = positionals[0];
  if (!["review", "auto"].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
  const previousMode = workflow.mode;
  workflow.mode = mode;
  appendHistory("set-mode", workflow.currentState, workflow.currentState, actor);
  if (mode === "auto" && workflow.currentState === "rough-cut-review") {
    selectAutomaticFallback("agent", "Automatic mode selected");
  }
  save();
  console.log(`Mode changed: ${previousMode} → ${workflow.mode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "set-caption-mode") {
  const captionMode = positionals[0];
  if (!["motion-copy", "subtitles"].includes(captionMode)) throw new Error(`Invalid caption mode: ${captionMode}`);
  const previousCaptionMode = workflow.captionMode;
  const previousState = workflow.currentState;
  const isRecommendation = actor === "agent";
  workflow.captionMode = captionMode;
  workflow.captionModeSource = isRecommendation ? "auto" : "user";
  workflow.captionModeAcknowledged = !isRecommendation;
  const planningOrLater = ["motion-plan", "composition", "render", "complete"].includes(previousState);
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  syncPreferenceArtifacts(!planningOrLater);
  if (previousCaptionMode !== captionMode && planningOrLater) {
    beginWorkflowRevision(workflow);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-caption-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-caption-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    }
  }
  save();
  console.log(`Caption mode changed: ${previousCaptionMode} → ${workflow.captionMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "set-axis-mode") {
  const axisMode = positionals[0];
  if (!["a-axis-overlay", "b-axis-stage", "hybrid"].includes(axisMode)) throw new Error(`Invalid visual axis mode: ${axisMode}`);
  const previousAxisMode = workflow.visualAxisMode;
  const previousState = workflow.currentState;
  const isRecommendation = actor === "agent";
  workflow.visualAxisMode = axisMode;
  workflow.visualAxisModeSource = isRecommendation ? "auto" : "user";
  workflow.visualAxisModeAcknowledged = !isRecommendation;
  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  syncPreferenceArtifacts();
  const planningOrLater = ["motion-plan", "composition", "render", "complete"].includes(previousState);
  if (previousAxisMode !== axisMode && planningOrLater) {
    beginWorkflowRevision(workflow);
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
    workflow.currentState = "motion-plan";
    workflow.pendingGate = null;
    appendHistory("set-axis-mode", previousState, "motion-plan", actor);
  } else {
    appendHistory("set-axis-mode", previousState, previousState, actor);
    if (fs.existsSync(confirmationPath) && readJson(confirmationPath).review?.status === "approved") {
      workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
    }
  }
  save();
  console.log(`Visual axis mode changed: ${previousAxisMode} → ${workflow.visualAxisMode}; current state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "replan") {
  if (!["motion-plan", "composition", "render"].includes(workflow.currentState)) {
    throw new Error(`State ${workflow.currentState} cannot return to motion-plan`);
  }
  if (!note) throw new Error("Replan requires --note");
  const previousState = workflow.currentState;
  beginWorkflowRevision(workflow);
  invalidateCreativeConfirmation();
  workflow.creativeConfirmationSha256 = null;
  workflow.creativeDocumentFingerprints = null;
  workflow.currentState = "motion-plan";
  workflow.pendingGate = null;
  appendHistory("replan", previousState, "motion-plan", actor);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "fallback-auto") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Automatic rough-cut fallback is only available at rough-cut-review");
  if (workflow.mode !== "auto" && actor !== "user") throw new Error("Automatic rough-cut fallback requires an explicit user decision");
  if (!note) throw new Error("Automatic rough-cut fallback requires --note");
  selectAutomaticFallback(actor, note);
  save();
  console.log(`Workflow state: ${workflow.currentState}`);
  process.exit(0);
}
if (command === "reopen") {
  const scope = positionals[0];
  const targets = {
    "rough-cut": "rough-cut",
    "motion-plan": "motion-plan",
    composition: "composition",
    delivery: "render"
  };
  const target = targets[scope];
  if (!target) throw new Error("Reopen scope must be rough-cut, motion-plan, composition, or delivery");
  const activeReviewCompositionRevision = scope === "composition"
    && ["composition", "render"].includes(workflow.currentState)
    && workflow.mode === "review"
    && workflow.roughCutReviewDecision !== "automatic-fallback";
  if (workflow.currentState !== "complete" && !activeReviewCompositionRevision) {
    throw new Error("Only a completed job or an active review-mode composition/render revision can be reopened");
  }
  if (actor !== "user") throw new Error("Reopen requires --actor user");
  if (!note) throw new Error("Reopen requires --note");
  const previousState = workflow.currentState;
  beginWorkflowRevision(workflow, { invalidateVisualPlan: ["rough-cut", "motion-plan"].includes(scope) });
  if (scope === "composition") {
    const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
    // Older jobs can establish a baseline only while their recorded plan still matches.
    if (fs.existsSync(beatMapPath) && workflow.visualPlanSha256 === sha256File(beatMapPath)) {
      pendingVisualBaseline = { sha256: workflow.visualPlanSha256, beatMap: readJson(beatMapPath) };
    }
  }
  if (scope === "rough-cut") {
    const project = readJson(path.join(jobRoot, "state", "project.json"));
    workflow.authoritativeMediaPath = project.sourceVideo;
    workflow.authoritativeMediaSha256 = null;
    workflow.trimPlanSha256 = null;
    workflow.gates["rough-cut-review"] = { status: "not-reached" };
    workflow.roughCutReviewDecision = "pending";
  }
  if (["rough-cut", "motion-plan"].includes(scope)) {
    invalidateCreativeConfirmation();
    workflow.creativeConfirmationSha256 = null;
    workflow.creativeDocumentFingerprints = null;
    workflow.visualPlanSha256 = null;
  }
  if (scope !== "delivery") {
    workflow.compositionArtifactPath = null;
    workflow.compositionArtifactSha256 = null;
  }
  workflow.currentState = target;
  workflow.pendingGate = null;
  workflow.completed = false;
  appendHistory("reopen", previousState, target, actor);
  workflow.history.at(-1).scope = scope;
  save();
  console.log(`Workflow reopened at ${target}: ${scope}`);
  process.exit(0);
}
// Hand off an editable cut without reconstructing its editing history.
if (command === "review-cut") {
  if (!["intake", "transcription", "rough-cut"].includes(workflow.currentState)) {
    throw new Error("review-cut requires intake, transcription or rough-cut; use revise/reopen for a settled cut");
  }
  const project = readJson(path.join(jobRoot, "state", "project.json"));
  assertRegularContainedFile(path.join(jobRoot, "input"), path.resolve(jobRoot, project.sourceVideo), "Source media");
  if (workflow.sourceTranscriptSha256) assertSourceTranscriptLock();
  const projectId = options["project-id"];
  const timelineId = options["timeline-id"];
  if (typeof projectId !== "string" || !projectId.trim() || typeof timelineId !== "string" || !timelineId.trim()) {
    throw new Error("review-cut requires --project-id <id> --timeline-id <id>");
  }
  writeJsonAtomic(path.join(jobRoot, artifact), {
    schemaVersion: "1.0.0", source: "chatcut", projectId,
    timelineIds: [timelineId], activeTimelineId: timelineId, recordedAt: now,
    ...(note ? { note } : {})
  });
  project.roughCutEngine = "chatcut";
  if (project.mediaArtifacts?.roughcut) delete project.mediaArtifacts.roughcut;
  writeJsonAtomic(path.join(jobRoot, "state", "project.json"), project);
  workflow.authoritativeMediaPath = null;
  workflow.authoritativeMediaSha256 = null;
  workflow.trimPlanSha256 = null;
  workflow.roughCutReviewDecision = "pending";
  move("rough-cut-review", "review-cut");
  workflow.reconciliationReturnState = null;
  if (workflow.mode === "auto") selectAutomaticFallback("agent", "Automatic mode selected");
  save();
  console.log(`${workflow.mode === "auto" ? "Automatic cut recorded" : "Ready for listening"}: https://app.chatcut.io/editor/${encodeURIComponent(projectId)}`);
  process.exit(0);
}

if (command === "lock-transcript") {
  if (!["transcription", "rough-cut", "rough-cut-export", "motion-plan"].includes(workflow.currentState)) {
    throw new Error("Lock the source transcript during editing or after the rough-cut decision");
  }
  const transcriptPath = assertJobArtifact("state/transcript.json", "state");
  const transcript = readJson(transcriptPath);
  if (!Array.isArray(transcript.segments) || !transcript.segments.length) throw new Error("Source transcript has no segments");
  lockSourceTranscript(transcriptPath);
  appendHistory("lock-transcript", workflow.currentState, workflow.currentState);
  save();
  console.log("Source transcript locked; reconciliation is generated during motion planning.");
  process.exit(0);
}

const currentStage = stages[workflow.currentState];
if (!currentStage) throw new Error(`Unknown current state: ${workflow.currentState}`);

if (command === "advance") {
  if (currentStage.terminal) throw new Error("Workflow is already complete");
  if (currentStage.gate) throw new Error(`Gate ${workflow.currentState} requires approve or revise`);
  if (workflow.currentState === "intake") {
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
      "rough-cut": chatcutRoughCutArtifact(artifact) ? "state" : "roughcut",
      "rough-cut-export": "roughcut",
      "motion-plan": "docs",
      composition: "hyperframes",
      render: "output"
    }[workflow.currentState];
    const artifactPath = workflow.currentState === "composition"
      ? path.resolve(jobRoot, artifact)
      : assertJobArtifact(artifact, expectedDirectory);
    if (workflow.currentState === "transcription") {
      const transcriptPath = path.join(jobRoot, "state", "transcript.json");
      if (artifactPath !== transcriptPath) throw new Error("Transcription must use state/transcript.json");
      lockSourceTranscript(transcriptPath);
    }
    if (workflow.currentState === "rough-cut") {
      if (chatcutRoughCutArtifact(artifact)) {
        const record = validateChatcutRoughCutRecord(artifactPath);
        const projectPath = path.join(jobRoot, "state", "project.json");
        const project = readJson(projectPath);
        if (project.roughCutEngine !== "chatcut") throw new Error("ChatCut rough-cut review requires project.roughCutEngine=chatcut");
        if (record.timelineIds.length === 0) throw new Error("ChatCut rough-cut review requires at least one timeline");
        if (workflow.sourceTranscriptSha256) assertSourceTranscriptLock();
        if (project.mediaArtifacts?.roughcut) {
          delete project.mediaArtifacts.roughcut;
          writeJsonAtomic(projectPath, project);
        }
        workflow.authoritativeMediaPath = null;
        workflow.authoritativeMediaSha256 = null;
        workflow.trimPlanSha256 = null;
      } else {
        if (path.resolve(jobRoot, artifact) !== path.join(jobRoot, "roughcut", "a-roll.mp4")) throw new Error("Rough cut must use roughcut/a-roll.mp4 or state/chatcut-roughcut.json");
        lockRoughCutMedia(artifactPath);
      }
      workflow.roughCutReviewDecision = "pending";
    }
    if (workflow.currentState === "rough-cut-export") {
      if (path.resolve(jobRoot, artifact) !== path.join(jobRoot, "roughcut", "a-roll.mp4")) {
        throw new Error("Rough-cut export must use roughcut/a-roll.mp4");
      }
      if (!["automatic-fallback", "manual-approved"].includes(workflow.roughCutReviewDecision)) {
        throw new Error("Rough-cut export requires manual approval or an explicit automatic fallback");
      }
      const reviewArtifact = workflow.gates?.["rough-cut-review"]?.artifact;
      const isChatCutRoughCut = chatcutRoughCutArtifact(reviewArtifact);
      const project = readJson(path.join(jobRoot, "state", "project.json"));
      lockRoughCutMedia(artifactPath, {
        audit: workflow.roughCutReviewDecision === "automatic-fallback" && !isChatCutRoughCut,
        trimPlanAudit: workflow.roughCutReviewDecision === "automatic-fallback" && project.roughCutEngine === "ffmpeg-fallback" && !isChatCutRoughCut,
        requirePromotion: isChatCutRoughCut
      });
    }
    if (workflow.currentState === "motion-plan") {
      if (workflow.sourceTranscriptSha256) assertSourceTranscriptLock();
      const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
      const confirmationDocPath = path.join(jobRoot, "docs", "creative-confirmation.md");
      const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
      if (!fs.existsSync(confirmationPath) || !fs.existsSync(confirmationDocPath)) {
        throw new Error("Motion plan requires a creative confirmation package");
      }
      if (!fs.existsSync(beatMapPath)) throw new Error("Motion plan requires state/beat-map.json");
      // Keep the baseline for explicit diagnostics and revision history; it is
      // not a delivery gate. Structural caption checks and the composition
      // build validate the artifacts that directly affect the rendered video.
      workflow.visualPlanSha256 = sha256File(beatMapPath);
      pendingVisualBaseline = { sha256: workflow.visualPlanSha256, beatMap: readJson(beatMapPath) };
    }
    if (workflow.currentState === "composition") {
      const generatedCompositionPath = path.join(jobRoot, "hyperframes", "index.html");
      if (artifactPath !== generatedCompositionPath) {
        throw new Error("Composition advance requires hyperframes/index.html");
      }
      const beatMapPath = path.join(jobRoot, "state", "beat-map.json");
      if (!fs.existsSync(beatMapPath)) throw new Error("Composition requires state/beat-map.json");
      const beatMapSha256 = sha256File(beatMapPath);
      buildComposition(path.join(jobRoot, "hyperframes"));
      assertRegularContainedFile(path.join(jobRoot, "hyperframes"), generatedCompositionPath, "Built composition");
      const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
      const confirmation = readJson(confirmationPath);
      confirmation.authorities = computeCreativeAuthorities(jobRoot, workflow.captionMode);
      writeJsonAtomic(confirmationPath, confirmation);
      if (workflow.creativeConfirmationSha256) workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
      workflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(jobRoot, workflow.captionMode);
      const beatMap = readJson(beatMapPath);
      if (workflow.visualPlanSha256 !== beatMapSha256) {
        let baseline = null;
        try { baseline = readJson(visualBaselinePath); } catch { /* Legacy job or missing optional baseline. */ }
        const baselineAvailable = Boolean(workflow.visualPlanSha256 && baseline?.sha256 === workflow.visualPlanSha256
          && Array.isArray(baseline?.beatMap?.beats)
          && baseline.beatMap.beats.every((beat) => beat && typeof beat.id === "string"));
        const changes = baselineAvailable ? visualPlanChanges(baseline.beatMap, beatMap) : null;
        if (!baselineAvailable || changes.length) {
          appendHistory("visual-plan-change", "composition", "composition");
          Object.assign(workflow.history.at(-1), {
            beforeSha256: workflow.visualPlanSha256,
            afterSha256: beatMapSha256,
            baselineAvailable,
            changes,
            requestNote: workflow.history.findLast((entry) => entry.action === "reopen" && entry.revisionId === workflow.revisionId)?.note ?? null
          });
          console.log(baselineAvailable
            ? `Visual revision recorded: ${changes.map((change) => `${change.beatId ?? "plan"} (${change.change}: ${Object.keys(change.fields ?? {}).join(", ")})`).join("; ")}`
            : "Visual revision recorded: prior field values unavailable for this older job; current baseline saved.");
        }
      }
      pendingVisualBaseline = { sha256: beatMapSha256, beatMap };
      workflow.visualPlanSha256 = beatMapSha256;
    }
    if (workflow.currentState === "render") {
      const canonicalDeliveryPath = path.join(jobRoot, "output", "final.mp4");
      const delivery = probeReviewVideo(artifactPath, "Final delivery");
      const receiptPath = `${artifactPath}.render.json`;
      if (artifactPath === canonicalDeliveryPath) {
        if (workflow.lastKnownGoodDelivery && sha256File(artifactPath) !== workflow.lastKnownGoodDelivery.sha256) {
          throw new Error("A delivery revision must render to output/final.candidate.mp4 before replacing the last known-good file");
        }
      } else {
        if (path.basename(artifactPath) !== "final.candidate.mp4") {
          throw new Error("A delivery revision must use output/final.candidate.mp4");
        }
        fs.renameSync(artifactPath, canonicalDeliveryPath);
        if (fs.existsSync(receiptPath)) fs.renameSync(receiptPath, `${canonicalDeliveryPath}.render.json`);
      }
      workflow.lastKnownGoodDelivery = {
        path: "output/final.mp4",
        sha256: sha256File(canonicalDeliveryPath),
        validatedAt: now
      };
      if (!(delivery.duration > 0)) throw new Error("Final delivery has no positive duration");
    }
    if (workflow.currentState === "composition") {
      workflow.compositionArtifactPath = artifact;
      workflow.compositionArtifactSha256 = sha256File(artifactPath);
    }
  }
  let nextState = currentStage.next;
  if (workflow.currentState === "transcription" && workflow.reconciliationReturnState) {
    nextState = workflow.reconciliationReturnState;
  }
  if (workflow.currentState === "transcription") workflow.reconciliationReturnState = null;
  if (workflow.currentState === "rough-cut" && workflow.mode === "auto") {
    move("rough-cut-review", "advance");
    selectAutomaticFallback("agent", "Automatic mode selected");
  } else {
    move(nextState, "advance");
  }
} else if (command === "approve") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Only the ChatCut rough-cut review can be approved");
  if (workflow.mode === "review" && actor !== "user") throw new Error("Review-mode approval requires actor user");
  validateRoughCutReview();
  // Recheck only the supplied immutable reference snapshot at its consumption
  // boundary; no preference acknowledgement is required for the default none.
  validateActiveReference(workflowPath, workflow);
  recordRoughCutDecision("approved", "manual-approved", actor, note || "User approved the complete rough cut");
  move("rough-cut-export", "approve");
} else if (command === "revise") {
  if (workflow.currentState !== "rough-cut-review") throw new Error("Only the ChatCut rough-cut review can be revised");
  const review = workflow.gates["rough-cut-review"];
  workflow.gates["rough-cut-review"] = { ...review, status: "revision-requested", decidedAt: now, actor, note };
  beginWorkflowRevision(workflow);
  workflow.roughCutReviewDecision = "pending";
  move("rough-cut", "revise");
} else {
  throw new Error(`Unknown command: ${command}`);
}
save();
console.log(`Workflow state: ${workflow.currentState}`);
if (workflow.currentState === "rough-cut-review") {
  console.log("Deliver the ChatCut project link and current duration now; report any skipped operation, then wait for the user's listening decision.");
}
