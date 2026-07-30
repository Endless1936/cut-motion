import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRenderInputs } from "./render-manifest.mjs";
import { readJson, writeJsonAtomic } from "./workflow-utils.mjs";

// Agent-facing locator only. Render Manifest is the content and approval authority.
export const deriveMotionIndex = (jobRootInput, manifest = null) => {
  const inputs = manifest ?? deriveRenderInputs(jobRootInput);
  return {
    schemaVersion: "2.0.0",
    duration: inputs.duration,
    beats: inputs.beats.map(({ beatId, modulePath, rootSelector, captionCueIds, window }) => ({
      beatId,
      modulePath,
      rootSelector,
      captionCueIds,
      window
    })),
    captions: inputs.captions.map(({ cueId, window }) => ({ cueId, window }))
  };
};

export const writeMotionIndex = (jobRootInput, manifest = null) => {
  const jobRoot = path.resolve(jobRootInput);
  const outputPath = path.join(jobRoot, "state", "motion-index.json");
  const index = deriveMotionIndex(jobRoot, manifest);
  writeJsonAtomic(outputPath, index);
  return { outputPath, index };
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const [command, jobRoot] = process.argv.slice(2);
  if (!["generate", "check"].includes(command) || !jobRoot) {
    console.error("Usage: node motion-index.mjs <generate|check> <job-directory>");
    process.exit(64);
  }
  const expected = deriveMotionIndex(jobRoot);
  const outputPath = path.join(path.resolve(jobRoot), "state", "motion-index.json");
  if (command === "generate") writeJsonAtomic(outputPath, expected);
  else if (!fs.existsSync(outputPath) || JSON.stringify(readJson(outputPath)) !== JSON.stringify(expected)) {
    throw new Error("Motion Index is missing or stale");
  }
  console.log(`${command === "generate" ? "Generated" : "Verified"} ${outputPath}`);
}
