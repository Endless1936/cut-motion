export const TRIM_PLAN_SCHEMA_VERSION = 2;
export const TRIM_FINALIZER_VERSION = 1;
export const ACOUSTIC_THRESHOLDS_DB = [-30, -35, -40];
export const REMOVABLE_CLASSIFICATIONS = new Set([
  "reading-reset",
  "false-start",
  "restart",
  "body-reset",
  "reset-removed",
  "duplicate-take"
]);
export const ALLOWED_CLASSIFICATIONS = new Set([
  ...REMOVABLE_CLASSIFICATIONS,
  "natural-pause"
]);
export const LONG_NATURAL_PAUSE_MS = 180;
export const TIGHT_TALKING_HEAD_PROFILE = Object.freeze({
  name: "tight-talking-head",
  acousticThresholdsDb: ACOUSTIC_THRESHOLDS_DB,
  outgoingHandleSeconds: 0.02,
  incomingHandleSeconds: 0.05,
  audioTransitionFrameCeiling: 2,
  maximumResidualSilenceMs: 80,
  longNaturalPauseRiskMs: LONG_NATURAL_PAUSE_MS
});

const decisionKeys = new Set([
  "startFrame",
  "endFrame",
  "classification",
  "reason",
  "semanticEvidence",
  "confidence",
  "audioTransitionFrames",
  "diagnostic"
]);
const diagnosticKeys = new Set(["path", "finding"]);
const topLevelKeys = new Set([
  "schemaVersion",
  "source",
  "fps",
  "remove",
  "trimProfile",
  "seams",
  "verification"
]);
const legacyEvidenceKeys = new Set([
  "acousticBoundaryFrames",
  "appliedFrame",
  "pictureAudited",
  "audioAudited",
  "visualEvidence"
]);

export const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};
export const conservativeBoundary = (values, side) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (sorted.length === 2) return side === "outgoing" ? sorted[1] : sorted[0];
  return sorted[Math.floor(sorted.length / 2)];
};

export const requiredHandleFrames = (fps) => ({
  outgoing: Math.max(1, Math.ceil(TIGHT_TALKING_HEAD_PROFILE.outgoingHandleSeconds * fps)),
  incoming: Math.max(1, Math.floor(TIGHT_TALKING_HEAD_PROFILE.incomingHandleSeconds * fps))
});

export const effectiveResidualCeilingFrames = (fps) => Math.floor(
  TIGHT_TALKING_HEAD_PROFILE.maximumResidualSilenceMs * fps / 1000
);

export const normalizeDecisionPlan = (plan) => ({
  schemaVersion: TRIM_PLAN_SCHEMA_VERSION,
  source: plan.source,
  fps: plan.fps,
  remove: (plan.remove ?? []).map((decision) => ({
    startFrame: decision.startFrame,
    endFrame: decision.endFrame,
    classification: decision.classification,
    reason: decision.reason,
    semanticEvidence: decision.semanticEvidence,
    confidence: decision.confidence,
    audioTransitionFrames: decision.audioTransitionFrames,
    ...(decision.diagnostic ? {
      diagnostic: {
        path: decision.diagnostic.path,
        finding: decision.diagnostic.finding
      }
    } : {})
  }))
});

