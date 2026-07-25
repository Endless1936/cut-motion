import fs from "node:fs";

const argumentsList = process.argv.slice(2);
const requireAudit = argumentsList.includes("--require-audit");
const planPath = argumentsList.find((argument) => argument !== "--require-audit");

if (!planPath || argumentsList.length > 2) {
  console.error("Usage: node check-trim-plan.mjs <trim-plan.json> [--require-audit]");
  process.exit(64);
}

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const errors = [];

if (!Number.isFinite(plan.fps) || plan.fps <= 0) errors.push("fps must be a positive number");
if (!Array.isArray(plan.remove)) {
  errors.push("remove must be an array");
} else {
  let previousEnd = -Infinity;
  plan.remove.forEach((range, index) => {
    const prefix = `remove[${index}]`;
    if (!Number.isFinite(range?.start) || range.start < 0) errors.push(`${prefix}.start must be a non-negative number`);
    if (!Number.isFinite(range?.end) || range.end <= range?.start) errors.push(`${prefix}.end must be greater than start`);
    if (Number.isFinite(range?.start) && range.start < previousEnd) errors.push(`${prefix} overlaps or is out of order`);
    if (Number.isFinite(range?.end)) previousEnd = range.end;
  });
}

if (requireAudit) {
  const profile = plan.trimProfile;
  const seams = plan.seams;
  const verification = plan.verification;

  if (!profile || typeof profile !== "object") {
    errors.push("trimProfile is required after precision trim");
  } else {
    if (typeof profile.name !== "string" || profile.name.length === 0) errors.push("trimProfile.name is required");
    const thresholds = profile.acousticThresholdsDb;
    if (!Array.isArray(thresholds) || thresholds.length !== 3 || ![-30, -35, -40].every((threshold) => thresholds.includes(threshold))) {
      errors.push("trimProfile.acousticThresholdsDb must include -30, -35, and -40");
    }
    if (!Number.isFinite(profile.outgoingHandleSeconds) || profile.outgoingHandleSeconds < 0) errors.push("trimProfile.outgoingHandleSeconds is required");
    if (!Number.isFinite(profile.incomingHandleSeconds) || profile.incomingHandleSeconds < 0) errors.push("trimProfile.incomingHandleSeconds is required");
    if (!Number.isInteger(profile.audioTransitionFrames) || profile.audioTransitionFrames < 0) errors.push("trimProfile.audioTransitionFrames is required");
    if (profile.name === "tight-talking-head") {
      if (profile.outgoingHandleSeconds !== 0.02) errors.push("tight-talking-head requires a 20 ms outgoing handle");
      if (profile.incomingHandleSeconds !== 0.05) errors.push("tight-talking-head requires a 50 ms incoming handle");
      if (profile.audioTransitionFrames !== 2) errors.push("tight-talking-head requires a two-frame audio transition");
    }
  }

  if (!Array.isArray(seams)) {
    errors.push("seams is required after precision trim");
  } else {
    seams.forEach((seam, index) => {
      const prefix = `seams[${index}]`;
      if (!seam || typeof seam !== "object") {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (typeof seam.id !== "string" || seam.id.length === 0) errors.push(`${prefix}.id is required`);
      if (typeof seam.classification !== "string" || seam.classification.length === 0) errors.push(`${prefix}.classification is required`);
      if (typeof seam.reason !== "string" || seam.reason.length === 0) errors.push(`${prefix}.reason is required`);
      if (typeof seam.semanticEvidence !== "string" || seam.semanticEvidence.length === 0) errors.push(`${prefix}.semanticEvidence is required`);
      if (typeof seam.visualEvidence !== "string" || seam.visualEvidence.length === 0) errors.push(`${prefix}.visualEvidence is required`);
      if (!Number.isFinite(seam.confidence) || seam.confidence < 0 || seam.confidence > 1) errors.push(`${prefix}.confidence must be between 0 and 1`);
      if (!Array.isArray(seam.acousticBoundaryFrames) || seam.acousticBoundaryFrames.length !== 3 || !seam.acousticBoundaryFrames.every(Number.isFinite)) {
        errors.push(`${prefix}.acousticBoundaryFrames must contain three numeric boundaries`);
      }
      if (!Number.isInteger(seam.appliedFrame) || seam.appliedFrame < 0) errors.push(`${prefix}.appliedFrame must be a non-negative integer`);
      if (!Number.isInteger(seam.audioTransitionFrames) || seam.audioTransitionFrames < 0) errors.push(`${prefix}.audioTransitionFrames is required`);
      if (profile?.name === "tight-talking-head" && seam.audioTransitionFrames !== 2) errors.push(`${prefix}.audioTransitionFrames must be two for tight-talking-head`);
      if (seam.pictureAudited !== true || seam.audioAudited !== true) errors.push(`${prefix} must record pictureAudited and audioAudited as true`);
    });
  }

  if (!verification || verification.everySeamAudited !== true || verification.contiguous !== true) {
    errors.push("verification must confirm every seam was audited and the timeline is contiguous");
  }
}

if (errors.length > 0) {
  console.error(`Trim plan failed: ${errors.join("; ")}`);
  process.exit(1);
}

console.log(`Trim plan passed${requireAudit ? " with seam audit" : ""}: ${Array.isArray(plan.seams) ? plan.seams.length : 0} seam(s)`);
