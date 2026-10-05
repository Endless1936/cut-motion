import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setup } from "./setup.mjs";
import { probe } from "./compose.mjs";

export function render(compositionInput, outputInput) {
  const composition = path.resolve(compositionInput);
  const metadata = JSON.parse(fs.readFileSync(path.join(composition, "composition.json"), "utf8"));
  const output = path.resolve(outputInput ?? path.join(composition, "../output/final.mp4"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.tmp.mp4`);
  const runtime = setup(composition);
  const log = path.join(composition, "render.log"), logFd = fs.openSync(log, "w");
  try {
    const result = spawnSync(process.execPath, [runtime.cli, "render", "--composition", "index.html", "--quality", "high", "--output", temporary, "."], { cwd: composition, stdio: ["ignore", logFd, logFd] });
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `HyperFrames render failed; details: ${log}`);
    const media = probe(temporary), video = media.streams.find(stream => stream.codec_type === "video");
    const duration = Number(media.format.duration);
    if (!video || !media.streams.some(stream => stream.codec_type === "audio") || video.width !== metadata.width || video.height !== metadata.height || !Number.isFinite(duration) || Math.abs(duration - metadata.duration) > 2 / metadata.fps) throw new Error("Rendered video has missing audio or incorrect dimensions/duration");
    fs.renameSync(temporary, output);
    return output;
  } finally { fs.closeSync(logFd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: render.mjs <composition-directory> [final.mp4]");
  console.log(`Rendered: ${render(process.argv[2], process.argv[3])}`);
}
