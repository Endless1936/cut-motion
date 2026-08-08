import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeCreativeAuthorities } from "./workflow-utils.mjs";

const [confirmationPath, confirmationDocPath, beatMapPath, workflowPath] = process.argv.slice(2);

if (!confirmationPath || !confirmationDocPath || !beatMapPath || !workflowPath) {
  console.error("Usage: node check-creative-confirmation.mjs <creative-confirmation.json> <creative-confirmation.md> <beat-map.json> <workflow.json>");
  process.exit(64);
}

const confirmation = JSON.parse(fs.readFileSync(confirmationPath, "utf8"));
const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const document = fs.readFileSync(confirmationDocPath, "utf8");
const errors = [];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const jobRoot = path.dirname(path.dirname(confirmationPath));
const normalize = (value) => value.replace(/[\s，。！？、,.!?]/g, "").toLowerCase();

if (confirmation.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
if (confirmation.captionMode !== workflow.captionMode) errors.push("caption mode must match workflow state");
if (!confirmation.captionModeDecision || !["default-proposed", "acknowledged"].includes(confirmation.captionModeDecision.status)) {
  errors.push("caption mode decision must be proposed or acknowledged");
}
if (confirmation.captionModeDecision?.status === "acknowledged" && confirmation.captionModeDecision.source !== workflow.captionModeSource) {
  errors.push("acknowledged caption decision source must match workflow state");
}
if (workflow.captionModeAcknowledged && (confirmation.captionModeDecision?.status !== "acknowledged"
  || confirmation.captionModeDecision?.source !== workflow.captionModeSource)) {
  errors.push("creative package must mirror the acknowledged caption decision");
}
if (!["a-axis-overlay", "b-axis-stage", "hybrid"].includes(confirmation.visualAxisMode)) {
  errors.push("creative confirmation must declare a visual axis mode");
}
if (!["default-proposed", "acknowledged"].includes(confirmation.visualAxisModeDecision?.status)) {
  errors.push("visual axis mode decision must be default-proposed or acknowledged");
}
if (workflow.visualAxisModeAcknowledged && confirmation.visualAxisMode !== workflow.visualAxisMode) errors.push("visual axis mode must match the acknowledged workflow state");
if (!workflow.visualAxisModeAcknowledged && confirmation.visualAxisModeDecision?.status !== "default-proposed") {
  errors.push("unacknowledged visual axis mode must remain a proposal");
}
if (confirmation.visualAxisModeDecision?.status === "acknowledged"
  && confirmation.visualAxisModeDecision.source !== workflow.visualAxisModeSource) {
  errors.push("acknowledged visual axis source must match workflow state");
}
if (confirmation.storyboard?.motionPlan !== "docs/motion-plan.md"
  || confirmation.storyboard?.beatMap !== "state/beat-map.json") {
  errors.push("storyboard paths must point to the motion plan and beat map");
}
if (workflow.captionMode === "subtitles" && confirmation.storyboard?.captionPlan !== "docs/caption-plan.md") errors.push("subtitles storyboard must point to the caption plan");
if (workflow.captionMode === "motion-copy" && confirmation.storyboard?.captionPlan !== undefined) errors.push("motion-copy must not declare a caption plan");
if (confirmation.storyboard?.beatCount !== beatMap.beats.length) errors.push("storyboard beat count must match beat map");
if (beatMap.captionMode !== workflow.captionMode) errors.push("beat map caption mode must match workflow state");
const annotationContract = confirmation.scriptAnnotations;
if (annotationContract?.source !== "state/reference-script-annotations.json"
  || annotationContract?.role !== "advisory"
  || annotationContract?.exhaustiveVisualPlan !== false
  || !Array.isArray(annotationContract?.decisions)) {
  errors.push("script annotations must remain advisory, non-exhaustive visual references");
}
const annotationsPath = path.join(jobRoot, "state", "reference-script-annotations.json");
if (!fs.existsSync(annotationsPath)) {
  errors.push("creative confirmation requires reference-script annotation state");
} else {
  const annotationState = JSON.parse(fs.readFileSync(annotationsPath, "utf8"));
  const annotations = annotationState.annotations ?? [];
  const decisions = annotationContract?.decisions ?? [];
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  const decisionIds = new Set();
  const beatIds = new Set(beatMap.beats.map((beat) => beat.id));
  for (const decision of decisions) {
    if (!annotationIds.has(decision.id)) errors.push(`${decision.id}: decision references an unknown script annotation`);
    if (decisionIds.has(decision.id)) errors.push(`${decision.id}: script annotation decision is duplicated`);
    decisionIds.add(decision.id);
    if (!["adopted", "adjusted", "rejected"].includes(decision.disposition)) errors.push(`${decision.id}: invalid annotation disposition`);
    if (![decision.resolvedScope, decision.finalTreatment, decision.reason].every((value) => typeof value === "string" && value.trim())) {
      errors.push(`${decision.id}: annotation decision requires scope, final treatment, and reason`);
    }
    if (!Array.isArray(decision.beatIds) || decision.beatIds.some((beatId) => !beatIds.has(beatId))) {
      errors.push(`${decision.id}: annotation decision references an unknown beat`);
    }
  }
  for (const annotation of annotations) {
    if (!decisionIds.has(annotation.id)) errors.push(`${annotation.id}: script annotation is missing a creative decision`);
    if (!document.includes(annotation.id) || !document.includes(annotation.instruction)) {
      errors.push(`${annotation.id}: script annotation and its original instruction must appear in the creative package`);
    }
  }
}
try {
  const expectedAuthorities = computeCreativeAuthorities(jobRoot, workflow.captionMode);
  for (const [name, authority] of Object.entries(expectedAuthorities)) {
    if (confirmation.authorities?.[name]?.path !== authority.path || confirmation.authorities?.[name]?.sha256 !== authority.sha256) {
      errors.push(`${name} authority fingerprint is missing or stale`);
    }
  }
  if (workflow.captionMode === "motion-copy" && confirmation.authorities?.captionPlan) {
    errors.push("motion-copy must not declare a caption-plan authority");
  }
} catch (error) {
  errors.push(error.message);
}
const requiredReapprovalFields = new Set(["caption-segmentation", "mg-node-set", "mg-count", "on-screen-copy", "support-role", "visual-style", "primary-flow-axis", "visual-reference", "axis-mode"]);
const actualReapprovalFields = new Set(confirmation.changeControl?.reapprovalFields ?? []);
if (confirmation.changeControl?.implementationMayStartAfter !== "creative-package-approved"
  || confirmation.changeControl?.planChangesRequireReapproval !== true
  || [...requiredReapprovalFields].some((field) => !actualReapprovalFields.has(field))) {
  errors.push("change control must block implementation before plan approval and require reapproval for every plan field");
}

const aAxis = confirmation.axisPolicy?.A;
if (aAxis?.accumulation !== "replace") errors.push("A-axis must use replace behavior");
if (!Array.isArray(aAxis?.overlayZones) || aAxis.overlayZones.some((zone) => !["top", "bottom", "side"].includes(zone))) {
  errors.push("A-axis overlay zones must be top, bottom, or side");
}
if (!["brief-semantic-only", "required"].includes(aAxis?.faceProtection)) errors.push("A-axis must declare its face-cover policy");
if (aAxis?.surface?.kind !== "localized-glass" || aAxis.surface?.fullFrame !== false) errors.push("A-axis must use localized, non-full-frame glass");
if (!Array.isArray(aAxis?.surface?.opacityRange) || aAxis.surface.opacityRange.length !== 2 || aAxis.surface.opacityRange[0] < 0.5 || aAxis.surface.opacityRange[1] > 0.8 || aAxis.surface.opacityRange[0] > aAxis.surface.opacityRange[1]) {
  errors.push("A-axis glass opacity must stay within 0.50–0.80");
}
if (!(aAxis?.surface?.backdropBlurPx >= 0 && aAxis.surface.backdropBlurPx <= 18)) errors.push("A-axis glass blur must stay within 0–18px");

const bAxis = confirmation.axisPolicy?.B;
if (bAxis?.accumulation !== "accumulate") errors.push("B-axis must use accumulation behavior");
if (bAxis?.groupedExit !== true) errors.push("B-axis must use grouped exits");
if (bAxis?.pip?.live !== true || bAxis.pip?.protected !== true) errors.push("B-axis PIP must stay live and protected");
if (![bAxis?.pip?.exclusionZone?.rightPx, bAxis?.pip?.exclusionZone?.bottomPx, bAxis?.pip?.exclusionZone?.widthPx, bAxis?.pip?.exclusionZone?.heightPx].every((value) => Number.isFinite(value) && value > 0)) {
  errors.push("B-axis PIP must declare a measurable exclusion zone");
}
const usedAxes = new Set(beatMap.beats.map((beat) => beat.axis));
if (confirmation.visualAxisMode === "a-axis-overlay" && (usedAxes.size !== 1 || !usedAxes.has("A"))) errors.push("A-axis overlay mode may only contain A-axis beats");
if (confirmation.visualAxisMode === "b-axis-stage" && (usedAxes.size !== 1 || !usedAxes.has("B"))) errors.push("B-axis stage mode may only contain B-axis beats");
if (confirmation.visualAxisMode === "hybrid" && (!usedAxes.has("A") || !usedAxes.has("B"))) errors.push("Hybrid visual axis mode must contain both A-axis and B-axis beats");

if (!["ready", "approved"].includes(confirmation.review?.status)) errors.push("creative confirmation must be ready before plan review");

if (!document.includes("# 创意确认包")) errors.push("creative confirmation document is missing its title");
if (!document.includes("## 用户选择") || !document.includes("## 逐字稿对齐") || !document.includes("## 逐字稿画面批注") || !document.includes("## A/B 轴执行规则") || !document.includes("## 分镜动画方案")) {
  errors.push("creative confirmation document is missing a required review section");
}
if (confirmation.captionMode === "subtitles" && beatMap.beats.some((beat) => beat.mgScope === "local")) {
  if (!document.includes("### 字幕模式 MG 审核清单")) errors.push("subtitle creative confirmation must include the local MG review table");
  if (!document.includes("### 明确不加 MG 的段落")) errors.push("subtitle creative confirmation must list the passages that intentionally remain caption-only");
  for (const heading of ["最终上屏原文", "信息增量", "动画样式", "主要任务", "删除后的具体损失", "注意力成本"]) {
    if (!document.includes(heading)) errors.push(`subtitle creative confirmation MG table is missing ${heading}`);
  }
}
if (!/(?:字幕模式|Caption mode).*?(?:motion-copy|subtitles)/is.test(document)) errors.push("creative confirmation document must state caption mode");
if ((document.match(/^\s*\|.*\|\s*$/gm) ?? []).length < 5) errors.push("creative confirmation document must include review tables");
const reconciliationPath = path.join(jobRoot, "state", "transcript-reconciliation.json");
if (!fs.existsSync(reconciliationPath)) {
  errors.push("creative confirmation requires transcript reconciliation");
} else {
  const reconciliation = JSON.parse(fs.readFileSync(reconciliationPath, "utf8"));
  for (const item of reconciliation.items?.filter((candidate) => candidate.resolution === "unresolved" && candidate.releaseImpact === true) ?? []) {
    if (!document.includes(item.id)) errors.push(`${item.id}: unresolved released wording must appear in the creative package`);
  }
}

const motionPlanPath = path.resolve(jobRoot, confirmation.storyboard?.motionPlan ?? "");
const captionPlanPath = path.resolve(jobRoot, confirmation.storyboard?.captionPlan ?? "");
if (!fs.existsSync(motionPlanPath)) {
  errors.push("motion plan referenced by creative confirmation does not exist");
} else {
  const motionPlan = fs.readFileSync(motionPlanPath, "utf8");
  for (const beat of beatMap.beats) {
    if (!motionPlan.includes(beat.text) && !motionPlan.includes(normalize(beat.text))) errors.push(`${beat.id}: motion plan is missing its displayed phrase`);
  }
}
if (confirmation.captionMode === "subtitles" && !fs.existsSync(captionPlanPath)) {
  errors.push("caption plan referenced by creative confirmation does not exist");
} else if (confirmation.captionMode === "subtitles") {
  const captionPlan = fs.readFileSync(captionPlanPath, "utf8");
  for (const heading of ["# 字幕与 MG 审核方案", "## 完整字幕切分", "## MG 节点", "## 明确不加 MG 的段落"]) {
    if (!captionPlan.includes(heading)) errors.push(`caption plan is missing ${heading}`);
  }
  const reviewPlanPath = path.join(jobRoot, "captions", "caption-review-plan.json");
  if (fs.existsSync(reviewPlanPath)) {
    const semanticCaptionCheck = spawnSync(process.execPath, [path.join(scriptDirectory, "check-caption-review-plan.mjs"), reviewPlanPath], { encoding: "utf8" });
    if (semanticCaptionCheck.status !== 0) {
      errors.push(`semantic caption plan failed: ${semanticCaptionCheck.stderr.trim() || semanticCaptionCheck.stdout.trim()}`);
    }
  }
  const captionsPath = fs.existsSync(reviewPlanPath)
    ? reviewPlanPath
    : path.join(path.dirname(path.dirname(confirmationPath)), "captions", "captions.json");
  if (fs.existsSync(captionsPath)) {
    const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
    const cueIds = new Set((captions.cues ?? []).map((cue) => cue.id));
    for (const cue of captions.cues ?? []) {
      if (!captionPlan.includes(`| ${cue.id} |`)) errors.push(`${cue.id}: caption plan is missing the cue row`);
      const text = cue.text ?? cue.lines?.[0] ?? "";
      if (text && !captionPlan.includes(text)) errors.push(`${cue.id}: caption plan is missing its approved single-line text`);
    }
    for (const beat of beatMap.beats.filter((candidate) => candidate.mgScope === "local")) {
      if (!Array.isArray(beat.captionCueIds) || beat.captionCueIds.length === 0) {
        errors.push(`${beat.id}: local MG must map to approved caption cue IDs`);
      } else if (beat.captionCueIds.some((cueId) => !cueIds.has(cueId))) {
        errors.push(`${beat.id}: local MG references an unknown caption cue ID`);
      }
      if (typeof beat.visualStyle !== "string" || beat.visualStyle.trim().length === 0) {
        errors.push(`${beat.id}: local MG must declare its reviewed visual style`);
      }
      const reviewedText = `${document}\n${captionPlan}`;
      for (const [field, value] of [
        ["id", beat.id],
        ["support role", beat.supportRole],
        ["viewer question", beat.viewerQuestion],
        ["removal loss", beat.removalLoss],
        ["visual style", beat.visualStyle],
        ["primary flow", beat.primaryFlowAxis],
        ["visual reference", beat.visualReference],
        ...beat.onScreenCopy.map((copy) => ["on-screen copy", copy])
      ]) {
        if (!value || !reviewedText.includes(value)) errors.push(`${beat.id}: creative package is missing reviewed ${field}`);
      }
    }
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`Creative confirmation passed: ${confirmation.storyboard.beatCount} beat(s), ${confirmation.captionMode}`);
