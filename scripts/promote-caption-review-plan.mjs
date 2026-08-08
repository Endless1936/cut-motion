import fs from "node:fs";
import path from "node:path";
import { assertCreativeAuthorities, ensureWorkflowDefaults, readJson } from "./workflow-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";

const [jobDirectoryArgument] = process.argv.slice(2);
if (!jobDirectoryArgument) {
  console.error("Usage: node promote-caption-review-plan.mjs <job-directory>");
  process.exit(64);
}

const jobDirectory = path.resolve(jobDirectoryArgument);
const workflow = ensureWorkflowDefaults(readJson(path.join(jobDirectory, "state", "workflow.json")));
assertCreativeAuthorities(jobDirectory, workflow);
const reviewPlan = JSON.parse(fs.readFileSync(path.join(jobDirectory, "captions", "caption-review-plan.json"), "utf8"));
if (reviewPlan.status !== "approved") throw new Error("Caption review plan must be approved before promotion");
const transcript = JSON.parse(fs.readFileSync(path.join(jobDirectory, "state", "transcript.json"), "utf8"));
const resolvedCues = resolveCaptionCues(reviewPlan, transcript);
const pages = JSON.parse(fs.readFileSync(path.join(jobDirectory, "captions", "chatcut-pages.json"), "utf8"));
const designSystem = JSON.parse(fs.readFileSync(path.join(jobDirectory, "state", "design-system.json"), "utf8"));
const fps = pages.fps;
const cues = resolvedCues.map((cue) => {
  const startFrame = Math.max(0, Math.round(cue.start * fps));
  const endFrame = Math.max(startFrame + 1, Math.round(cue.end * fps));
  return {
    id: cue.id,
    sourcePageId: "approved-semantic-plan",
    startFrame,
    endFrame,
    start: Number((startFrame / fps).toFixed(6)),
    end: Number((endFrame / fps).toFixed(6)),
    viewerText: cue.text,
    lines: [cue.text]
  };
});

const captions = {
  source: {
    kind: "approved-semantic-plan",
    reviewPlan: "captions/caption-review-plan.json",
    fps,
    cleanExport: pages.cleanExport,
    timelineVersion: pages.timelineVersion ?? null,
    roughCutLocked: true,
    captionRenderDisabled: true
  },
  style: designSystem.captions,
  cues
};
const outputPath = path.join(jobDirectory, "captions", "captions.json");
fs.writeFileSync(outputPath, `${JSON.stringify(captions, null, 2)}\n`);
console.log(`Promoted ${cues.length} approved semantic cue(s): ${outputPath}`);
