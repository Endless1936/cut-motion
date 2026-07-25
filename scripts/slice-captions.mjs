import fs from "node:fs";
import path from "node:path";

const [captionsPath, startSecondsRaw, endSecondsRaw, outputPath] = process.argv.slice(2);
if (!captionsPath || !startSecondsRaw || !endSecondsRaw || !outputPath) {
  console.error("Usage: node slice-captions.mjs <captions.json> <start-seconds> <end-seconds> <output.json>");
  process.exit(64);
}
if (path.resolve(captionsPath) === path.resolve(outputPath)) {
  console.error("Caption slice output must differ from its input");
  process.exit(64);
}

const captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
const fps = captions.source?.fps;
const startSeconds = Number(startSecondsRaw);
const endSeconds = Number(endSecondsRaw);
const startFrame = Math.round(startSeconds * fps);
const endFrame = Math.round(endSeconds * fps);
const errors = [];

if (!(Number.isFinite(fps) && fps > 0)) errors.push("caption source requires a positive fps");
if (!(Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds)) {
  errors.push("slice requires a valid start and end time");
}

const cues = (captions.cues ?? [])
  .filter((cue) => cue.endFrame > startFrame && cue.startFrame < endFrame)
  .map((cue, index) => {
    const localStartFrame = Math.max(cue.startFrame, startFrame) - startFrame;
    const localEndFrame = Math.min(cue.endFrame, endFrame) - startFrame;
    return {
      ...cue,
      id: `sample-caption-${String(index + 1).padStart(4, "0")}`,
      globalStartFrame: cue.startFrame,
      globalEndFrame: cue.endFrame,
      startFrame: localStartFrame,
      endFrame: localEndFrame,
      start: Number((localStartFrame / fps).toFixed(6)),
      end: Number((localEndFrame / fps).toFixed(6))
    };
  });

if (cues.length === 0) errors.push("caption slice contains no cues");
for (const cue of cues) {
  if (cue.endFrame <= cue.startFrame) errors.push(`${cue.id}: invalid sliced frame range`);
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);

const sliced = {
  ...captions,
  source: {
    ...captions.source,
    sampleWindow: {
      globalStartFrame: startFrame,
      globalEndFrame: endFrame,
      globalStartSeconds: startSeconds,
      globalEndSeconds: endSeconds
    }
  },
  cues
};

fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(sliced, null, 2)}\n`);
console.log(`Created ${cues.length} caption cue(s) for ${startSeconds.toFixed(2)}–${endSeconds.toFixed(2)}s: ${outputPath}`);