export const validateDecisionPlan = (plan) => {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["trim plan must be an object"];
  for (const key of Object.keys(plan)) {
    if (!topLevelKeys.has(key)) errors.push(`${key} is not a trim-plan field`);
  }
  if (typeof plan.source !== "string" || plan.source.length === 0 || plan.source.startsWith("/")) {
    errors.push("source must be a non-empty job-relative path");
  }
  if (!Number.isInteger(plan.fps) || plan.fps <= 0) errors.push("fps must be a positive integer timeline rate");
  if (!Array.isArray(plan.remove)) {
    errors.push("remove must be an array");
    return errors;
  }

  let previousEnd = -1;
  for (const [index, decision] of plan.remove.entries()) {
    const prefix = `remove[${index}]`;
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    for (const key of Object.keys(decision)) {
      if (!decisionKeys.has(key)) errors.push(`${prefix}.${key} is not an editable trim decision field`);
      if (legacyEvidenceKeys.has(key)) errors.push(`${prefix}.${key} is legacy self-reported evidence`);
    }
    if (!Number.isInteger(decision.startFrame) || decision.startFrame < 0) {
      errors.push(`${prefix}.startFrame must be a non-negative integer`);
    }
    if (!Number.isInteger(decision.endFrame) || decision.endFrame <= decision.startFrame) {
      errors.push(`${prefix}.endFrame must be an integer greater than startFrame`);
    }
    if (index > 0 && Number.isInteger(decision.startFrame) && decision.startFrame <= previousEnd) {
      errors.push(`${prefix} overlaps, touches the previous range, or is out of order; merge adjacent removals`);
    }
    if (Number.isInteger(decision.endFrame)) previousEnd = decision.endFrame;
    if (!ALLOWED_CLASSIFICATIONS.has(decision.classification)) {
      errors.push(`${prefix}.classification must be explicitly selected`);
    }
    if (typeof decision.reason !== "string" || decision.reason.trim().length === 0) {
      errors.push(`${prefix}.reason is required`);
    }
    if (typeof decision.semanticEvidence !== "string" || decision.semanticEvidence.trim().length === 0) {
      errors.push(`${prefix}.semanticEvidence is required`);
    }
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      errors.push(`${prefix}.confidence must be between zero and one`);
    }
    if (!Number.isInteger(decision.audioTransitionFrames)
      || decision.audioTransitionFrames < 0
      || decision.audioTransitionFrames > TIGHT_TALKING_HEAD_PROFILE.audioTransitionFrameCeiling) {
      errors.push(`${prefix}.audioTransitionFrames must be between zero and two`);
    }
    if (decision.diagnostic != null) {
      if (!decision.diagnostic || typeof decision.diagnostic !== "object" || Array.isArray(decision.diagnostic)) {
        errors.push(`${prefix}.diagnostic must be an object`);
      } else {
        for (const key of Object.keys(decision.diagnostic)) {
          if (!diagnosticKeys.has(key)) errors.push(`${prefix}.diagnostic.${key} is not allowed`);
        }
        if (typeof decision.diagnostic.path !== "string" || decision.diagnostic.path.length === 0 || decision.diagnostic.path.startsWith("/")) {
          errors.push(`${prefix}.diagnostic.path must be a job-relative path`);
        }
        if (typeof decision.diagnostic.finding !== "string" || decision.diagnostic.finding.trim().length < 8) {
          errors.push(`${prefix}.diagnostic.finding must record the visual and audio decision`);
        }
      }
    }
  }
  return errors;
};

