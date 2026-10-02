/**
 * Shared builders for the motion-plan stage artifacts.
 *
 * Every artifact this module produces used to be hand-written per job (a
 * throwaway python script for each). The editorial judgement still lives in the
 * job's `state/planning-inputs.json`; everything mechanical (timeline mapping,
 * fingerprints, envelopes, cue text resolution, evidence pairing, beat
 * defaults) is derived here so it cannot drift between jobs.
 */
import { sha256File } from "./workflow-utils.mjs";
import { resolveComponent } from "./motion-template-library.mjs";

export const decimal = (value, places = 6) => Number(Number(value).toFixed(places));
const pad3 = (value) => String(value).padStart(3, "0");
export const wordId = (segmentId, index) => `${segmentId}:word-${pad3(index)}`;

const EPSILON = 1e-9;
/** Cue text must carry no punctuation; only a closing question mark survives. */
const PUNCTUATION = /[，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/gu;
const stripPunctuation = (text) => {
  const closing = /[?？]$/u.test(text) ? text.slice(-1) : "";
  return `${text.replace(PUNCTUATION, "").replace(/\s+/gu, "")}${closing}`;
};

/** Ordered, non-overlapping source->timeline placement pairs for the locked cut. */
const placementPairs = (sourceTranscript, timelineWindows, fps, corrections) => {
  const clips = [...timelineWindows.clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame).map((clip) => ({
    start: clip.timelineStartFrame / fps,
    scale: (clip.durationFrames / fps) / ((clip.srcEndUs - clip.srcStartUs) / 1e6),
    srcStart: clip.srcStartUs / 1e6,
    srcEnd: clip.srcEndUs / 1e6
  }));
  const placed = [];
  for (const clip of clips) {
    for (const segment of sourceTranscript.segments) {
      for (const [index, word] of (segment.words ?? []).entries()) {
        if (word.end <= clip.srcStart + EPSILON || word.start >= clip.srcEnd - EPSILON) continue;
        const start = Math.max(word.start, clip.srcStart);
        const end = Math.min(word.end, clip.srcEnd);
        const next = {
          sourceWordId: wordId(segment.id, index + 1),
          segmentId: segment.id,
          text: word.text,
          start: decimal(clip.start + (start - clip.srcStart) * clip.scale),
          end: decimal(clip.start + (end - clip.srcStart) * clip.scale),
          sourceStart: start,
          sourceEnd: end,
          confidence: word.confidence ?? 0.9
        };
        const previous = placed.at(-1);
        // A cut can split a single ASR token. Join its forward fragments;
        // a repeated take (source time rewinds) remains a distinct occurrence.
        if (previous?.sourceWordId === next.sourceWordId && next.sourceStart >= previous.sourceEnd - EPSILON
          && Math.abs(previous.end - next.start) < 1e-5) {
          previous.end = next.end;
          previous.sourceEnd = next.sourceEnd;
        } else placed.push(next);
      }
    }
  }
  const groups = [];
  const occurrences = new Map();
  for (const word of placed) {
    let group = groups.at(-1);
    if (!group || group.sourceSegmentId !== word.segmentId || word.sourceStart < group.words.at(-1).sourceEnd - EPSILON) {
      const occurrence = (occurrences.get(word.segmentId) ?? 0) + 1;
      occurrences.set(word.segmentId, occurrence);
      group = { segmentId: occurrence === 1 ? word.segmentId : `${word.segmentId}-repeat-${occurrence}`, sourceSegmentId: word.segmentId, words: [] };
      groups.push(group);
    }
    group.words.push(word);
  }
  return groups.map((group) => ({ ...group, words: applyCorrections(group.words, corrections) }));
};

/** Fold an ASR mis-split pair (e.g. 扣 + dex -> Codex) into a single word. */
export const applyCorrections = (words, corrections = {}) => {
  const merged = [];
  for (let index = 0; index < words.length;) {
    const next = words[index + 1];
    const pair = words[index].text + (next ? next.text : "");
    if (next && Object.prototype.hasOwnProperty.call(corrections, pair)) {
      merged.push({
        ...words[index],
        text: corrections[pair],
        end: next.end,
        sourceEnd: next.sourceEnd ?? words[index].sourceEnd,
        confidence: words[index].confidence
      });
      index += 2;
    } else {
      merged.push(words[index]);
      index += 1;
    }
  }
  return merged;
};

export const buildReleasedTranscript = ({
  sourceTranscript,
  timelineWindows,
  fps,
  corrections = {},
  revision = 2,
  language = "zh-CN",
  source = "chatcut"
}) => {
  const placed = placementPairs(sourceTranscript, timelineWindows, fps, corrections);
  const segments = placed.map(({ segmentId, words }) => ({
    id: segmentId,
    text: words.map((word) => word.text).join(""),
    start: decimal(words[0].start),
    end: decimal(words.at(-1).end),
    confidence: Math.min(...words.map((word) => word.confidence)),
    words: words.map((word) => ({
      text: word.text,
      start: decimal(word.start),
      end: decimal(word.end),
      confidence: word.confidence
    }))
  }));
  const lastClip = [...timelineWindows.clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame).at(-1);
  if (!lastClip || !segments.length) throw new Error("the locked cut contains no retained transcript words");
  return {
    revision,
    language,
    duration: decimal((lastClip.timelineStartFrame + lastClip.durationFrames) / fps),
    source,
    segments
  };
};

/**
 * Source-word timing evidence: one row per retained source word plus its
 * timeline placement. A row with no timeline placement cannot carry a mapping,
 * so removed takes are absent by construction.
 */
export const buildSourceWordEvidence = ({
  sourceTranscript,
  timelineWindows,
  releasedTranscript,
  fps,
  corrections = {}
}) => {
  const placed = placementPairs(sourceTranscript, timelineWindows, fps, corrections).flatMap((entry) => entry.words);
  const releasedWords = releasedTranscript.segments.flatMap((segment) => segment.words);
  if (placed.length !== releasedWords.length) {
    throw new Error(`source placement (${placed.length}) does not match the released transcript (${releasedWords.length})`);
  }
  placed.forEach((word, index) => {
    if (word.text !== releasedWords[index].text) throw new Error(`placement ${index} text drift: ${word.text} != ${releasedWords[index].text}`);
    if (Math.abs(word.start - releasedWords[index].start) > 1e-6) throw new Error(`placement ${index} start drift`);
    if (Math.abs(word.end - releasedWords[index].end) > 1e-6) throw new Error(`placement ${index} end drift`);
  });

  const rows = [];
  const entries = [];
  placed.forEach((word, index) => {
    const startFrame = Math.floor(word.start * fps);
    const next = placed[index + 1];
    let endFrame = next ? Math.floor(next.start * fps) : Math.ceil(word.end * fps);
    endFrame = Math.max(startFrame + 1, endFrame);
    if (next && endFrame > Math.floor(next.start * fps)) endFrame = Math.floor(next.start * fps);
    if (endFrame <= startFrame) throw new Error(`source word ${word.sourceWordId} shares its frame with the next token; merge the ASR tokens before generating timing evidence`);
    rows.push({ startMs: decimal(word.sourceStart * 1000, 3), endMs: decimal(word.sourceEnd * 1000, 3) });
    entries.push({
      sourceStartMs: decimal(word.sourceStart * 1000, 3),
      sourceEndMs: decimal(word.sourceEnd * 1000, 3),
      timelineStartFrame: startFrame,
      timelineEndFrame: endFrame
    });
  });
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].timelineStartFrame < entries[index - 1].timelineEndFrame) throw new Error(`mapping entry ${index} overlaps its predecessor`);
  }
  return { rows, entries };
};

