import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ACOUSTIC_THRESHOLDS_DB,
  LONG_NATURAL_PAUSE_MS,
  REMOVABLE_CLASSIFICATIONS,
  TIGHT_TALKING_HEAD_PROFILE,
  TRIM_FINALIZER_VERSION,
  conservativeBoundary,
  effectiveResidualCeilingFrames,
  median,
  normalizeDecisionPlan,
  requiredHandleFrames,
  validateDecisionPlan,
  validateFinalizedPlanStructure
} from "./trim-contract.mjs";
import {
  assertRegularContainedFile,
  readJson,
  sha256File,
  sha256Text,
  writeJsonAtomic
} from "./workflow-utils.mjs";
import { validateMediaDiagnostic } from "./diagnostic-contract.mjs";

const [planArgument, mediaArgument, ...rawOptions] = process.argv.slice(2);
const expectedTranscriptOption = rawOptions.indexOf("--expected-source-transcript-sha");
const expectedSourceTranscriptSha256 = expectedTranscriptOption >= 0
  ? rawOptions[expectedTranscriptOption + 1]
  : null;
if (!planArgument || !mediaArgument) {
  console.error("Usage: node finalize-trim-plan.mjs <state/trim-plan.json> <roughcut/a-roll.mp4> [--expected-source-transcript-sha <sha256>]");
  process.exit(64);
}
if (expectedTranscriptOption >= 0
  ? expectedTranscriptOption !== 0
    || rawOptions.length !== 2
    || !/^[a-f0-9]{64}$/.test(expectedSourceTranscriptSha256 ?? "")
  : rawOptions.length !== 0) {
  throw new Error("Expected source-transcript SHA-256 option is invalid");
}

