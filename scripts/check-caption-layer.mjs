import fs from "node:fs";

const [captionsPath, compositionPath] = process.argv.slice(2);
if (!captionsPath || !compositionPath) {
  console.error("Usage: node check-caption-layer.mjs <captions.json> <hyperframes-index.html>");
  process.exit(64);
}

const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
const source = fs.readFileSync(compositionPath, "utf8");
const errors = [];
const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const sectionPattern = /<section\b([^>]*)\bdata-caption-id="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/g;
const sections = [...source.matchAll(sectionPattern)].map((match) => ({
  attributes: `${match[1]} ${match[3]}`,
  id: match[2],
  body: match[4]
}));

if (sections.length !== captions.cues.length) errors.push(`Expected ${captions.cues.length} caption clips, found ${sections.length}`);

for (const cue of captions.cues) {
  const section = sections.find((candidate) => candidate.id === escapeHtml(cue.id));
  if (!section) {
    errors.push(`${cue.id}: timed caption clip is missing`);
    continue;
  }

  const start = Number(section.attributes.match(/data-start="([^"]+)"/)?.[1]);
  const duration = Number(section.attributes.match(/data-duration="([^"]+)"/)?.[1]);
  if (Math.abs(start - cue.start) > 0.000001) errors.push(`${cue.id}: clip start does not match caption data`);
  if (Math.abs(duration - (cue.end - cue.start)) > 0.000001) errors.push(`${cue.id}: clip duration does not match caption data`);
  if (!section.attributes.includes(`data-caption-page-id="${escapeHtml(cue.sourcePageId)}"`)) errors.push(`${cue.id}: ChatCut source page is missing`);
  if (!section.attributes.includes(`data-caption-start-frame="${cue.startFrame}"`) || !section.attributes.includes(`data-caption-end-frame="${cue.endFrame}"`)) errors.push(`${cue.id}: ChatCut frame range is missing`);
  for (const line of cue.lines) {
    if (!section.body.includes(`>${escapeHtml(line)}</p>`)) errors.push(`${cue.id}: rendered line is missing: ${line}`);
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`Caption layer passed: ${sections.length} timed clip(s)`);