const DEFAULT_RULES = {
  exactlyOneLine: true,
  minimumDurationSeconds: 0.5,
  targetDurationSeconds: [0.8, 2.5],
  targetDisplayUnits: [4, 10.5],
  maximumDisplayUnits: 11.8,
  fitFontSizePx: [88, 96],
  noPunctuation: true
};

/**
 * Caption review plan. Cue text is derived from the selected word range so it
 * can never disagree with the transcript; the input only carries the ranges.
 */
export const buildCaptionPlan = ({
  transcript,
  transcriptSha256,
  cueLines,
  lexicon,
  rules = {},
  exceptions = {},
  status = "proposed"
}) => {
  const expected = transcript.segments.flatMap((segment) => segment.words.map((_, index) => wordId(segment.id, index + 1)));
  const covered = cueLines.flatMap((line) => Array.from({ length: Math.max(0, line.toWord - line.fromWord + 1) }, (_, index) => wordId(line.segmentId, line.fromWord + index)));
  if (covered.length !== expected.length || covered.some((id, index) => id !== expected[index])) throw new Error("cue lines must cover every transcript word exactly once in timeline order");

  const bySegment = new Map(transcript.segments.map((segment) => [segment.id, segment]));
  const cues = cueLines.map((line, index) => {
    const segment = bySegment.get(line.segmentId);
    if (!segment) throw new Error(`cue ${index + 1} references an unknown segment ${line.segmentId}`);
    if (!Number.isInteger(line.fromWord) || !Number.isInteger(line.toWord)) throw new Error(`cue ${index + 1} needs integer fromWord/toWord`);
    if (line.fromWord < 1 || line.toWord < line.fromWord || line.toWord > segment.words.length) {
      throw new Error(`cue ${index + 1} word range ${line.fromWord}-${line.toWord} is outside ${line.segmentId} (${segment.words.length} words)`);
    }
    const text = stripPunctuation(segment.words.slice(line.fromWord - 1, line.toWord).map((word) => word.text).join(""));
    return {
      id: `caption-${String(index + 1).padStart(4, "0")}`,
      text,
      startWordId: wordId(line.segmentId, line.fromWord),
      endWordId: wordId(line.segmentId, line.toWord),
      ...(line.fitFontSizePx === undefined ? {} : { fitFontSizePx: line.fitFontSizePx })
    };
  });

  return {
    schemaVersion: "1.0.0",
    status,
    wordingAuthority: "state/transcript.json",
    transcriptRevision: transcript.revision ?? 1,
    transcriptSha256,
    timingAuthority: "state/transcript.json word ranges",
    segmentationAuthority: "agent-authored word ranges",
    rules: {
      ...DEFAULT_RULES,
      ...rules,
      protectedTerms: lexicon.protectedTerms ?? [],
      forbiddenStandaloneCues: lexicon.forbiddenStandaloneCues ?? []
    },
    exceptions,
    cues
  };
};