const run = (command, argumentsList, label) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${label}: ${(result.stderr || result.stdout).trim()}`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const probeMedia = (mediaPath, label) => {
  const probe = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-select_streams", "v:0",
    "-show_entries", "format=duration",
    "-show_entries", "stream=nb_read_frames,nb_frames,r_frame_rate",
    "-of", "json",
    mediaPath
  ], `${label} probe failed`));
  const duration = Number(probe.format?.duration);
  const video = probe.streams?.[0];
  if (!Number.isFinite(duration) || duration <= 0 || !video) throw new Error(`${label} has no readable video duration`);
  const frameCount = Number(video.nb_read_frames ?? video.nb_frames);
  return {
    duration,
    frameCount: Number.isInteger(frameCount) && frameCount > 0 ? frameCount : null,
    videoFrameRate: video.r_frame_rate
  };
};

const assertAudio = (mediaPath, label) => {
  const probe = JSON.parse(run("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_type",
    "-of", "json",
    mediaPath
  ], `${label} audio probe failed`));
  if (probe.streams?.[0]?.codec_type !== "audio") throw new Error(`${label} has no audio stream`);
};

const detectSilence = (mediaPath, threshold, duration) => {
  const output = run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", mediaPath,
    "-vn", "-af", `silencedetect=noise=${threshold}dB:d=0.02`,
    "-f", "null", "-"
  ], `Silence detection failed at ${threshold} dB`);
  const events = [...output.matchAll(/silence_(start|end):\s*([0-9.]+)/g)]
    .map((match) => ({ type: match[1], time: Number(match[2]) }));
  const intervals = [];
  let start = null;
  for (const event of events) {
    if (event.type === "start") {
      start = event.time;
    } else {
      intervals.push({ start: start ?? 0, end: event.time });
      start = null;
    }
  }
  if (start !== null) intervals.push({ start, end: duration });
  return intervals;
};

const containingInterval = (time, intervals) => intervals.find(
  (interval) => interval.start <= time + 1e-6 && interval.end >= time - 1e-6
);

const planPath = path.resolve(planArgument);
if (path.basename(planPath) !== "trim-plan.json" || path.basename(path.dirname(planPath)) !== "state") {
  throw new Error("Trim finalization requires state/trim-plan.json");
}
const jobRoot = path.dirname(path.dirname(planPath));
const stateRoot = path.join(jobRoot, "state");
const inputRoot = path.join(jobRoot, "input");
const roughcutRoot = path.join(jobRoot, "roughcut");
assertRegularContainedFile(stateRoot, planPath, "Trim plan");

const authoredPlan = readJson(planPath);
const decisionErrors = validateDecisionPlan(authoredPlan);
if (decisionErrors.length > 0) throw new Error(`Trim decisions failed: ${decisionErrors.join("; ")}`);
const plan = normalizeDecisionPlan(authoredPlan);
const projectPath = path.join(stateRoot, "project.json");
assertRegularContainedFile(stateRoot, projectPath, "Project state");
const project = readJson(projectPath);
if (plan.source !== project.sourceVideo) throw new Error("Trim plan source must match project.sourceVideo");

const sourcePath = path.resolve(jobRoot, plan.source);
const mediaPath = path.resolve(mediaArgument);
assertRegularContainedFile(inputRoot, sourcePath, "Trim source media");
assertRegularContainedFile(roughcutRoot, mediaPath, "Rough-cut media");
assertAudio(sourcePath, "Trim source media");
assertAudio(mediaPath, "Rough-cut media");
const sourceProbe = probeMedia(sourcePath, "Trim source media");
const mediaProbe = probeMedia(mediaPath, "Rough-cut media");
const sourceTotalFrames = Math.ceil(sourceProbe.duration * plan.fps);
const sourceSha256 = sha256File(sourcePath);
const mediaSha256 = sha256File(mediaPath);
const sourceTranscriptPath = path.join(stateRoot, "source-transcript.json");
const activeTranscriptPath = path.join(stateRoot, "transcript.json");
const sourceTranscriptExists = fs.existsSync(sourceTranscriptPath);
const workflowPath = path.join(stateRoot, "workflow.json");
const workflowSourceTranscriptSha256 = fs.existsSync(workflowPath)
  ? readJson(workflowPath).sourceTranscriptSha256 ?? null
  : null;
if (expectedSourceTranscriptSha256 && workflowSourceTranscriptSha256
  && expectedSourceTranscriptSha256 !== workflowSourceTranscriptSha256) {
  throw new Error("Expected source transcript does not match the workflow lock");
}
const boundSourceTranscriptSha256 = expectedSourceTranscriptSha256
  ?? workflowSourceTranscriptSha256
  ?? authoredPlan.verification?.sourceTranscript?.sha256
  ?? null;
if (sourceTranscriptExists && !boundSourceTranscriptSha256) {
  throw new Error("Existing source transcript is not bound to the workflow or prior finalized plan");
}
if (!sourceTranscriptExists && boundSourceTranscriptSha256) {
  throw new Error("Bound source transcript is missing");
}
const transcriptPath = sourceTranscriptExists ? sourceTranscriptPath : activeTranscriptPath;
assertRegularContainedFile(stateRoot, transcriptPath, "Source-aligned transcript");
if (sourceTranscriptExists && sha256File(sourceTranscriptPath) !== boundSourceTranscriptSha256) {
  throw new Error("Source transcript changed after its timeline lock");
}
const sourceTranscript = readJson(transcriptPath);
const sourceTranscriptSha256 = sourceTranscriptExists
  ? sha256File(sourceTranscriptPath)
  : sha256Text(`${JSON.stringify(sourceTranscript, null, 2)}\n`);
const transcriptWords = (sourceTranscript.segments ?? []).flatMap((segment) => (
  (segment.words ?? []).map((word, index) => {
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Source transcript word timing is invalid in ${segment.id ?? "segment"}`);
    }
    return {
      id: word.id ?? `${segment.id}:word-${String(index + 1).padStart(3, "0")}`,
      text: String(word.text ?? ""),
      startFrame: Math.max(0, Math.floor(start * plan.fps + 1e-6)),
      endFrame: Math.min(sourceTotalFrames, Math.ceil(end * plan.fps - 1e-6))
    };
  })
)).sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
if (transcriptWords.length === 0) throw new Error("Source-aligned transcript requires word timestamps");
for (const [index, decision] of plan.remove.entries()) {
  if (decision.endFrame > sourceTotalFrames) throw new Error(`remove[${index}] exceeds the source timeline`);
}

const sourceSilence = new Map(ACOUSTIC_THRESHOLDS_DB.map(
  (threshold) => [threshold, detectSilence(sourcePath, threshold, sourceProbe.duration)]
));
const mediaSilence = new Map(ACOUSTIC_THRESHOLDS_DB.map(
  (threshold) => [threshold, detectSilence(mediaPath, threshold, mediaProbe.duration)]
));
const handles = requiredHandleFrames(plan.fps);
const residualCeilingFrames = effectiveResidualCeilingFrames(plan.fps);
const errors = [];
let removedBefore = 0;

