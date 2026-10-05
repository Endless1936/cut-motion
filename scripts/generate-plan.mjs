#!/usr/bin/env node
/**
 * Generate every motion-plan artifact for a job from a single editorial input.
 *
 *   node scripts/generate-plan.mjs <job-directory> [--write] [--replace-existing]
 *
 * Input : state/planning-inputs.json (the only hand-authored file of this stage)
 * Output: state/transcript.json              (released timeline, revision 2)
 *         captions/caption-lexicon.json
 *         captions/caption-review-plan.json
 *         state/beat-map.json
 *         captions/chatcut-pages.json
 *         state/timeline-source-words.json
 *         state/transcript-reconciliation.json
 *         state/creative-confirmation.json
 *         docs/motion-plan.md
 *         docs/caption-plan.md              (via render-caption-review-doc.mjs)
 *         docs/creative-confirmation.md
 *
 * Without --write it prints the plan and touches nothing. Archived ChatCut
 * jobs can opt into their locked source-word timing with --legacy-source-timing.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, REAPPROVAL_FIELD_NAMES, sha256File, sha256Text, writeJsonAtomic } from "./workflow-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";
import { chatcutPages, normalizeCaptionCards } from "./chatcut-caption-data.mjs";
import {
  buildBeatMap,
  buildCaptionPlan,
  buildMainTimelineTranscript,
  buildReconciliationItems,
  buildReleasedTranscript,
  buildSourceWordEvidence
} from "./plan-artifacts.mjs";
import { renderCreativeConfirmationDoc, renderMotionPlanDoc } from "./render-plan-docs.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const [jobArgument, ...flags] = process.argv.slice(2);
if (!jobArgument) {
  console.error("Usage: node scripts/generate-plan.mjs <job-directory> [--outline (legacy) | --legacy-source-timing | --write [--replace-existing]]");
  process.exit(64);
}
const write = flags.includes("--write");
const jobRoot = path.resolve(jobArgument);
const read = (relative) => readJson(path.join(jobRoot, relative));
const rel = (relative) => path.join(jobRoot, relative);
const require_ = (relative) => {
  const absolute = rel(relative);
  if (!fs.existsSync(absolute)) throw new Error(`missing required input: ${relative}`);
  return absolute;
};

// Legacy source-word outline for older jobs; the normal ChatCut route uses main-timeline item ranges.
if (flags.includes("--outline")) {
  const workflow = read("state/workflow.json");
  const project = read("state/project.json");
  const inputs = fs.existsSync(rel("state/planning-inputs.json")) ? read("state/planning-inputs.json") : {};
  if (workflow.sourceTranscriptSha256 && workflow.sourceTranscriptSha256 !== sha256File(rel("state/source-transcript.json"))) throw new Error("Locked source transcript changed");
  const transcript = inputs.releasedTranscript
    ? { ...read("state/transcript.json"), ...inputs.releasedTranscript }
    : buildReleasedTranscript({
    sourceTranscript: read("state/source-transcript.json"), timelineWindows: read("state/timeline-source-windows.json"),
    fps: project.fps ?? inputs.fps ?? 30, corrections: inputs.corrections ?? {},
    revision: inputs.revision ?? 2, language: project.language ?? "zh-CN"
  });
  writeJsonAtomic(rel("state/planning-outline.json"), {
    ...transcript,
    segments: transcript.segments.map((s) => ({ ...s,
      words: s.words.map((w, i) => ({ ...w, index: i + 1, id: `${s.id}:word-${String(i + 1).padStart(3, "0")}` }))
    }))
  });
  console.log("Wrote legacy source-word planning outline. Standard ChatCut plans use the approved main-timeline snapshot instead.");
  process.exit(0);
}

require_("state/planning-inputs.json");
const inputs = read("state/planning-inputs.json");
const workflow = read("state/workflow.json");
const project = read("state/project.json");
const designSystem = read(project.designSystem ?? "state/design-system.json");
const mainTimelinePath = rel("state/chatcut-main-timeline.json");
const mainTimelineSnapshot = fs.existsSync(mainTimelinePath) ? read("state/chatcut-main-timeline.json") : null;
const useMainTimeline = mainTimelineSnapshot !== null;
const useLegacySourceTiming = !useMainTimeline && (project.roughCutEngine === "ffmpeg-fallback" || flags.includes("--legacy-source-timing"));
if (!useMainTimeline && !useLegacySourceTiming) {
  throw new Error('Save the approved ChatCut preview_timeline({views:["transcript"]}) response to state/chatcut-main-timeline.json, then run generate-plan.mjs again. Archived source-word jobs can use --legacy-source-timing.');
}
const firstMainPage = chatcutPages(mainTimelineSnapshot)[0];
const mainTimelineState = firstMainPage?.state ?? {};
const timelineId = useMainTimeline
  ? (mainTimelineState.timelineId ?? mainTimelineState.id ?? inputs.timelineId)
  : (inputs.timelineId ?? mainTimelineState.timelineId ?? mainTimelineState.id);
const sourceTranscript = useMainTimeline ? null : read("state/source-transcript.json");
if (!useMainTimeline && workflow.sourceTranscriptSha256 && workflow.sourceTranscriptSha256 !== sha256File(rel("state/source-transcript.json"))) {
  throw new Error("Source transcript changed after its workflow lock; restore the locked source transcript before generating plans.");
}
const timelineWindows = useMainTimeline ? null : read("state/timeline-source-windows.json");
const annotationState = read("state/reference-script-annotations.json");

const fps = mainTimelineState.fps ?? firstMainPage?.fps ?? project.fps ?? inputs.fps ?? 30;
// The workflow is the single source of truth; do not block plan generation on
// a stale duplicate copied into planning-inputs.json.
const captionMode = workflow.captionMode;
const corrections = inputs.corrections ?? {};

// ---------------------------------------------------------------- artifacts
const baseReleased = useMainTimeline
  ? buildMainTimelineTranscript({ snapshot: mainTimelineSnapshot, fps, corrections, revision: inputs.revision ?? 2, language: project.language ?? "zh-CN" })
  : buildReleasedTranscript({ sourceTranscript, timelineWindows, fps, corrections, revision: inputs.revision ?? 2, language: project.language ?? "zh-CN" });
const released = !useMainTimeline && inputs.releasedTranscript ? { ...baseReleased, ...inputs.releasedTranscript } : baseReleased;
const captionData = inputs.captionTimingPath ? normalizeCaptionCards(read(inputs.captionTimingPath), { fps,
  timelineId, projectId: firstMainPage?.projectId }) : undefined;

const captionPlan = buildCaptionPlan({
  transcript: released,
  transcriptSha256: sha256Text(serializeJson(released)),
  captionCues: inputs.captionCues,
  captionData,
  captionEdits: inputs.captionEdits,
  corrections,
  fps,
  cueLines: inputs.cueLines,
  ...(inputs.captionCues !== undefined ? {
    timingAuthority: useMainTimeline
      ? "agent-authored cue ranges within approved ChatCut main timeline item ranges"
      : "agent-authored cue ranges within transcript segment ranges",
    segmentationAuthority: useMainTimeline
      ? "agent-authored phrase cues within ChatCut main timeline entries"
      : "agent-authored phrase cues within transcript segments"
  } : useMainTimeline ? {
    timingAuthority: inputs.captionEdits
      ? "existing measured word/card boundaries; unmatched phrase timing allocated within parent frames for captions only"
      : "approved ChatCut main timeline item ranges",
    segmentationAuthority: inputs.captionEdits ? "agent-authored sparse phrases" : "ChatCut main timeline transcript entries"
  } : {}),
  lexicon: inputs.lexicon ?? {},
  rules: inputs.cueRules ?? {},
  exceptions: inputs.cueExceptions ?? {},
  status: inputs.captionStatus ?? "approved"
});

const cues = resolveCaptionCues(captionPlan, released);
const beatMap = buildBeatMap({
  transcript: released,
  beats: inputs.beats,
  captionMode,
  designSystemPath: project.designSystem ?? "state/design-system.json",
  designSystem,
  fps
});
for (const beat of beatMap.beats) {
  if (beat.mgScope === "local" && !beat.captionCueIds) {
    beat.captionCueIds = cues.filter((cue) => cue.end > beat.start && cue.start < beat.end).map((cue) => cue.id);
    if (beat.captionCueIds.length === 0) throw new Error(`${beat.id}: no caption cue overlaps this local MG beat`);
  }
}

const evidence = useMainTimeline
  ? { rows: [], entries: [] }
  : buildSourceWordEvidence({ sourceTranscript, timelineWindows, releasedTranscript: released, fps, corrections });
const existingReconciliation = fs.existsSync(rel("state/transcript-reconciliation.json")) ? read("state/transcript-reconciliation.json") : {};
const reconciliationItems = buildReconciliationItems({ transcript: released, corrections, plan: inputs.reconciliation ?? {}, sourceTranscript, existingItems: existingReconciliation.items ?? [], previousTranscript: fs.existsSync(rel("state/transcript.json")) ? read("state/transcript.json") : undefined });
const referenceItemIds = reconciliationItems.filter((item) => item.referenceText).map((item) => item.id);
const previousReferenceOrder = existingReconciliation.referenceScript?.itemOrder
  ?? (existingReconciliation.items ?? []).filter((item) => item.referenceText).map((item) => item.id);
const referenceItemOrder = [...previousReferenceOrder.filter((id) => referenceItemIds.includes(id)), ...referenceItemIds.filter((id) => !previousReferenceOrder.includes(id))];
const cleanExportPath = project.mediaArtifacts?.roughcut?.path ?? "roughcut/a-roll.mp4";
const sourceMediaPath = project.sourceVideo ?? "input/source.mp4";
const fingerprintPath = fs.existsSync(rel(sourceMediaPath)) ? sourceMediaPath : cleanExportPath;
require_(fingerprintPath);
const mediaFingerprint = sha256File(rel(fingerprintPath));
const roughCutLocked = ["manual-approved", "automatic-fallback"].includes(workflow.roughCutReviewDecision);
const reconciliation = {
  $schema: "../../../schemas/transcript-reconciliation.schema.json",
  schemaVersion: "1.0.0",
  mediaFingerprint,
  transcriptRevision: released.revision ?? 1,
  referenceScript: {
    status: workflow.referenceScriptStatus ?? "none",
    path: workflow.referenceScriptPath ?? null,
    sha256: workflow.referenceScriptSha256 ?? null,
    ...(workflow.referenceScriptStatus === "provided" ? { itemOrder: referenceItemOrder } : {})
  },
  items: reconciliationItems,
  verification: {
    audioChecked: reconciliationItems.every((item) => item.evidence.audioChecked === true),
    mediaPath: fingerprintPath,
    mediaFingerprintMatches: true,
    transcriptRevisionMatches: true,
    unresolvedReleaseImpactCount: reconciliationItems.filter((item) => item.resolution === "unresolved" && item.releaseImpact === true).length
  }
};

const documents = { ...inputs.documents, annotationDecisions: inputs.annotationDecisions ?? [], mediaPath: cleanExportPath };
const motionPlanDoc = renderMotionPlanDoc({
  jobId: project.id ?? path.basename(jobRoot),
  captionMode,
  visualAxisMode: workflow.visualAxisMode ?? "a-axis-overlay",
  transcript: released,
  beatMap,
  cues,
  designSystem,
  extra: documents
});
const creativeConfirmationDoc = renderCreativeConfirmationDoc({
  jobId: project.id ?? path.basename(jobRoot),
  workflow: { ...workflow, captionMode },
  beatMap,
  cues,
  transcript: released,
  reconciliation,
  annotationState,
  extra: documents
});
const creativeConfirmation = {
  $schema: "../../../schemas/creative-confirmation.schema.json",
  schemaVersion: "1.0.0",
  captionMode,
  captionModeDecision: {
    status: workflow.captionModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.captionModeSource ?? "default"
  },
  visualAxisMode: workflow.visualAxisMode ?? "a-axis-overlay",
  visualAxisModeDecision: {
    status: workflow.visualAxisModeAcknowledged ? "acknowledged" : "default-proposed",
    source: workflow.visualAxisModeSource ?? "default"
  },
  storyboard: {
    motionPlan: "docs/motion-plan.md",
    ...(captionMode === "subtitles" ? { captionPlan: "docs/caption-plan.md" } : {}),
    beatMap: "state/beat-map.json",
    beatCount: beatMap.beats.length
  },
  scriptAnnotations: {
    source: "state/reference-script-annotations.json",
    role: "advisory",
    exhaustiveVisualPlan: false,
    decisions: inputs.annotationDecisions ?? []
  },
  authorities: {},
  changeControl: {
    implementationMayStartAfter: "rough-cut-review-approved",
    planChangesRequireReapproval: false,
    reapprovalFields: [...REAPPROVAL_FIELD_NAMES]
  },
  axisPolicy: inputs.axisPolicy ?? {
    A: {
      accumulation: "replace",
      overlayZones: designSystem.axisPolicies.A.overlayZones,
      faceProtection: designSystem.axisPolicies.A.faceCoverPolicy,
      surface: {
        kind: "localized-glass",
        fullFrame: false,
        opacityRange: designSystem.axisPolicies.A.surface.opacityRange,
        backdropBlurPx: inputs.backdropBlurPx ?? 14
      }
    },
    B: {
      accumulation: "accumulate",
      groupedExit: true,
      pip: {
        live: true,
        protected: true,
        exclusionZone: designSystem.axisPolicies.B.pipExclusionZone
      }
    }
  },
  review: { status: inputs.reviewStatus ?? "ready", ...(inputs.reviewNote ? { note: inputs.reviewNote } : {}) }
};

// --------------------------------------------------------------- summary
const localBeats = beatMap.beats.filter((beat) => beat.mgScope === "local");
console.log(`job            ${path.basename(jobRoot)}`);
console.log(`caption mode   ${captionMode}`);
console.log(`released       ${released.segments.length} ChatCut transcript segments / ${released.duration}s`);
console.log(`captions       ${captionPlan.cues.length} cues, ${captionPlan.cues.filter((cue) => cue.text.length > 0).length} non-empty`);
console.log(`beats          ${beatMap.beats.length} (${localBeats.length} local MG)`);
for (const beat of localBeats) console.log(`  ${beat.id}  ${beat.start.toFixed(2)}-${beat.end.toFixed(2)}  cues ${beat.captionCueIds.join(",")}`);
console.log(`timing source  ${useMainTimeline ? "approved ChatCut main timeline" : `${evidence.rows.length} source-word rows`}`);
console.log(`reconciliation ${reconciliation.items.length} items (${reconciliation.items.filter((i) => i.type === "asr-correction").length} asr-correction)`);

if (!write) {
  console.log("\n(dry run — pass --write to emit the artifacts)");
  process.exit(0);
}

// ------------------------------------------------------------------ emit
const outputs = new Map();
const json = (name, value) => outputs.set(name, serializeJson(value));
json("state/transcript.json", released);
json("captions/caption-lexicon.json", inputs.lexicon ?? {});
json("captions/caption-review-plan.json", captionPlan);
json("state/beat-map.json", beatMap);
if (!useMainTimeline) json("state/timeline-source-words.json", { schemaVersion: "1.0.0", fps, entries: evidence.entries });
json("captions/chatcut-pages.json", {
  source: useMainTimeline ? "chatcut-viewer-pages" : "ChatCut inspect_asset original source word rows",
  fps,
  cleanExport: cleanExportPath,
  timelineVersion: `chatcut-timeline-${timelineId ?? "unknown"}`,
  roughCutLocked,
  ...(typeof inputs.cleanExport?.captionRenderDisabled === "boolean"
    ? { captionRenderDisabled: inputs.cleanExport.captionRenderDisabled }
    : {}),
  ...(useMainTimeline
    ? { pages: released.segments.map((segment) => ({
      id: segment.id,
      startFrame: Math.round(segment.start * fps),
      endFrame: Math.round(segment.end * fps),
      viewerText: segment.text
    })) }
    : {
      rows: evidence.rows,
      timelineMapping: "state/timeline-source-words.json",
      timelineMappingSha256: sha256Text(outputs.get("state/timeline-source-words.json"))
    })
});
json("state/transcript-reconciliation.json", reconciliation);
outputs.set("docs/motion-plan.md", motionPlanDoc);
outputs.set("docs/creative-confirmation.md", creativeConfirmationDoc);

creativeConfirmation.authorities = Object.fromEntries(
  Object.entries({
    transcript: "state/transcript.json",
    beatMap: "state/beat-map.json",
    ...(captionMode === "subtitles" ? { captionPlan: "captions/caption-review-plan.json" } : {})
  }).map(([name, relativePath]) => [name, { path: relativePath, sha256: sha256Text(outputs.get(relativePath)) }])
);
json("state/creative-confirmation.json", creativeConfirmation);

// Render into a private staging directory before touching any live output.
const staging = fs.mkdtempSync(rel(".planning-stage-"));
const manifestPath = "state/planning-generated.json";
const managed = fs.existsSync(rel(manifestPath)) ? read(manifestPath).files ?? {} : {};
const scaffoldFile = {
  "docs/motion-plan.md": "motion-plan.md",
  "docs/caption-plan.md": "caption-plan.md",
  "docs/creative-confirmation.md": captionMode === "motion-copy" ? "creative-confirmation.motion-copy.md" : "creative-confirmation.md",
  "captions/caption-lexicon.json": "caption-lexicon.json"
};
const unchangedScaffold = (name, old) => {
  const template = scaffoldFile[name];
  if (template) return old === fs.readFileSync(path.join(scriptDirectory, "../templates/job", template), "utf8");
  if (name === "state/transcript.json") return ["rough-cut-export", "motion-plan", "composition"].includes(workflow.currentState)
    && (useMainTimeline || (workflow.sourceTranscriptSha256 === sha256Text(old) && workflow.sourceTranscriptSha256 === sha256File(rel("state/source-transcript.json"))));
  if (name === "state/creative-confirmation.json") {
    const original = readJson(path.join(scriptDirectory, "../templates/job/creative-confirmation.json"));
    original.captionMode = workflow.captionMode;
    original.captionModeDecision = { status: workflow.captionModeAcknowledged ? "acknowledged" : "default-proposed", source: workflow.captionModeSource ?? "default" };
    if (captionMode === "motion-copy") delete original.storyboard.captionPlan;
    return JSON.stringify(JSON.parse(old)) === JSON.stringify(original);
  }
  return false;
};
try {
  for (const [name, content] of outputs) {
    const target = path.join(staging, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  if (captionMode === "subtitles") {
    const rendered = spawnSync(process.execPath, [path.join(scriptDirectory, "render-caption-review-doc.mjs"), staging], { encoding: "utf8" });
    if (rendered.status !== 0) throw new Error(`render-caption-review-doc failed: ${rendered.stderr.trim() || rendered.stdout.trim()}`);
    outputs.set("docs/caption-plan.md", fs.readFileSync(path.join(staging, "docs/caption-plan.md"), "utf8"));
  }
  const previous = new Map();
  for (const [name, content] of outputs) {
    const old = fs.existsSync(rel(name)) ? fs.readFileSync(rel(name), "utf8") : null;
    previous.set(name, old);
    // Reconciliation decisions are imported above, so their manual edits survive.
    if (old !== null && old !== content && name !== "state/transcript-reconciliation.json"
      && sha256Text(old) !== managed[name] && !unchangedScaffold(name, old) && !flags.includes("--replace-existing")) {
      throw new Error(`${name} has existing manual content. Import its decisions into planning-inputs.json; then use --replace-existing to replace it with a backed-up generated copy.`);
    }
  }
  json(manifestPath, { schemaVersion: "1.0.0", files: Object.fromEntries([...outputs].map(([name, content]) => [name, sha256Text(content)])) });
  previous.set(manifestPath, fs.existsSync(rel(manifestPath)) ? fs.readFileSync(rel(manifestPath), "utf8") : null);
  if (flags.includes("--replace-existing")) {
    const backup = fs.mkdtempSync(rel("state/planning-backup-"));
    for (const [name, old] of previous) if (old !== null && old !== outputs.get(name)) {
      const target = path.join(backup, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, old);
    }
  }
  const written = [];
  try {
    for (const [name, content] of outputs) {
      if (previous.get(name) === content) continue;
      fs.mkdirSync(path.dirname(rel(name)), { recursive: true });
      const staged = path.join(staging, name);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, content);
      fs.renameSync(staged, rel(name));
      written.push(name);
    }
  } catch (error) {
    for (const name of written.reverse()) {
      const old = previous.get(name);
      if (old === null) fs.rmSync(rel(name), { force: true });
      else fs.writeFileSync(rel(name), old);
    }
    throw error;
  }
  console.log(`wrote ${outputs.size - 1} planning artifacts`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

/** The exact byte serialization writeJsonAtomic produces, so fingerprints match. */
function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
