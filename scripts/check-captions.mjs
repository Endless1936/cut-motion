import fs from "node:fs";
import path from "node:path";
import { resolveCaptionCues } from "./caption-review-utils.mjs";

const [captionsPath, pagesPath, designSystemPath] = process.argv.slice(2);
if (!captionsPath || !pagesPath || !designSystemPath) {
  console.error("Usage: node check-captions.mjs <captions.json> <chatcut-pages.json> <design-system.json>");
  process.exit(64);
}

const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
const pagesDocument = JSON.parse(fs.readFileSync(pagesPath, "utf8"));
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const expectedStyle = designSystem.captions;
const errors = [];
const displayUnits = (value) => [...value.normalize("NFKC")].reduce((sum, character) => {
  if (/\s/.test(character)) return sum + 0.25;
  if (/[\u0000-\u007f]/.test(character)) return sum + 0.55;
  if (/[，。；：！？、]/u.test(character)) return sum + 0.5;
  return sum + 1;
}, 0);
if (captions.source?.kind !== "approved-semantic-plan") errors.push("release captions must originate from an approved semantic plan");
if (captions.source?.fps !== pagesDocument.fps) errors.push("caption fps must match the locked edit timeline");
if (captions.source?.roughCutLocked !== true) errors.push("captions require a locked ChatCut rough cut");
if (captions.source?.captionRenderDisabled !== true) errors.push("captions require a clean export with ChatCut caption rendering disabled");
if (captions.source?.cleanExport !== pagesDocument.cleanExport) errors.push("caption clean export must match the locked ChatCut export");
if (pagesDocument.source !== "chatcut-viewer-pages") errors.push("raw timing evidence must originate from ChatCut viewer pages");
if (pagesDocument.roughCutLocked !== true || pagesDocument.captionRenderDisabled !== true) errors.push("ChatCut timing evidence is not locked");

for (const [field, expected] of Object.entries(expectedStyle)) {
  if (JSON.stringify(captions.style?.[field]) !== JSON.stringify(expected)) errors.push(`Caption style ${field} must match the design system`);
}
if (captions.style?.fontWeight !== 400) errors.push("Captions must use normal weight 400");

let previousEndFrame = 0;
for (const cue of captions.cues ?? []) {
  if (cue.startFrame < previousEndFrame) errors.push(`${cue.id}: overlaps the previous caption cue`);
  if (Math.abs(cue.start - cue.startFrame / captions.source.fps) > 0.000001
    || Math.abs(cue.end - cue.endFrame / captions.source.fps) > 0.000001) {
    errors.push(`${cue.id}: seconds must be quantized from timeline frames`);
  }
  if (!Array.isArray(cue.lines) || cue.lines.length !== 1 || /[\r\n]/.test(cue.lines?.[0] ?? "")) errors.push(`${cue.id}: must contain exactly one rendered line`);
  if (displayUnits(cue.lines?.[0] ?? "") > captions.style.maximumDisplayUnits) {
    errors.push(`${cue.id}: measured line width exceeds ${captions.style.maximumDisplayUnits} display units`);
  }
  previousEndFrame = cue.endFrame;
}

const reviewPlanRelativePath = captions.source.reviewPlan ?? "captions/caption-review-plan.json";
const reviewPlanPath = path.resolve(path.dirname(path.dirname(captionsPath)), reviewPlanRelativePath);
if (!fs.existsSync(reviewPlanPath)) {
  errors.push("approved semantic captions require their review plan");
} else {
  const reviewPlan = JSON.parse(fs.readFileSync(reviewPlanPath, "utf8"));
  const transcriptPath = path.resolve(path.dirname(path.dirname(captionsPath)), "state", "transcript.json");
  if (reviewPlan.status !== "approved") errors.push("semantic caption plan must be user-approved before promotion");
  if (reviewPlan.cues.length !== captions.cues.length) errors.push("promoted cue count differs from the approved plan");
  if (!fs.existsSync(transcriptPath)) errors.push("approved semantic captions require their transcript authority");
  const resolvedCues = fs.existsSync(transcriptPath)
    ? resolveCaptionCues(reviewPlan, JSON.parse(fs.readFileSync(transcriptPath, "utf8")))
    : [];
  for (let index = 0; index < Math.min(resolvedCues.length, captions.cues.length); index += 1) {
    const approved = resolvedCues[index];
    const rendered = captions.cues[index];
    if (approved.id !== rendered.id || approved.text !== rendered.lines?.[0]) errors.push(`${rendered.id}: wording differs from the approved semantic plan`);
    const expectedStartFrame = Math.max(0, Math.round(approved.start * captions.source.fps));
    const expectedEndFrame = Math.max(expectedStartFrame + 1, Math.round(approved.end * captions.source.fps));
    if (rendered.startFrame !== expectedStartFrame || rendered.endFrame !== expectedEndFrame) {
      errors.push(`${rendered.id}: timing differs from the approved semantic plan`);
    }
    if (rendered.end - rendered.start < reviewPlan.rules.minimumDurationSeconds - 1 / captions.source.fps) {
      errors.push(`${rendered.id}: duration is below the approved minimum`);
    }
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`Caption plan passed: ${captions.cues.length} ${captions.source.kind} cue(s)`);