/**
 * Fields a local MG beat shares with its component. They are derived from the
 * component's `meta` so a beat map stops restating what the component already
 * declares - on the delivered job 15 of the 16 values were verbatim copies of
 * the component metadata. An explicit value on the beat still wins, because the
 * disagreements that exist are editorial: a hand-tuned panel band, or a second
 * use of the same gesture under a different transition.
 */
const DERIVED_BEAT_FIELDS = ["semanticTopology", "primaryFlowAxis", "motionFamily", "transitionFamily"];

const applyComponentDefaults = (beat) => {
  const component = resolveComponent(beat.templateId ?? beat.mgComponent ?? beat.recipe);
  if (beat.templateId && beat.templateId !== "custom" && !component) throw new Error(`${beat.id}: unknown templateId ${beat.templateId}`);
  if (!component) return beat;
  beat.templateId = component.meta.name;
  if (beat.templateData?.copy) {
    if (beat.onScreenCopy && JSON.stringify(beat.onScreenCopy) !== JSON.stringify(beat.templateData.copy)) throw new Error(`${beat.id}: onScreenCopy disagrees with templateData.copy`);
    beat.onScreenCopy = [...beat.templateData.copy];
  }
  if (component.meta.copySlots === 0 && beat.onScreenCopy === undefined) beat.onScreenCopy = [];
  if (beat.visualReference === undefined) beat.visualReference = `templates/motion-graphics/${component.meta.name}`;
  for (const field of DERIVED_BEAT_FIELDS) {
    if (beat[field] === undefined && component.meta[field] !== undefined) beat[field] = component.meta[field];
  }
  if (beat.visualStyle === undefined) {
    const summary = component.meta.summaryZh ?? component.meta.summary;
    if (summary !== undefined) beat.visualStyle = summary;
  }
  return beat;
};

