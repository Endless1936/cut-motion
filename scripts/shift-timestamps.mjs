import fs from "node:fs";
import path from "node:path";
import { cutFromSeconds, retimeDocument } from "./timeline-cut-utils.mjs";

const [input, start, end, output, explicitFps] = process.argv.slice(2);
if (!input || !output || process.argv.length > 7) {
  console.error("Usage: node shift-timestamps.mjs <input.json> <cut-start-seconds> <cut-end-seconds> <new-output.json> [fps]");
  process.exit(64);
}
const document = JSON.parse(fs.readFileSync(input, "utf8"));
const fps = explicitFps === undefined ? document.source?.fps ?? document.fps : Number(explicitFps);
const cut = cutFromSeconds(fps, Number(start), Number(end));
const result = retimeDocument(document, cut);
// Never replace a settled artifact, including through a symlink or hard link.
if (path.resolve(input) === path.resolve(output) || fs.existsSync(output)) throw new Error("Output must be a new candidate file");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result.document, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, cut, removedIds: result.removedIds,
  status: "candidate-only: re-align transcript, rebuild media/composition, and refresh downstream state before delivery" }));
