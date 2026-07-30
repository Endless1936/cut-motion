import fs from "node:fs";
import path from "node:path";
import {
  LONG_NATURAL_PAUSE_MS,
  validateDecisionPlan,
  validateFinalizedPlanStructure
} from "./trim-contract.mjs";
import {
  assertRegularContainedFile,
  sha256File
} from "./workflow-utils.mjs";
import { validateMediaDiagnostic } from "./diagnostic-contract.mjs";

const argumentsList = process.argv.slice(2);
const requireAudit = argumentsList.includes("--require-audit");
const mediaOptionIndex = argumentsList.indexOf("--media");
const mediaArgument = mediaOptionIndex >= 0 ? argumentsList[mediaOptionIndex + 1] : null;
const planArgument = argumentsList.find((argument, index) => argument !== "--require-audit"
  && argument !== "--media"
  && (mediaOptionIndex < 0 || index !== mediaOptionIndex + 1));

if (!planArgument || mediaOptionIndex >= 0 && !mediaArgument || requireAudit && !mediaArgument) {
  console.error("Usage: node check-trim-plan.mjs <trim-plan.json> [--require-audit --media roughcut.mp4]");
  process.exit(64);
}

const planPath = path.resolve(planArgument);
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const errors = requireAudit
  ? validateFinalizedPlanStructure(plan)
  : validateDecisionPlan(plan);

if (requireAudit) {
  const jobRoot = path.dirname(path.dirname(planPath));
  const stateRoot = path.join(jobRoot, "state");
  const inputRoot = path.join(jobRoot, "input");
  const roughcutRoot = path.join(jobRoot, "roughcut");
  const sourcePath = path.resolve(jobRoot, plan.source ?? "");
  const mediaPath = path.resolve(mediaArgument);
  try {
    assertRegularContainedFile(inputRoot, sourcePath, "Trim source media");
    if (plan.verification?.sourceMedia?.path !== plan.source
      || plan.verification?.sourceMedia?.sha256 !== sha256File(sourcePath)) {
      errors.push("verification.sourceMedia must match the current source hash");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const transcriptPath = path.resolve(jobRoot, plan.verification?.sourceTranscript?.path ?? "");
    assertRegularContainedFile(stateRoot, transcriptPath, "Source-aligned transcript");
    if (plan.verification?.sourceTranscript?.path !== "state/source-transcript.json"
      || plan.verification?.sourceTranscript?.sha256 !== sha256File(transcriptPath)) {
      errors.push("verification.sourceTranscript must match the immutable source-timeline transcript");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    assertRegularContainedFile(roughcutRoot, mediaPath, "Rough-cut media");
    const mediaRelativePath = path.relative(jobRoot, mediaPath);
    if (plan.verification?.roughCutMedia?.path !== mediaRelativePath
      || plan.verification?.roughCutMedia?.sha256 !== sha256File(mediaPath)) {
      errors.push("verification.roughCutMedia must match the current rough-cut hash");
    }
  } catch (error) {
    errors.push(error.message);
  }
  for (const [index, seam] of (plan.seams ?? []).entries()) {
    const diagnostic = seam?.risk?.diagnostic;
    if (!diagnostic) continue;
    try {
      const verified = validateMediaDiagnostic(jobRoot, diagnostic.path, {
        mediaRelativePath: plan.verification?.roughCutMedia?.path,
        mediaSha256: plan.verification?.roughCutMedia?.sha256,
        time: seam.outputFrame / plan.fps
      });
      if (diagnostic.sha256 !== verified.manifestSha256) {
        errors.push(`seams[${index}] diagnostic hash is stale`);
      }
      if (seam.risk.kind === "long-natural-pause"
        && seam.medianResidualSilenceFrames * 1000 / plan.fps <= LONG_NATURAL_PAUSE_MS) {
        errors.push(`seams[${index}] has a stale long-pause diagnostic`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
}

if (errors.length > 0) {
  console.error(`Trim plan failed: ${[...new Set(errors)].join("; ")}`);
  process.exit(1);
}

console.log(`Trim plan passed${requireAudit ? " with derived seam evidence" : ""}: ${plan.remove.length} edit(s)`);
