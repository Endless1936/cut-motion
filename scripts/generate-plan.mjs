#!/usr/bin/env node
/**
 * Generate every motion-plan artifact for a job from a single editorial input.
 *
 *   node scripts/generate-plan.mjs <job-directory> [--write]
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
 * Without --write it prints the plan and touches nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, sha256File, sha256Text, writeJsonAtomic } from "./workflow-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";
import {
  buildBeatMap,
  buildCaptionPlan,
  buildReconciliationItems,
  buildReleasedTranscript,
  buildSourceWordEvidence
} from "./plan-artifacts.mjs";
import { renderCreativeConfirmationDoc, renderMotionPlanDoc } from "./render-plan-docs.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const [jobArgument, ...flags] = process.argv.slice(2);
if (!jobArgument) {
  console.error("Usage: node scripts/generate-plan.mjs <job-directory> [--write]");
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

require_("state/planning-inputs.json");
const inputs = read("state/planning-inputs.json");
const workflow = read("state/workflow.json");
const project = read("state/project.json");
const designSystem = read(project.designSystem ?? "state/design-system.json");
const sourceTranscript = read("state/source-transcript.json");
const timelineWindows = read("state/timeline-source-windows.json");
const annotationState = read("state/reference-script-annotations.json");

const fps = project.fps ?? inputs.fps ?? 30;
const captionMode = inputs.captionMode ?? workflow.captionMode;
if (captionMode !== workflow.captionMode) {
  throw new Error(`planning inputs captionMode (${captionMode}) disagrees with the workflow (${workflow.captionMode})`);
}
const corrections = inputs.corrections ?? {};

// ---------------------------------------------------------------- artifacts
const released = inputs.releasedTranscript
  ? { ...read("state/transcript.json"), ...inputs.releasedTranscript }
  : buildReleasedTranscript({ sourceTranscript, timelineWindows, fps, corrections, revision: inputs.revision ?? 2, language: project.language ?? "zh-CN" });

const captionPlan = buildCaptionPlan({
  transcript: released,
  transcriptSha256: sha256Text(serializeJson(released)),
  cueLines: inputs.cueLines,
  lexicon: inputs.lexicon ?? {},
  rules: inputs.cueRules ?? {},
  exceptions: inputs.cueExceptions ?? {},
  status: inputs.captionStatus ?? "proposed"
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

const evidence = buildSourceWordEvidence({ sourceTranscript, timelineWindows, releasedTranscript: released, fps, corrections });
const reconciliationItems = buildReconciliationItems({ transcript: released, corrections, plan: inputs.reconciliation ?? {}, sourceTranscript });
const mediaPath = project.mediaArtifacts?.roughcut?.path ?? "roughcut/a-roll.mp4";
require_(mediaPath);
const reconciliation = {
  $schema: "../../../schemas/transcript-reconciliation.schema.json",
  schemaVersion: "1.0.0",
  mediaFingerprint: sha256File(rel(mediaPath)),
  transcriptRevision: released.revision ?? 1,
  referenceScript: {
    status: workflow.referenceScriptStatus ?? "none",
    path: workflow.referenceScriptPath ?? null,
    sha256: workflow.referenceScriptSha256 ?? null
  },
  items: reconciliationItems,
  verification: {
    audioChecked: reconciliationItems.every((item) => item.evidence.audioChecked === true),
    mediaPath,
    mediaFingerprintMatches: true,
    transcriptRevisionMatches: true,
    unresolvedReleaseImpactCount: reconciliationItems.filter((item) => item.resolution === "unresolved" && item.releaseImpact === true).length
  }
};

const documents = inputs.documents ?? {};
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
    implementationMayStartAfter: "creative-package-approved",
    planChangesRequireReapproval: true,
    reapprovalFields: [
      "caption-segmentation",
      "mg-node-set",
      "mg-count",
      "on-screen-copy",
      "support-role",
      "visual-style",
      "primary-flow-axis",
      "visual-reference",
      "axis-mode"
    ]
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
console.log(`released       ${released.segments.length} segments / ${released.segments.reduce((sum, s) => sum + s.words.length, 0)} words / ${released.duration}s`);
console.log(`captions       ${captionPlan.cues.length} cues, ${captionPlan.cues.filter((cue) => cue.text.length > 0).length} non-empty`);
console.log(`beats          ${beatMap.beats.length} (${localBeats.length} local MG)`);
for (const beat of localBeats) console.log(`  ${beat.id}  ${beat.start.toFixed(2)}-${beat.end.toFixed(2)}  cues ${beat.captionCueIds.join(",")}`);
console.log(`evidence       ${evidence.rows.length} source rows, frames ${evidence.entries[0].timelineStartFrame}-${evidence.entries.at(-1).timelineEndFrame}`);
console.log(`reconciliation ${reconciliation.items.length} items (${reconciliation.items.filter((i) => i.type === "asr-correction").length} asr-correction)`);

if (!write) {
  console.log("\n(dry run — pass --write to emit the artifacts)");
  process.exit(0);
}

// ------------------------------------------------------------------ emit
fs.mkdirSync(rel("captions"), { recursive: true });
fs.mkdirSync(rel("docs"), { recursive: true });
writeJsonAtomic(rel("state/transcript.json"), released);
writeJsonAtomic(rel("captions/caption-lexicon.json"), inputs.lexicon ?? {});
writeJsonAtomic(rel("captions/caption-review-plan.json"), captionPlan);
writeJsonAtomic(rel("state/beat-map.json"), beatMap);
writeJsonAtomic(rel("state/timeline-source-words.json"), { schemaVersion: "1.0.0", fps, entries: evidence.entries });
writeJsonAtomic(rel("captions/chatcut-pages.json"), {
  source: "ChatCut inspect_asset original source word rows",
  fps,
  cleanExport: mediaPath,
  timelineVersion: `chatcut-timeline-${inputs.timelineId ?? "unknown"}`,
  roughCutLocked: true,
  captionRenderDisabled: true,
  rows: evidence.rows,
  timelineMapping: "state/timeline-source-words.json",
  timelineMappingSha256: sha256File(rel("state/timeline-source-words.json"))
});
writeJsonAtomic(rel("state/transcript-reconciliation.json"), reconciliation);
fs.writeFileSync(rel("docs/motion-plan.md"), motionPlanDoc);
fs.writeFileSync(rel("docs/creative-confirmation.md"), creativeConfirmationDoc);

if (captionMode === "subtitles") {
  const rendered = spawnSync(process.execPath, [path.join(scriptDirectory, "render-caption-review-doc.mjs"), jobRoot], { encoding: "utf8" });
  if (rendered.status !== 0) throw new Error(`render-caption-review-doc failed: ${rendered.stderr.trim() || rendered.stdout.trim()}`);
  console.log(rendered.stdout.trim());
}

creativeConfirmation.authorities = Object.fromEntries(
  Object.entries({
    transcript: "state/transcript.json",
    beatMap: "state/beat-map.json",
    ...(captionMode === "subtitles" ? { captionPlan: "captions/caption-review-plan.json" } : {})
  }).map(([name, relativePath]) => [name, { path: relativePath, sha256: sha256File(rel(relativePath)) }])
);
writeJsonAtomic(rel("state/creative-confirmation.json"), creativeConfirmation);
console.log("wrote state/creative-confirmation.json");

/** The exact byte serialization writeJsonAtomic produces, so fingerprints match. */
function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