const CAPTION_ONLY = {
  recipe: "caption-only",
  mgScope: "none",
  axis: "A",
  motionFamily: "editorial",
  transitionFamily: "caption-cut"
};

const DEFAULT_LAYOUT = {
  primaryOccupancyRatio: 0.3,
  primaryBoundsNormalized: { x: 0.06, y: 0.42, width: 0.88, height: 0.3 },
  supportingElementCount: 3,
  emptyComponentCount: 0,
  panelPaddingPx: 56,
  faceCover: "partial"
};

/**
 * Beat map. The author's key order is preserved and only missing fields are
 * appended, so a minimal beat entry expands to a complete one (and an already
 * complete entry round-trips unchanged). Typography is inherited from the
 * design system, `audioAnchorTime` defaults to the beat start (this project's
 * convention) and local MG panels reuse the A-axis band unless overridden.
 */
export const buildBeatMap = ({
  transcript,
  beats,
  captionMode,
  designSystemPath = "state/design-system.json",
  designSystem,
  fps = 30
}) => {
  const typography = {
    fontFamily: designSystem.typography.displayFamily,
    role: "primary",
    fontSizePx: designSystem.captions.fontSizePx,
    lineHeight: 1,
    maxLines: 1,
    outlineReservePx: designSystem.typography.outlineReservePx
  };
  return {
    duration: transcript.duration,
    fps,
    captionMode,
    designSystem: designSystemPath,
    beats: beats.map((beat) => {
      const out = { ...beat };
      if (out.audioAnchorTime === undefined) out.audioAnchorTime = beat.start;
      if (out.recipe === undefined) out.recipe = out.templateId ?? CAPTION_ONLY.recipe;
      if (out.mgScope === undefined) out.mgScope = out.recipe === "caption-only" ? "none" : "local";
      if (out.axis === undefined) out.axis = CAPTION_ONLY.axis;
      // Component metadata fills the shared fields before the generic defaults,
      // so a beat only names what it actually decides.
      if (out.mgScope === "local") applyComponentDefaults(out);
      if (out.motionFamily === undefined) out.motionFamily = CAPTION_ONLY.motionFamily;
      if (out.transitionFamily === undefined) out.transitionFamily = out.mgScope === "local" ? "custom" : CAPTION_ONLY.transitionFamily;
      if (out.mgScope === "local") {
        if (!out.layout?.faceSafetyNote) {
          throw new Error(`${out.id}: a local MG beat must declare layout.faceSafetyNote (the face-safety judgement cannot be inferred)`);
        }
        out.typography = { ...typography, ...out.typography };
        out.layout = {
          ...DEFAULT_LAYOUT,
          ...out.layout,
          primaryBoundsNormalized: { ...DEFAULT_LAYOUT.primaryBoundsNormalized, ...out.layout?.primaryBoundsNormalized }
        };
        if (beat.layout?.supportingElementCount === undefined && Array.isArray(beat.components)) out.layout.supportingElementCount = beat.components.length;
      }
      return out;
    })
  };
};

/**
 * Reconciliation items. Every released segment becomes one addressed item; the
 * type is inferred from whether a released-wording correction actually merged
 * words in that segment's *source* rows (a segment that merely repeats the
 * corrected name, like another take of the same line, stays speech-only).
 */
