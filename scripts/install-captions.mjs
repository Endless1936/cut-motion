import fs from "node:fs";
import path from "node:path";
import { buildComposition } from "./build-composition.mjs";
import { assertCaptionSequence, frameWindowTiming } from "./frame-window-utils.mjs";

const [captionsPath, compositionPath, designSystemPath] = process.argv.slice(2);
if (!captionsPath || !compositionPath || !designSystemPath) {
  console.error("Usage: node install-captions.mjs <captions.json> <hyperframes-index.html> <design-system.json>");
  process.exit(64);
}

const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
assertCaptionSequence(captions.cues);
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const templateCandidate = path.join(path.dirname(compositionPath), "index.template.html");
const authoredCompositionPath = path.basename(compositionPath) === "index.html" && fs.existsSync(templateCandidate)
  ? templateCandidate
  : compositionPath;
const source = fs.readFileSync(authoredCompositionPath, "utf8");
const startMarker = "<!-- CUT_MOTION_CAPTIONS_START -->";
const endMarker = "<!-- CUT_MOTION_CAPTIONS_END -->";
const markerPair = [
  [startMarker, endMarker],
  ["<!-- MOTIONSCRIPT_CAPTIONS_START -->", "<!-- MOTIONSCRIPT_CAPTIONS_END -->"]
].find(([start, end]) => source.includes(start) && source.includes(end));

if (!markerPair) {
  throw new Error(`Caption markers are missing from ${compositionPath}`);
}

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

if (JSON.stringify(captions.style) !== JSON.stringify(designSystem.captions)) {
  throw new Error("Caption style must exactly match state/design-system.json");
}
const style = designSystem.captions;
const shadow = `${style.shadow.xPx}px ${style.shadow.yPx}px ${style.shadow.blurPx}px ${style.shadow.color}`;
const customProperties = [
  `--caption-bottom:${style.bottomOffsetPx}px`,
  `--caption-color:${style.color}`,
  `--caption-font:${escapeHtml(style.fontFamily)}`,
  `--caption-weight:${style.fontWeight ?? 400}`,
  `--caption-size:${style.fontSizePx}px`,
  `--caption-line-height:${style.lineHeight}`,
  `--caption-shadow:${shadow}`
].join(";");

const layers = captions.cues.map((cue, index) => {
  const { start, duration } = frameWindowTiming(cue, captions.source?.fps);
  if (!Array.isArray(cue.lines) || cue.lines.length !== 1 || /[\r\n]/.test(cue.lines[0])) {
    throw new Error(`${cue.id}: must contain exactly one rendered line`);
  }
  const cueProperties = Number.isFinite(cue.fitFontSizePx)
    ? `${customProperties};--caption-size:${cue.fitFontSizePx}px`
    : customProperties;
  const lines = cue.lines
    .map((line) => `          <p class="motion-caption-line" data-layout-guard="canvas">${escapeHtml(line)}</p>`)
    .join("\n");
  return [
    `      <section id="motion-caption-${String(index + 1).padStart(4, "0")}" class="clip motion-caption-layer" data-motion-protected="caption" data-caption-id="${escapeHtml(cue.id)}" data-caption-page-id="${escapeHtml(cue.sourcePageId)}" data-caption-start-frame="${cue.startFrame}" data-caption-end-frame="${cue.endFrame}" data-start="${start}" data-duration="${duration}" data-track-index="80" style="${cueProperties}">`,
    lines,
    "      </section>"
  ].join("\n");
}).join("\n");

const replacement = `${startMarker}\n${layers}${layers ? "\n      " : ""}${endMarker}`;
let updated = source.replace(new RegExp(`${markerPair[0]}[\\s\\S]*?${markerPair[1]}`), replacement);
if (Number.isFinite(style.bottomOffsetRatio)) {
  updated = updated.replace(/data-caption-bottom-ratio=["'][0-9.]+["']/, `data-caption-bottom-ratio="${style.bottomOffsetRatio}"`);
}
updated = updated.replace(/data-caption-font-weight=["'][0-9]+["']/, `data-caption-font-weight="${style.fontWeight ?? 400}"`);
fs.writeFileSync(authoredCompositionPath, updated);
if (authoredCompositionPath !== compositionPath) buildComposition(path.dirname(compositionPath));
console.log(`Installed ${captions.cues.length} caption cue(s) into ${authoredCompositionPath}`);