plan.seams = plan.remove.map((decision, index) => {
  const id = `seam-${String(index + 1).padStart(3, "0")}`;
  const outgoingTime = decision.startFrame / plan.fps;
  const incomingTime = decision.endFrame / plan.fps;
  const outputFrame = decision.startFrame - removedBefore;
  const outputTime = outputFrame / plan.fps;
  const hasOutgoing = decision.startFrame > 0;
  const hasIncoming = decision.endFrame < sourceTotalFrames;
  const seamKind = hasOutgoing && hasIncoming ? "internal" : hasIncoming ? "head" : "tail";
  const outgoingBoundaryFrames = [];
  const incomingBoundaryFrames = [];
  const outgoingQuietAfterCutFrames = [];
  const residualSilenceFrames = {};

  for (const threshold of ACOUSTIC_THRESHOLDS_DB) {
    const outgoingInterval = containingInterval(outgoingTime, sourceSilence.get(threshold));
    const incomingInterval = containingInterval(incomingTime, sourceSilence.get(threshold));
    if (!outgoingInterval) {
      outgoingBoundaryFrames.push(null);
      outgoingQuietAfterCutFrames.push(0);
    } else {
      outgoingBoundaryFrames.push(Math.ceil(outgoingInterval.start * plan.fps - 1e-6));
      outgoingQuietAfterCutFrames.push(Math.max(
        0,
        Math.floor(outgoingInterval.end * plan.fps + 1e-6) - decision.startFrame
      ));
    }
    if (!incomingInterval) {
      incomingBoundaryFrames.push(null);
    } else {
      incomingBoundaryFrames.push(Math.floor(incomingInterval.end * plan.fps + 1e-6));
    }
    const residualInterval = containingInterval(outputTime, mediaSilence.get(threshold));
    residualSilenceFrames[String(threshold)] = residualInterval
      ? Math.max(0, Math.floor((residualInterval.end - residualInterval.start) * plan.fps + 1e-6))
      : 0;
  }

  const validOutgoingBoundaries = outgoingBoundaryFrames.filter(Number.isInteger);
  const validIncomingBoundaries = incomingBoundaryFrames.filter(Number.isInteger);
  if (hasOutgoing && validOutgoingBoundaries.length < 2) {
    errors.push(`${id}: outgoing cut is not inside quiet audio at two of three thresholds`);
  }
  if (hasIncoming && validIncomingBoundaries.length < 2) {
    errors.push(`${id}: incoming cut is not inside quiet audio at two of three thresholds`);
  }
  const consensusOutgoingBoundaryFrame = hasOutgoing
    ? conservativeBoundary(validOutgoingBoundaries, "outgoing")
    : decision.startFrame;
  const consensusIncomingBoundaryFrame = hasIncoming
    ? conservativeBoundary(validIncomingBoundaries, "incoming")
    : decision.endFrame;
  const outgoingHandleFrames = decision.startFrame - consensusOutgoingBoundaryFrame;
  const incomingHandleFrames = consensusIncomingBoundaryFrame - decision.endFrame;
  const transitionSafeFrames = median(outgoingQuietAfterCutFrames);
  if (hasOutgoing && outgoingHandleFrames < handles.outgoing) {
    errors.push(`${id}: outgoing handle is ${outgoingHandleFrames} frame(s), requires ${handles.outgoing}`);
  }
  if (hasIncoming && incomingHandleFrames < handles.incoming) {
    errors.push(`${id}: incoming handle is ${incomingHandleFrames} frame(s), requires ${handles.incoming}`);
  }
  if (seamKind !== "internal" && decision.audioTransitionFrames !== 0) {
    errors.push(`${id}: head and tail trims cannot use an audio transition`);
  } else if (decision.audioTransitionFrames > transitionSafeFrames) {
    errors.push(`${id}: ${decision.audioTransitionFrames}-frame transition reaches beyond quiet outgoing audio`);
  }
  if (seamKind === "internal" && decision.audioTransitionFrames > incomingHandleFrames) {
    errors.push(`${id}: ${decision.audioTransitionFrames}-frame transition attenuates the incoming speech onset`);
  }
  const outgoingWord = [...transcriptWords].reverse().find((word) => word.startFrame < decision.startFrame) ?? null;
  const incomingWord = transcriptWords.find((word) => word.endFrame > decision.endFrame) ?? null;
  const outgoingWordHandleFrames = outgoingWord ? decision.startFrame - outgoingWord.endFrame : null;
  const incomingWordHandleFrames = incomingWord ? incomingWord.startFrame - decision.endFrame : null;
  if (hasOutgoing && outgoingWord && outgoingWordHandleFrames < handles.outgoing) {
    errors.push(`${id}: outgoing cut touches transcript word "${outgoingWord.text}"`);
  }
  if (hasIncoming && incomingWord && incomingWordHandleFrames < handles.incoming) {
    errors.push(`${id}: incoming cut touches transcript word "${incomingWord.text}"`);
  }
  const medianResidualSilenceFrames = median(Object.values(residualSilenceFrames));
  if (REMOVABLE_CLASSIFICATIONS.has(decision.classification)
    && medianResidualSilenceFrames > residualCeilingFrames) {
    errors.push(`${id}: residual silence is ${medianResidualSilenceFrames} frames, exceeds ${residualCeilingFrames}`);
  }

  const longNaturalPause = decision.classification === "natural-pause"
    && medianResidualSilenceFrames * 1000 / plan.fps > LONG_NATURAL_PAUSE_MS;
  let risk;
  if (longNaturalPause) {
    const diagnostic = decision.diagnostic;
    if (!diagnostic) {
      errors.push(`${id}: long natural pause requires a filmstrip-waveform diagnostic and recorded finding`);
    } else {
      try {
        const verified = validateMediaDiagnostic(jobRoot, diagnostic.path, {
          mediaRelativePath: path.relative(jobRoot, mediaPath),
          mediaSha256,
          time: outputTime
        });
        risk = {
          kind: "long-natural-pause",
          thresholdMs: LONG_NATURAL_PAUSE_MS,
          diagnostic: {
            path: diagnostic.path,
            sha256: verified.manifestSha256,
            finding: diagnostic.finding
          }
        };
      } catch (error) {
        errors.push(`${id}: ${error.message}`);
      }
    }
  }

  removedBefore += decision.endFrame - decision.startFrame;
  return {
    id,
    removeIndex: index,
    kind: seamKind,
    outgoingFrame: decision.startFrame,
    incomingFrame: decision.endFrame,
    outputFrame,
    acoustic: {
      thresholdsDb: ACOUSTIC_THRESHOLDS_DB,
      outgoingBoundaryFrames,
      incomingBoundaryFrames,
      outgoingQuietAfterCutFrames,
      consensusOutgoingBoundaryFrame,
      consensusIncomingBoundaryFrame
    },
    handles: {
      outgoingFrames: outgoingHandleFrames,
      incomingFrames: incomingHandleFrames,
      transitionSafeFrames,
      requiredOutgoingFrames: hasOutgoing ? handles.outgoing : 0,
      requiredIncomingFrames: hasIncoming ? handles.incoming : 0
    },
    lexical: {
      outgoingWord: outgoingWord ? {
        id: outgoingWord.id,
        text: outgoingWord.text,
        endFrame: outgoingWord.endFrame
      } : null,
      incomingWord: incomingWord ? {
        id: incomingWord.id,
        text: incomingWord.text,
        startFrame: incomingWord.startFrame
      } : null,
      outgoingHandleFrames: outgoingWordHandleFrames,
      incomingHandleFrames: incomingWordHandleFrames
    },
    residualSilenceFrames,
    medianResidualSilenceFrames,
    ...(risk ? { risk } : {})
  };
});