export const buildReconciliationItems = ({ transcript, corrections = {}, plan = {}, sourceTranscript, existingItems = [], previousTranscript }) => {
  const defaultDecision = plan.defaultDecision ?? {
    actor: "agent",
    at: plan.decidedAt ?? "1970-01-01T00:00:00Z",
    note: "Generated from the locked cut; wording follows the released transcript."
  };
  const defaultEvidence = plan.defaultEvidenceNote
    ?? "ChatCut transcription and timing at {start}-{end}s.";
  const overrides = plan.segments ?? {};
  const fill = (template, segment) => String(template)
    .replaceAll("{start}", segment.start.toFixed(2))
    .replaceAll("{end}", segment.end.toFixed(2))
    .replaceAll("{id}", segment.id)
    .replaceAll("{text}", segment.text);
  const correctedSegments = new Set();
  if (sourceTranscript && Object.keys(corrections).length > 0) {
    for (const segment of sourceTranscript.segments ?? []) {
      const words = segment.words ?? [];
      for (let index = 0; index < words.length - 1; index += 1) {
        if (Object.prototype.hasOwnProperty.call(corrections, words[index].text + words[index + 1].text)) {
          correctedSegments.add(segment.id);
        }
      }
    }
  }
  const handledIds = new Set();
  const items = transcript.segments.flatMap((segment) => {
    const matching = existingItems.filter((item) => item.type !== "script-only" && (item.segmentId === segment.id || item.id === `r-${segment.id}`));
    matching.forEach((item) => handledIds.add(item.id));
    const ordinarySpeech = matching.every((item) => item.type === "speech-only" && item.resolution === "accepted-speech" && !item.releaseImpact && !item.referenceText);
    if (matching.length > 1 && !ordinarySpeech) {
      if (matching.map((item) => item.heardText ?? "").join("") !== segment.text) throw new Error(`${segment.id}: retained words changed inside multiple reconciled subspans; update those items to the retained word ranges before generating`);
      const prior = previousTranscript?.segments?.find((entry) => entry.id === segment.id);
      if (!prior || prior.end <= prior.start) throw new Error(`cannot remap multiple reconciliation items for ${segment.id} without previous transcript`);
      return matching.map((item) => ({ ...item,
        start: decimal(segment.start + (item.start - prior.start) * (segment.end - segment.start) / (prior.end - prior.start)),
        end: decimal(segment.start + (item.end - prior.start) * (segment.end - segment.start) / (prior.end - prior.start))
      }));
    }
    const previous = matching[0];
    const override = { ...previous, ...overrides[segment.id] };
    const type = override.type ?? (correctedSegments.has(segment.id) ? "asr-correction" : "speech-only");
    return {
      id: previous?.id ?? `r-${segment.id}`,
      type,
      segmentId: segment.id,
      start: segment.start,
      end: segment.end,
      referenceText: override.referenceText ?? null,
      heardText: overrides[segment.id]?.heardText ?? (previous?.resolution === "accepted-speech" && previous.type === "speech-only" && !previous.releaseImpact ? segment.text : override.heardText ?? segment.text),
      resolution: override.resolution ?? "accepted-speech",
      releaseImpact: override.releaseImpact ?? false,
      confidence: override.confidence ?? (type === "asr-correction" ? 0.8 : 0.9),
      evidence: {
        audioChecked: false,
        ...(override.evidence ?? {}),
        note: fill(override.evidenceNote ?? override.evidence?.note ?? defaultEvidence, segment)
      },
      decision: override.decision ?? defaultDecision
    };
  });
  for (const [index, item] of existingItems.entries()) {
    if (handledIds.has(item.id)) continue;
    let retained;
    if (item.type === "script-only" || (item.resolution === "unresolved" && item.releaseImpact)) retained = item;
    else if (item.referenceText) retained = {
      ...item, type: "script-only", segmentId: null, heardText: null,
      start: Math.min(item.start, transcript.duration), end: Math.min(item.start, transcript.duration),
      resolution: "omitted-unspoken", releaseImpact: false,
      evidence: { audioChecked: false, note: "This reference text belongs to a source segment omitted from the locked cut." },
      decision: { ...defaultDecision, note: "The locked cut excludes this complete source segment; reference text is not spoken in the released cut." }
    };
    if (!retained) continue;
    // Preserve reference-script ordering around the surviving items.
    const followingIds = new Set(existingItems.slice(index + 1).map((entry) => entry.id));
    const next = items.findIndex((entry) => followingIds.has(entry.id));
    items.splice(next < 0 ? items.length : next, 0, retained);
  }
  return items;
};

/** Padded MM:SS.ss used by the review documents. */
export const formatClock = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
};

export const formatSpan = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}.${(seconds % 60).toFixed(2).padStart(5, "0")}`;

export const jobRelativeSha = (jobRoot, relativePath) => sha256File(`${jobRoot}/${relativePath}`);
