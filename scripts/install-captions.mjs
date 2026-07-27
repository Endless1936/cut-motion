import fs from "node:fs";

const [captionsPath, compositionPath] = process.argv.slice(2);
if (!captionsPath || !compositionPath) {
  console.error("Usage: node install-captions.mjs <captions.json> <hyperframes-index.html>");
  process.exit(64);
}

const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
const source = fs.readFileSync(compositionPath, "utf8");
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

const style = captions.style;
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
  const duration = Number((cue.end - cue.start).toFixed(6));
  const lines = cue.lines
    .map((line) => `          <p class="motion-caption-line" data-layout-guard="canvas">${escapeHtml(line)}</p>`)
    .join("\n");
  return [
    `      <section id="motion-caption-${String(index + 1).padStart(4, "0")}" class="clip motion-caption-layer" data-motion-protected="caption" data-caption-id="${escapeHtml(cue.id)}" data-caption-page-id="${escapeHtml(cue.sourcePageId)}" data-caption-start-frame="${cue.startFrame}" data-caption-end-frame="${cue.endFrame}" data-start="${cue.start}" data-duration="${duration}" data-track-index="80" style="${customProperties}">`,
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
fs.writeFileSync(compositionPath, updated);
console.log(`Installed ${captions.cues.length} caption cue(s) into ${compositionPath}`);