const expectedOutputFrames = sourceTotalFrames - plan.remove.reduce(
  (sum, decision) => sum + decision.endFrame - decision.startFrame,
  0
);
const actualOutputFrames = mediaProbe.frameCount ?? Math.round(mediaProbe.duration * plan.fps);
if (Math.abs(actualOutputFrames - expectedOutputFrames) > 1) {
  errors.push(`rough-cut frame count ${actualOutputFrames} does not match expected ${expectedOutputFrames}`);
}

plan.trimProfile = TIGHT_TALKING_HEAD_PROFILE;
plan.verification = {
  finalizerVersion: TRIM_FINALIZER_VERSION,
  sourceMedia: {
    path: plan.source,
    sha256: sourceSha256,
    durationFrames: sourceTotalFrames,
    videoFrameRate: sourceProbe.videoFrameRate
  },
  roughCutMedia: {
    path: path.relative(jobRoot, mediaPath),
    sha256: mediaSha256,
    durationFrames: actualOutputFrames,
    videoFrameRate: mediaProbe.videoFrameRate
  },
  expectedOutputFrames,
  sourceTranscript: {
    path: "state/source-transcript.json",
    sha256: sourceTranscriptSha256
  }
};

errors.push(...validateFinalizedPlanStructure(plan));
if (errors.length > 0) {
  for (const error of [...new Set(errors)]) console.error(`Error: ${error}`);
  process.exit(1);
}

if (sourceTranscriptExists && sha256File(sourceTranscriptPath) !== sourceTranscriptSha256) {
  throw new Error("Source transcript changed during trim finalization");
}
if (!sourceTranscriptExists) {
  writeJsonAtomic(sourceTranscriptPath, sourceTranscript);
  if (sha256File(sourceTranscriptPath) !== sourceTranscriptSha256) {
    throw new Error("Source transcript snapshot did not match its canonical hash");
  }
}
writeJsonAtomic(planPath, plan);
console.log(`Trim plan finalized: ${plan.seams.length} seam(s), ${actualOutputFrames} output frame(s)`);
