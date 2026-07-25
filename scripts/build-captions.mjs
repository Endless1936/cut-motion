import fs from "node:fs";

const [pagesPath, designSystemPath, outputPath] = process.argv.slice(2);
if (!pagesPath || !designSystemPath || !outputPath) {
  console.error("Usage: node build-captions.mjs <chatcut-pages.json> <design-system.json> <output.json>");
  process.exit(64);
}

const pagesDocument = JSON.parse(fs.readFileSync(pagesPath, "utf8"));
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const errors = [];
const pages = pagesDocument.pages;

if (pagesDocument.source !== "chatcut-viewer-pages") errors.push("caption pages must originate from ChatCut viewer pages");
if (!(Number.isFinite(pagesDocument.fps) && pagesDocument.fps > 0)) errors.push("caption pages require a positive fps");
if (pagesDocument.roughCutLocked !== true) errors.push("ChatCut rough cut and caption wording must be approved before transfer");
if (pagesDocument.captionRenderDisabled !== true) errors.push("ChatCut caption render track must be disabled before clean export");
if (typeof pagesDocument.cleanExport !== "string" || !pagesDocument.cleanExport) errors.push("caption pages require the clean ChatCut export path");
if (!Array.isArray(pages) || pages.length === 0) errors.push("caption pages must contain at least one viewer page");

const cleanLines = (viewerText) => {
  const rawLines = String(viewerText).split("/");
  const lastIndex = rawLines.length - 1;
  return rawLines.map((rawLine, index) => {
    let line = rawLine.trim();
    const terminalQuestion = index === lastIndex && /[?？]$/.test(line) ? line.at(-1) : "";
    if (terminalQuestion) line = line.slice(0, -1);
    line = line.replace(/[，。！？、；：,.!?:;]+/g, " ").replace(/\s+/g, " ").trim();
    return `${line}${terminalQuestion}`.trim();
  }).filter(Boolean);
};
const visibleLength = (value) => Array.from(value).filter((character) => !/\s/.test(character)).length;

const splitFrameRange = (startFrame, endFrame, lines) => {
  if (lines.length === 1) return [{ startFrame, endFrame }];
  const duration = endFrame - startFrame;
  const weights = lines.map((line) => Math.max(1, visibleLength(line)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const ranges = [];
  let cursor = startFrame;
  let cumulativeWeight = 0;
  for (let index = 0; index < lines.length; index += 1) {
    cumulativeWeight += weights[index];
    const proposedEnd = index === lines.length - 1
      ? endFrame
      : startFrame + Math.round(duration * cumulativeWeight / totalWeight);
    const remainingLines = lines.length - index - 1;
    const cueEndFrame = Math.min(endFrame - remainingLines, Math.max(cursor + 1, proposedEnd));
    ranges.push({ startFrame: cursor, endFrame: cueEndFrame });
    cursor = cueEndFrame + 1;
  }
  return ranges;
};

const cues = [];
let previousEndFrame = 0;
for (let index = 0; index < (pages ?? []).length; index += 1) {
  const page = pages[index];
  const id = page.id ?? `chatcut-page-${String(index + 1).padStart(4, "0")}`;
  const startFrame = Number(page.startFrame);
  const endFrame = Number(page.endFrame);
  const viewerText = String(page.viewerText ?? page.text ?? "");
  const lines = cleanLines(viewerText);

  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || endFrame <= startFrame) errors.push(`${id}: invalid frame range`);
  if (startFrame < previousEndFrame) errors.push(`${id}: overlaps the previous ChatCut page`);
  if (!viewerText.trim() || lines.length === 0) errors.push(`${id}: viewer text is empty after cleanup`);

  const singleLineMode = designSystem.captions.maximumLines === 1;
  const cueLines = singleLineMode ? lines.map((line) => [line]) : [lines];
  const ranges = singleLineMode
    ? splitFrameRange(startFrame, endFrame, lines)
    : [{ startFrame, endFrame }];
  for (let lineIndex = 0; lineIndex < cueLines.length; lineIndex += 1) {
    const range = ranges[lineIndex];
    cues.push({
      id: `caption-${String(cues.length + 1).padStart(4, "0")}`,
      sourcePageId: id,
      sourceLineIndex: lineIndex,
      sourceLineCount: cueLines.length,
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      start: Number((range.startFrame / pagesDocument.fps).toFixed(6)),
      end: Number((range.endFrame / pagesDocument.fps).toFixed(6)),
      viewerText,
      lines: cueLines[lineIndex]
    });
  }
  previousEndFrame = endFrame;
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);

const captions = {
  source: {
    kind: "chatcut-viewer-pages",
    fps: pagesDocument.fps,
    cleanExport: pagesDocument.cleanExport,
    timelineVersion: pagesDocument.timelineVersion ?? null,
    roughCutLocked: true,
    captionRenderDisabled: true,
    singleLineBoundaryGuardFrames: designSystem.captions.maximumLines === 1 ? 1 : 0
  },
  style: designSystem.captions,
  cues
};

fs.writeFileSync(outputPath, `${JSON.stringify(captions, null, 2)}\n`);
console.log(`Created ${cues.length} ChatCut-derived caption cue(s): ${outputPath}`);
