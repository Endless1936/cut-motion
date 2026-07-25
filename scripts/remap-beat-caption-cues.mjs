import fs from "node:fs";

const [beatMapPath, captionPlanPath] = process.argv.slice(2);
if (!beatMapPath || !captionPlanPath) {
  console.error("Usage: node remap-beat-caption-cues.mjs <beat-map.json> <caption-review-plan.json>");
  process.exit(64);
}

const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const captionPlan = JSON.parse(fs.readFileSync(captionPlanPath, "utf8"));
for (const beat of beatMap.beats.filter((candidate) => candidate.mgScope === "local")) {
  beat.captionCueIds = captionPlan.cues
    .filter((cue) => cue.end > beat.start && cue.start < beat.end)
    .map((cue) => cue.id);
  if (beat.captionCueIds.length === 0) throw new Error(`${beat.id}: no semantic caption cues overlap the MG node`);
}
fs.writeFileSync(beatMapPath, `${JSON.stringify(beatMap, null, 2)}\n`);
console.log(`Remapped ${beatMap.beats.filter((beat) => beat.mgScope === "local").length} MG node(s) to semantic caption cues`);