export const validateFinalizedPlanStructure = (plan) => {
  const errors = validateDecisionPlan(plan);
  if (plan.schemaVersion !== TRIM_PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${TRIM_PLAN_SCHEMA_VERSION}`);
  if (plan.verification?.finalizerVersion !== TRIM_FINALIZER_VERSION) {
    errors.push(`verification.finalizerVersion must be ${TRIM_FINALIZER_VERSION}`);
  }
  if (JSON.stringify(plan.trimProfile) !== JSON.stringify(TIGHT_TALKING_HEAD_PROFILE)) {
    errors.push("trimProfile must be generated by the canonical finalizer");
  }
  if (!Array.isArray(plan.seams) || plan.seams.length !== plan.remove.length) {
    errors.push("seams must be generated one-for-one from remove decisions");
    return errors;
  }

  const handles = requiredHandleFrames(plan.fps);
  const residualCeilingFrames = effectiveResidualCeilingFrames(plan.fps);
  const sourceFrames = plan.verification?.sourceMedia?.durationFrames;
  let removedBefore = 0;
  for (const [index, seam] of plan.seams.entries()) {
    const prefix = `seams[${index}]`;
    const decision = plan.remove[index];
    const expectedOutputFrame = decision.startFrame - removedBefore;
    const hasOutgoing = decision.startFrame > 0;
    const hasIncoming = Number.isInteger(sourceFrames) && decision.endFrame < sourceFrames;
    const expectedKind = hasOutgoing && hasIncoming ? "internal" : hasIncoming ? "head" : "tail";
    if (seam?.id !== `seam-${String(index + 1).padStart(3, "0")}`) errors.push(`${prefix}.id is not canonical`);
    if (seam?.removeIndex !== index) errors.push(`${prefix}.removeIndex is invalid`);
    if (seam?.kind !== expectedKind) errors.push(`${prefix}.kind is invalid`);
    if (seam?.outgoingFrame !== decision.startFrame || seam?.incomingFrame !== decision.endFrame) {
      errors.push(`${prefix} cut frames do not match the editing decision`);
    }
    if (seam?.outputFrame !== expectedOutputFrame) errors.push(`${prefix}.outputFrame is invalid`);
    const outgoingBoundaries = seam?.acoustic?.outgoingBoundaryFrames;
    const incomingBoundaries = seam?.acoustic?.incomingBoundaryFrames;
    const quietAfterCut = seam?.acoustic?.outgoingQuietAfterCutFrames;
    if (!Array.isArray(outgoingBoundaries)
      || outgoingBoundaries.length !== ACOUSTIC_THRESHOLDS_DB.length
      || !outgoingBoundaries.every((value) => value === null || Number.isInteger(value))
      || hasOutgoing && outgoingBoundaries.filter(Number.isInteger).length < 2) {
      errors.push(`${prefix}.acoustic.outgoingBoundaryFrames is invalid`);
    }
    if (!Array.isArray(incomingBoundaries)
      || incomingBoundaries.length !== ACOUSTIC_THRESHOLDS_DB.length
      || !incomingBoundaries.every((value) => value === null || Number.isInteger(value))
      || hasIncoming && incomingBoundaries.filter(Number.isInteger).length < 2) {
      errors.push(`${prefix}.acoustic.incomingBoundaryFrames is invalid`);
    }
    const expectedOutgoingBoundary = hasOutgoing
      ? conservativeBoundary(outgoingBoundaries?.filter(Number.isInteger) ?? [], "outgoing")
      : decision.startFrame;
    const expectedIncomingBoundary = hasIncoming
      ? conservativeBoundary(incomingBoundaries?.filter(Number.isInteger) ?? [], "incoming")
      : decision.endFrame;
    if (Array.isArray(outgoingBoundaries)
      && seam?.acoustic?.consensusOutgoingBoundaryFrame !== expectedOutgoingBoundary) {
      errors.push(`${prefix}.acoustic.consensusOutgoingBoundaryFrame is invalid`);
    }
    if (Array.isArray(incomingBoundaries)
      && seam?.acoustic?.consensusIncomingBoundaryFrame !== expectedIncomingBoundary) {
      errors.push(`${prefix}.acoustic.consensusIncomingBoundaryFrame is invalid`);
    }
    if (JSON.stringify(seam?.acoustic?.thresholdsDb) !== JSON.stringify(ACOUSTIC_THRESHOLDS_DB)) {
      errors.push(`${prefix}.acoustic.thresholdsDb is invalid`);
    }
    if (!Array.isArray(quietAfterCut)
      || quietAfterCut.length !== ACOUSTIC_THRESHOLDS_DB.length
      || !quietAfterCut.every((value) => Number.isInteger(value) && value >= 0)) {
      errors.push(`${prefix}.acoustic.outgoingQuietAfterCutFrames is invalid`);
    }
    const expectedOutgoingHandle = decision.startFrame - expectedOutgoingBoundary;
    const expectedIncomingHandle = expectedIncomingBoundary - decision.endFrame;
    const expectedTransitionSafeFrames = Array.isArray(quietAfterCut) ? median(quietAfterCut) : -1;
    if (seam?.handles?.outgoingFrames !== expectedOutgoingHandle
      || seam?.handles?.incomingFrames !== expectedIncomingHandle
      || seam?.handles?.transitionSafeFrames !== expectedTransitionSafeFrames
      || seam?.handles?.requiredOutgoingFrames !== (hasOutgoing ? handles.outgoing : 0)
      || seam?.handles?.requiredIncomingFrames !== (hasIncoming ? handles.incoming : 0)) {
      errors.push(`${prefix}.handles is inconsistent with its acoustic boundaries`);
    }
    if (hasOutgoing && expectedOutgoingHandle < handles.outgoing) errors.push(`${prefix} clips the outgoing safety handle`);
    if (hasIncoming && expectedIncomingHandle < handles.incoming) errors.push(`${prefix} clips the incoming safety handle`);
    if (expectedKind !== "internal" && decision.audioTransitionFrames !== 0) {
      errors.push(`${prefix} head and tail trims cannot use an audio transition`);
    } else if (decision.audioTransitionFrames > expectedTransitionSafeFrames) {
      errors.push(`${prefix} audio transition restores non-quiet removed audio`);
    }
    if (expectedKind === "internal" && decision.audioTransitionFrames > expectedIncomingHandle) {
      errors.push(`${prefix} audio transition attenuates the incoming speech onset`);
    }
    const lexical = seam?.lexical;
    const outgoingWordHandle = lexical?.outgoingWord == null
      ? null
      : decision.startFrame - lexical.outgoingWord.endFrame;
    const incomingWordHandle = lexical?.incomingWord == null
      ? null
      : lexical.incomingWord.startFrame - decision.endFrame;
    if (!lexical
      || lexical.outgoingHandleFrames !== outgoingWordHandle
      || lexical.incomingHandleFrames !== incomingWordHandle) {
      errors.push(`${prefix}.lexical is inconsistent with its transcript word anchors`);
    }
    if (hasOutgoing && outgoingWordHandle != null && outgoingWordHandle < handles.outgoing) {
      errors.push(`${prefix} touches the outgoing transcript word`);
    }
    if (hasIncoming && incomingWordHandle != null && incomingWordHandle < handles.incoming) {
      errors.push(`${prefix} touches the incoming transcript word`);
    }
    const residualValues = ACOUSTIC_THRESHOLDS_DB.map((threshold) => seam?.residualSilenceFrames?.[String(threshold)]);
    if (!residualValues.every((value) => Number.isInteger(value) && value >= 0)) {
      errors.push(`${prefix}.residualSilenceFrames is invalid`);
    } else if (seam.medianResidualSilenceFrames !== median(residualValues)) {
      errors.push(`${prefix}.medianResidualSilenceFrames is invalid`);
    }
    if (REMOVABLE_CLASSIFICATIONS.has(decision.classification)
      && seam?.medianResidualSilenceFrames > residualCeilingFrames) {
      errors.push(`${prefix} exceeds the removable-seam residual-silence ceiling`);
    }
    const longNaturalPause = decision.classification === "natural-pause"
      && seam?.medianResidualSilenceFrames * 1000 / plan.fps > LONG_NATURAL_PAUSE_MS;
    if (longNaturalPause) {
      if (seam?.risk?.kind !== "long-natural-pause"
        || !seam.risk.diagnostic?.sha256
        || seam.risk.diagnostic.path !== decision.diagnostic?.path
        || seam.risk.diagnostic.finding !== decision.diagnostic?.finding) {
        errors.push(`${prefix} requires a hash-bound long-pause diagnostic`);
      }
    } else if (seam?.risk != null) {
      errors.push(`${prefix}.risk must be absent when no long-pause risk was derived`);
    }
    removedBefore += decision.endFrame - decision.startFrame;
  }
  const expectedOutputFrames = sourceFrames - plan.remove.reduce(
    (sum, decision) => sum + decision.endFrame - decision.startFrame,
    0
  );
  if (!Number.isInteger(sourceFrames) || sourceFrames <= 0) {
    errors.push("verification.sourceMedia.durationFrames is invalid");
  } else if (plan.verification?.expectedOutputFrames !== expectedOutputFrames) {
    errors.push("verification.expectedOutputFrames is inconsistent with the edit decisions");
  }
  const actualOutputFrames = plan.verification?.roughCutMedia?.durationFrames;
  if (!Number.isInteger(actualOutputFrames)
    || Math.abs(actualOutputFrames - plan.verification?.expectedOutputFrames) > 1) {
    errors.push("verification.roughCutMedia.durationFrames does not match the expected output");
  }
  return errors;
};
