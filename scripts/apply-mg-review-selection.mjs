import fs from "node:fs";

const [beatMapPath, selectionPath] = process.argv.slice(2);
if (!beatMapPath || !selectionPath) {
  console.error("Usage: node apply-mg-review-selection.mjs <beat-map.json> <mg-selection.json>");
  process.exit(64);
}

const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
const selectedById = new Map(selection.nodes.map((node) => [node.beatId, node]));
const localOnlyFields = [
  "onScreenCopy",
  "captionCueIds",
  "visualStyle",
  "viewerQuestion",
  "supportRole",
  "removalLoss",
  "visualEncoding",
  "stillFrameValue",
  "attentionCost",
  "attentionCostReason",
  "evidenceSource",
  "factualClaims",
  "terms"
];

for (const beat of beatMap.beats) {
  const selected = selectedById.get(beat.id);
  if (!selected) {
    beat.text = selection.captionOnlyLabels?.[beat.id] ?? `纯字幕：${beat.id}`;
    beat.mgScope = "none";
    beat.recipe = "caption-only";
    beat.components = [];
    beat.microEvents = [];
    for (const field of localOnlyFields) delete beat[field];
    continue;
  }

  Object.assign(beat, selected);
  delete beat.beatId;
  beat.axis = "A";
  beat.mgScope = "local";
  beat.recipe = "approved-selective-a-axis";
  beat.captionSafeZonePass = true;
  beat.factualClaims ??= [];
  beat.terms ??= [];
  beat.layout.supportingElementCount = beat.components.length;
}

fs.writeFileSync(beatMapPath, `${JSON.stringify(beatMap, null, 2)}\n`);
console.log(`Applied ${selection.nodes.length} selective MG node(s) to ${beatMap.beats.length} beat(s)`);
