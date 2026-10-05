import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setup } from "./setup.mjs";

export function snapshotTimes(metadata) {
  return [...new Set(metadata.motions.map(motion => motion.snapshotAt))].sort((a, b) => a - b);
}
export function mgFrames(compositionInput, outputInput) {
  const composition = path.resolve(compositionInput);
  const metadata = JSON.parse(fs.readFileSync(path.join(composition, "composition.json"), "utf8"));
  const times = snapshotTimes(metadata);
  if (!times.length) return { output: null, count: 0 };
  const output = path.resolve(outputInput ?? path.join(composition, "../previews/mg"));
  fs.mkdirSync(output, { recursive: true });
  const runtime = setup(composition);
  const log = path.join(output, "snapshot.log"), logFd = fs.openSync(log, "w");
  let result;
  try {
    result = spawnSync(process.execPath, [runtime.cli, "snapshot", "--at", times.join(","), "--no-end", "--describe", "false", "--output", output, "."], { cwd: composition, stdio: ["ignore", logFd, logFd] });
  } finally { fs.closeSync(logFd); }
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `MG snapshot capture failed; details: ${log}`);
  return { output, count: times.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: mg-frames.mjs <composition-directory> [preview-directory]");
  const result = mgFrames(process.argv[2], process.argv[3]);
  console.log(`Captured ${result.count} MG frames${result.output ? `: ${result.output}` : ""}`);
}
