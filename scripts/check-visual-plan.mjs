import fs from "node:fs";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";

const [beatMapPath, transcriptPath, designSystemPath] = process.argv.slice(2);

if (!beatMapPath || !transcriptPath || !designSystemPath) {
  console.error("Usage: node check-visual-plan.mjs <beat-map.json> <transcript.json> <design-system.json>");
  process.exit(64);
}

const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const errors = [];
const warnings = [];
const beats = [...beatMap.beats].sort((left, right) => left.start - right.start);
const transcriptById = new Map(transcript.segments.map((segment) => [segment.id, segment]));
const wordsById = transcriptWordsById(transcript);
const sourceUsage = new Map();
const signatureUsage = new Map();
const renderWindows = new Map();
const normalize = (value) => value.replace(/[\s，。！？、,.!?]/g, "").toLowerCase();
const captionMode = beatMap.captionMode ?? "motion-copy";
const rhythm = designSystem.rhythmProfiles[captionMode];
const typography = designSystem.typography;
const spacing = designSystem.spacing;
const density = designSystem.density;
const pipExclusionZone = designSystem.axisPolicies?.B?.pipExclusionZone;
const subtitleSupportRoles = new Set(["evidence", "explanation", "calibration", "organization", "action", "consequence"]);

for (let index = 0; index < beats.length; index += 1) {
  const beat = beats[index];
  const duration = beat.end - beat.start;

  if (!(duration > 0)) errors.push(`${beat.id}: end must be greater than start`);

  const sourceSegments = beat.sourceSegmentIds.map((id) => transcriptById.get(id));
  if (sourceSegments.some((segment) => !segment)) errors.push(`${beat.id}: references an unknown transcript segment`);

  for (const sourceId of beat.sourceSegmentIds) {
    const uses = sourceUsage.get(sourceId) ?? [];
    uses.push(beat);
    sourceUsage.set(sourceId, uses);
  }

  if (captionMode === "motion-copy" && sourceSegments.every(Boolean) && !beat.copyException) {
    const sourceText = sourceSegments.map((segment) => segment.text).join("");
    if (normalize(sourceText) !== normalize(beat.text)) errors.push(`${beat.id}: displayed copy does not exactly cover its transcript segments`);
  }

  if (captionMode === "subtitles" && beat.mgScope === "local" && sourceSegments.every(Boolean) && !beat.copyException) {
    const sourceText = sourceSegments.map((segment) => segment.text).join("");
    if (normalize(sourceText) === normalize(beat.text)) errors.push(`${beat.id}: subtitles mode motion must add information instead of duplicating caption copy`);
  }

  if (sourceSegments.every(Boolean) && !beat.syncException) {
    const sourceStart = Math.min(...sourceSegments.map((segment) => segment.start));
    const sourceEnd = Math.max(...sourceSegments.map((segment) => segment.end));
    if (beat.audioAnchorTime < sourceStart || beat.audioAnchorTime > sourceEnd) errors.push(`${beat.id}: audio anchor falls outside its transcript segments`);
    if (captionMode === "motion-copy" && Math.abs(beat.audioAnchorTime - sourceStart) * beatMap.fps > rhythm.syncToleranceFrames) errors.push(`${beat.id}: motion-copy anchor must match phrase onset`);
    const syncErrorFrames = Math.abs(beat.start - beat.audioAnchorTime) * beatMap.fps;
    if (syncErrorFrames > rhythm.syncToleranceFrames) errors.push(`${beat.id}: starts ${syncErrorFrames.toFixed(1)} frames away from speech`);
  }

  const captionOnly = captionMode === "subtitles" && beat.mgScope === "none";
  if (captionMode === "subtitles" && !["none", "local"].includes(beat.mgScope)) errors.push(`${beat.id}: subtitles mode requires mgScope to be none or local`);
  if (captionOnly) {
    if (beat.recipe !== "caption-only") errors.push(`${beat.id}: caption-only beat must use the caption-only recipe`);
    if ((beat.components ?? []).length !== 0 || (beat.microEvents ?? []).length !== 0) errors.push(`${beat.id}: caption-only beat cannot declare MG components or micro-events`);
    continue;
  }

  if (!beat.layout || !beat.typography || !beat.components || !beat.microEvents) {
    errors.push(`${beat.id}: motion beat is missing layout, typography, components, or micro-events`);
    continue;
  }
  if (!["horizontal", "vertical"].includes(beat.primaryFlowAxis)) errors.push(`${beat.id}: motion beat must declare a horizontal or vertical primaryFlowAxis`);
  if (typeof beat.visualReference !== "string" || beat.visualReference.trim().length === 0) errors.push(`${beat.id}: motion beat must declare its approved or proposed visualReference`);
  if (!["sequence", "comparison", "convergence", "branch", "mapping", "emphasis", "evidence"].includes(beat.semanticTopology)) errors.push(`${beat.id}: motion beat must declare semanticTopology`);
  const entryWord = wordsById.get(beat.entryAnchorWordId);
  const exitWord = wordsById.get(beat.exitAnchorWordId);
  if (!entryWord) errors.push(`${beat.id}: entryAnchorWordId does not resolve to a transcript word`);
  if (!exitWord) errors.push(`${beat.id}: exitAnchorWordId does not resolve to a transcript word`);
  if (!Number.isInteger(beat.exitAnchorOffsetFrames) || beat.exitAnchorOffsetFrames < 0 || beat.exitAnchorOffsetFrames > 12) {
    errors.push(`${beat.id}: exitAnchorOffsetFrames must be an integer from 0 to 12`);
  }
  let renderWindow = null;
  if (entryWord && exitWord) {
    try {
      renderWindow = resolveBeatRenderWindow(beat, beatMap, wordsById);
      renderWindows.set(beat.id, renderWindow);
      if (exitWord.end < entryWord.start) errors.push(`${beat.id}: exit anchor precedes entry anchor`);
      if (renderWindow.exitAnchorTime > beat.end + 1 / beatMap.fps) errors.push(`${beat.id}: exit anchor extends beyond the Beat window`);
      const lastMicroEvent = Math.max(beat.start, ...(beat.microEvents ?? []).map((event) => event.time));
      if (renderWindow.exitAnchorTime < lastMicroEvent && !beat.staticHoldReason) errors.push(`${beat.id}: exit anchor precedes the last meaningful event`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (captionMode === "subtitles" && beat.mgScope !== "local") errors.push(`${beat.id}: subtitles mode only permits local MG`);
  if (captionMode === "subtitles" && beat.captionSafeZonePass !== true) errors.push(`${beat.id}: local MG must pass caption safe-zone review`);
  if (captionMode === "subtitles") {
    if (!Array.isArray(beat.captionCueIds) || beat.captionCueIds.length === 0) errors.push(`${beat.id}: subtitle MG must map to captionCueIds`);
    if (typeof beat.visualStyle !== "string" || beat.visualStyle.trim().length === 0) errors.push(`${beat.id}: subtitle MG must declare visualStyle`);
    if (!Array.isArray(beat.onScreenCopy) || beat.onScreenCopy.length === 0 || beat.onScreenCopy.length > 6) {
      errors.push(`${beat.id}: subtitle MG must declare 1–6 exact onScreenCopy strings`);
    } else {
      for (const [copyIndex, copy] of beat.onScreenCopy.entries()) {
        if (typeof copy !== "string" || copy.trim().length === 0) {
          errors.push(`${beat.id}: onScreenCopy[${copyIndex}] must be a non-empty string`);
          continue;
        }
        const visibleCharacters = [...copy.replace(/[\s·/｜|→↔+\-]/g, "")].length;
        if (visibleCharacters > 12) errors.push(`${beat.id}: onScreenCopy[${copyIndex}] exceeds 12 visible characters`);
      }
    }
    for (const field of ["viewerQuestion", "removalLoss", "visualEncoding", "stillFrameValue", "attentionCost"]) {
      if (typeof beat[field] !== "string" || beat[field].trim().length === 0) errors.push(`${beat.id}: subtitle MG must declare ${field}`);
    }
    if (!subtitleSupportRoles.has(beat.supportRole)) errors.push(`${beat.id}: subtitle MG has an invalid supportRole`);
    if (!["low", "medium", "high"].includes(beat.attentionCost)) errors.push(`${beat.id}: subtitle MG attentionCost must be low, medium, or high`);
    if (!Array.isArray(beat.factualClaims)) errors.push(`${beat.id}: subtitle MG must declare factualClaims, including an empty array when none are added`);
    if (Array.isArray(beat.factualClaims)) {
      for (const [claimIndex, claim] of beat.factualClaims.entries()) {
        if (typeof claim?.claim !== "string" || claim.claim.trim().length === 0 || typeof claim?.source !== "string" || claim.source.trim().length === 0) {
          errors.push(`${beat.id}: factualClaims[${claimIndex}] must include claim and source`);
        }
      }
    }
    if (!Array.isArray(beat.terms)) errors.push(`${beat.id}: subtitle MG must declare terms, including an empty array when none are introduced`);
    if (Array.isArray(beat.terms)) {
      for (const [termIndex, term] of beat.terms.entries()) {
        if (typeof term?.term !== "string" || term.term.trim().length === 0 || typeof term?.plainExplanation !== "string" || term.plainExplanation.trim().length === 0) {
          errors.push(`${beat.id}: terms[${termIndex}] must include term and plainExplanation`);
        }
      }
    }
    if (beat.supportRole === "evidence" && (typeof beat.evidenceSource !== "string" || beat.evidenceSource.trim().length === 0)) errors.push(`${beat.id}: evidence MG must declare evidenceSource`);
    if (beat.supportRole === "evidence" && (!Array.isArray(beat.factualClaims) || beat.factualClaims.length === 0)) errors.push(`${beat.id}: evidence MG must declare at least one factual claim`);
    if (beat.attentionCost === "high") {
      if (beat.axis !== "B") errors.push(`${beat.id}: high-attention-cost subtitle MG must use the B-axis`);
      if (typeof beat.attentionCostReason !== "string" || beat.attentionCostReason.trim().length === 0) errors.push(`${beat.id}: high-attention-cost subtitle MG must declare attentionCostReason`);
    }
  }

  if (beat.typography.fontFamily !== typography.displayFamily) errors.push(`${beat.id}: must use ${typography.displayFamily}`);
  const sizeRange = beat.typography.role === "primary" ? typography.primarySizePx : typography.secondarySizePx;
  if (beat.typography.fontSizePx < sizeRange[0] || beat.typography.fontSizePx > sizeRange[1]) errors.push(`${beat.id}: font size is outside ${sizeRange[0]}–${sizeRange[1]} px`);
  if (beat.typography.lineHeight < typography.displayLineHeight[0] || beat.typography.lineHeight > typography.displayLineHeight[1]) errors.push(`${beat.id}: display line height is outside the approved range`);
  if (beat.typography.outlineReservePx < typography.outlineReservePx) errors.push(`${beat.id}: insufficient outline and transform reserve`);

  if (beat.layout.primaryOccupancyRatio < density.primaryOccupancyRatio[0] || beat.layout.primaryOccupancyRatio > density.primaryOccupancyRatio[1]) errors.push(`${beat.id}: primary occupancy is too empty or too crowded`);
  if (beat.layout.supportingElementCount < density.supportingElementCount[0] || beat.layout.supportingElementCount > density.supportingElementCount[1]) errors.push(`${beat.id}: supporting element count is outside the approved range`);
  if (beat.layout.supportingElementCount !== beat.components.length) errors.push(`${beat.id}: component list does not match supporting element count`);
  if (beat.layout.emptyComponentCount !== density.emptyComponentCount) errors.push(`${beat.id}: empty components are forbidden`);
  if (!beat.layout.safeAreaPass) errors.push(`${beat.id}: declared layout does not pass the safe area`);
  if (beat.layout.panelPaddingPx < spacing.panelPaddingPx[0] || beat.layout.panelPaddingPx > spacing.panelPaddingPx[1]) errors.push(`${beat.id}: panel padding is outside the approved range`);

  const bounds = beat.layout.primaryBoundsNormalized;
  if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) errors.push(`${beat.id}: primary bounds leave the canvas`);
  const primaryCenterY = bounds.y + bounds.height / 2;
  if (primaryCenterY < designSystem.canvas.primaryStageYRatio[0] || primaryCenterY > designSystem.canvas.primaryStageYRatio[1]) errors.push(`${beat.id}: primary content is placed in an edge strip`);
  if (beat.axis === "B" && pipExclusionZone) {
    const pipBounds = {
      x: 1 - (pipExclusionZone.rightPx + pipExclusionZone.widthPx) / designSystem.canvas.width,
      y: 1 - (pipExclusionZone.bottomPx + pipExclusionZone.heightPx) / designSystem.canvas.height,
      width: pipExclusionZone.widthPx / designSystem.canvas.width,
      height: pipExclusionZone.heightPx / designSystem.canvas.height
    };
    const overlapsPip = bounds.x < pipBounds.x + pipBounds.width
      && bounds.x + bounds.width > pipBounds.x
      && bounds.y < pipBounds.y + pipBounds.height
      && bounds.y + bounds.height > pipBounds.y;
    if (overlapsPip) errors.push(`${beat.id}: B-axis primary bounds overlap the protected PIP zone`);
  }

  if (captionMode === "subtitles") {
    const captionHeight = designSystem.captions.fontSizePx * designSystem.captions.lineHeight * designSystem.captions.maximumLines + 8;
    const captionBounds = {
      x: 54 / designSystem.canvas.width,
      y: 1 - (designSystem.captions.bottomOffsetPx + captionHeight) / designSystem.canvas.height,
      width: 1 - 108 / designSystem.canvas.width,
      height: captionHeight / designSystem.canvas.height
    };
    const overlapsCaption = bounds.x < captionBounds.x + captionBounds.width
      && bounds.x + bounds.width > captionBounds.x
      && bounds.y < captionBounds.y + captionBounds.height
      && bounds.y + bounds.height > captionBounds.y;
    if (overlapsCaption) errors.push(`${beat.id}: local MG overlaps the protected caption zone`);
  }

  const microTimes = beat.microEvents.map((event) => event.time).sort((left, right) => left - right);
  if (microTimes.some((time) => time < beat.start || time > beat.end)) errors.push(`${beat.id}: micro-event falls outside its phrase`);
  const rhythmPoints = [beat.start, ...microTimes, beat.end];
  const largestGap = Math.max(...rhythmPoints.slice(1).map((time, pointIndex) => time - rhythmPoints[pointIndex]));
  if (largestGap > rhythm.microEventGapSeconds[1] && !beat.staticHoldReason) errors.push(`${beat.id}: visual dead zone is ${largestGap.toFixed(2)}s`);
  if (entryWord && microTimes.length > 0) {
    const firstMeaningfulDelayMs = (microTimes[0] - entryWord.start) * 1000;
    if (firstMeaningfulDelayMs < -rhythm.syncToleranceFrames / beatMap.fps * 1000) errors.push(`${beat.id}: first meaningful event starts before its anchor word`);
    if (firstMeaningfulDelayMs > (rhythm.firstMeaningfulEventMaxMs ?? 400)) errors.push(`${beat.id}: first meaningful event is delayed ${firstMeaningfulDelayMs.toFixed(1)}ms`);
  }

  const topologyRoles = beat.microEvents.map((event) => event.topologyRole).filter(Boolean);
  if (beat.semanticTopology === "sequence" && topologyRoles.filter((role) => role === "node").length < 2) errors.push(`${beat.id}: sequence topology requires at least two nodes`);
  if (beat.semanticTopology === "comparison" && (!topologyRoles.includes("comparison-a") || !topologyRoles.includes("comparison-b"))) errors.push(`${beat.id}: comparison topology requires both sides`);
  if (beat.semanticTopology === "convergence" && (topologyRoles.filter((role) => role === "input").length < 2 || !topologyRoles.includes("result"))) errors.push(`${beat.id}: convergence topology requires two inputs and a result`);
  if (beat.semanticTopology === "branch" && (!topologyRoles.includes("source") || topologyRoles.filter((role) => role === "branch").length < 2)) errors.push(`${beat.id}: branch topology requires one source and two branches`);
  if (beat.semanticTopology === "mapping" && (!topologyRoles.includes("source") || !topologyRoles.includes("result"))) errors.push(`${beat.id}: mapping topology requires source and result roles`);
  if (["convergence", "branch", "mapping"].includes(beat.semanticTopology)
    && !beat.microEvents.some((event) => event.visualRole === "connector")) {
    errors.push(`${beat.id}: ${beat.semanticTopology} topology requires a connector`);
  }

  const revealGroups = new Map();
  for (const event of beat.microEvents.filter((candidate) => candidate.revealGroup)) {
    const events = revealGroups.get(event.revealGroup) ?? [];
    events.push(event);
    revealGroups.set(event.revealGroup, events);
  }
  for (const [group, events] of revealGroups) {
    if (!events.some((event) => event.visualRole === "connector")) continue;
    if (!events.some((event) => event.visualRole === "container")) errors.push(`${beat.id}: reveal group ${group} has a connector without a container`);
    const times = events.map((event) => event.time);
    if ((Math.max(...times) - Math.min(...times)) * beatMap.fps > (rhythm.revealGroupMaxSkewFrames ?? 2)) errors.push(`${beat.id}: reveal group ${group} exceeds two-frame coordination`);
  }
  if (beat.microEvents.some((event) => event.visualRole === "connector" && !event.revealGroup)) errors.push(`${beat.id}: connector events must declare revealGroup`);

  const visualSignature = JSON.stringify({
    axis: beat.axis,
    visualReference: beat.visualReference,
    semanticTopology: beat.semanticTopology,
    primaryFlowAxis: beat.primaryFlowAxis,
    motionFamily: beat.motionFamily,
    visualStyle: beat.visualStyle ?? null
  });
  const signatureBeats = signatureUsage.get(visualSignature) ?? [];
  signatureBeats.push(beat);
  signatureUsage.set(visualSignature, signatureBeats);

  if (index >= rhythm.maximumRepeatedTransitionFamily) {
    const recent = beats.slice(index - rhythm.maximumRepeatedTransitionFamily, index + 1);
    if (recent.every((candidate) => candidate.transitionFamily === beat.transitionFamily)) errors.push(`${beat.id}: transition family repeats too many times`);
  }
}

const aAxisMotionBeats = beats.filter((beat) => beat.axis === "A" && !(captionMode === "subtitles" && beat.mgScope === "none"));
for (const [index, beat] of aAxisMotionBeats.entries()) {
  const renderWindow = renderWindows.get(beat.id) ?? { start: beat.start, end: beat.end };
  const userFaceCoverage = beat.layout?.faceCoverApproval === "user" && typeof beat.layout?.faceSafetyNote === "string" && beat.layout.faceSafetyNote.trim();
  if (beat.layout?.faceCover !== "none" && renderWindow.end - renderWindow.start > 3 && !userFaceCoverage) errors.push(`${beat.id}: A-axis face coverage exceeds three seconds without recorded user approval`);
  const previousWindow = index > 0
    ? renderWindows.get(aAxisMotionBeats[index - 1].id) ?? {
      start: aAxisMotionBeats[index - 1].start,
      end: aAxisMotionBeats[index - 1].end
    }
    : null;
  if (previousWindow && renderWindow.start < previousWindow.end) errors.push(`${beat.id}: A-axis information groups overlap instead of replacing`);
}

for (const repeatedBeats of signatureUsage.values()) {
  if (repeatedBeats.length < 2) continue;
  const reuseGroups = new Set(repeatedBeats.map((beat) => beat.reuseGroup).filter(Boolean));
  if (reuseGroups.size !== 1 || repeatedBeats.some((beat) => typeof beat.reuseReason !== "string" || beat.reuseReason.trim().length === 0)) {
    errors.push(`${repeatedBeats.map((beat) => beat.id).join(", ")}: repeated visual signature requires one reuseGroup and a reason`);
  }
}

for (const segment of transcript.segments) {
  if (!sourceUsage.has(segment.id)) errors.push(`${segment.id}: transcript segment is missing from the beat map`);
}

for (const [sourceId, uses] of sourceUsage) {
  if (uses.length > 1 && !uses.every((beat) => beat.reuseSource)) errors.push(`${sourceId}: transcript segment is reused without an explicit reason`);
}

let sceneStart = beats[0]?.start ?? 0;
let currentScene = beats[0]?.sceneId;
for (const beat of beats.slice(1)) {
  if (beat.sceneId !== currentScene) {
    const sceneDuration = beat.start - sceneStart;
    if (sceneDuration < rhythm.majorSceneGapSeconds[0] && !beat.majorSceneException) errors.push(`${beat.id}: major scene changes after only ${sceneDuration.toFixed(2)}s`);
    if (sceneDuration > rhythm.majorSceneGapSeconds[1]) warnings.push(`${currentScene}: major scene lasts ${sceneDuration.toFixed(2)}s; confirm micro-events keep it alive`);
    sceneStart = beat.start;
    currentScene = beat.sceneId;
  }
}

let axisRunStart = 0;
while (axisRunStart < beats.length) {
  const axis = beats[axisRunStart].axis;
  let axisRunEnd = axisRunStart;
  while (axisRunEnd + 1 < beats.length && beats[axisRunEnd + 1].axis === axis) axisRunEnd += 1;
  if (axis === "B") {
    const runDuration = beats[axisRunEnd].end - beats[axisRunStart].start;
    if (runDuration < rhythm.minimumBAxisRunSeconds && !beats[axisRunStart].axisException) errors.push(`${beats[axisRunStart].id}: B-axis run is only ${runDuration.toFixed(2)}s`);
  }
  axisRunStart = axisRunEnd + 1;
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
for (const error of errors) console.error(`Error: ${error}`);

if (errors.length > 0) process.exit(1);
console.log(`Visual plan passed: ${beats.length} beats, ${warnings.length} warning(s)`);
