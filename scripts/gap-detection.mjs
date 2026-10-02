#!/usr/bin/env node
// Shared gap-candidate detection for the talking-head rough-cut standard, step 3.
//
// The standard defines a candidate as: "Every other retained source span with no
// aligned ASR word for at least 0.3 seconds—including internal pauses and
// between-word gaps". Detection is deliberately independent of the applied edit:
// the checker re-runs it against the locked timeline so a skipped cleanup step
// cannot be hidden by simply declaring the work done.

export const GAP_CANDIDATE_MINIMUM_SECONDS = 0.3;
export const GAP_REVIEW_EMPHASIS_SECONDS = 0.8;
export const DEFAULT_SCAN_THRESHOLDS_DB = [-30, -35, -40];

const MICROSECONDS_PER_SECOND = 1_000_000;

export const roundTo = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const itemSourceRange = (item) => ({
  start: item.srcStartUs / MICROSECONDS_PER_SECOND,
  end: item.srcEndUs / MICROSECONDS_PER_SECOND
});

export const itemPlaybackRate = (item) => {
  const numerator = Number(item.playbackRateNumerator ?? 1);
  const denominator = Number(item.playbackRateDenominator ?? 1);
  return numerator > 0 && denominator > 0 ? numerator / denominator : 1;
};

const collectWordIntervals = (sourceTranscript, start, end) => {
  const intervals = [];
  for (const segment of sourceTranscript.segments ?? []) {
    for (const word of segment.words ?? []) {
      const wordStart = Number(word.start);
      const wordEnd = Number(word.end);
      if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
      if (wordEnd <= start || wordStart >= end) continue;
      intervals.push({
        id: word.id ?? `${segment.id}.?`,
        text: word.text ?? "",
        start: Math.max(wordStart, start),
        end: Math.min(wordEnd, end)
      });
    }
  }
  return intervals.sort((left, right) => left.start - right.start || left.end - right.end);
};

/**
 * Detect every retained source span with no aligned ASR word for at least
 * `minimumSeconds`. Returns candidates in timeline order with both source and
 * timeline coordinates so a disposition can be matched against the cut.
 */
export const detectGapCandidates = ({
  sourceTranscript,
  timelineWindows,
  fps,
  minimumSeconds = GAP_CANDIDATE_MINIMUM_SECONDS,
  silenceIntervals = [],
  minimumItemSeconds = 0
}) => {
  if (!(fps > 0)) throw new Error("Gap detection requires a positive timeline fps");
  const candidates = [];
  const skippedItems = [];
  for (const item of timelineWindows.clips ?? []) {
    const rate = itemPlaybackRate(item);
    if (rate !== 1) throw new Error(`Gap detection requires 1x playback; item ${item.itemId} uses ${rate}x`);
    const { start, end } = itemSourceRange(item);
    const itemSeconds = (end - start) / rate;
    if (itemSeconds < minimumItemSeconds) {
      skippedItems.push({ itemId: item.itemId, itemSeconds: roundTo(itemSeconds), reason: "item-below-minimum-length" });
      continue;
    }
    const words = collectWordIntervals(sourceTranscript, start, end);
    let cursor = start;
    const spans = [];
    for (const word of words) {
      if (word.start - cursor >= minimumSeconds) spans.push([cursor, word.start]);
      cursor = Math.max(cursor, word.end);
    }
    if (end - cursor >= minimumSeconds) spans.push([cursor, end]);
    const asrSpans = spans.slice();
    for (const interval of silenceIntervals) {
      const left = Math.max(start, interval.start);
      const right = Math.min(end, interval.end);
      if (right - left >= minimumSeconds) spans.push([left, right]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    merged.forEach(([spanStart, spanEnd], index) => {
      const before = words.filter((word) => word.end <= spanStart).at(-1) ?? null;
      const after = words.find((word) => word.start >= spanEnd) ?? null;
      const timelineStartSeconds = (item.timelineStartFrame / fps) + (spanStart - start) / rate;
      const timelineEndSeconds = (item.timelineStartFrame / fps) + (spanEnd - start) / rate;
      candidates.push({
        id: `${item.itemId}-g${index + 1}`,
        asrGap: asrSpans.some(([left, right]) => left < spanEnd && right > spanStart),
        itemId: item.itemId,
        sourceStart: roundTo(spanStart),
        sourceEnd: roundTo(spanEnd),
        durationSeconds: roundTo(spanEnd - spanStart),
        timelineStart: roundTo(timelineStartSeconds),
        timelineEnd: roundTo(timelineEndSeconds),
        headBoundary: spanStart === start,
        tailBoundary: spanEnd === end,
        precedingWord: before ? { id: before.id, text: before.text, end: roundTo(before.end) } : null,
        followingWord: after ? { id: after.id, text: after.text, start: roundTo(after.start) } : null,
        requiresIndividualReason: spanEnd - spanStart >= GAP_REVIEW_EMPHASIS_SECONDS
      });
    });
  }
  return { candidates, skippedItems };
};

/**
 * Parse raw `ffmpeg silencedetect` output from scripts/detect-silence.sh.
 * Returns merged intervals in source seconds so a candidate can cite dB evidence.
 * The default invocation tags each detector `silencedetect@db30|db35|db40`, so the
 * threshold is read from the tag; a leading `threshold_db=` line (single-threshold
 * mode) is honoured too.
 */
export const parseSilenceScan = (text) => {
  const byThreshold = new Map();
  let declaredThreshold = null;
  const ensure = (threshold) => {
    if (!byThreshold.has(threshold)) byThreshold.set(threshold, []);
    return byThreshold.get(threshold);
  };
  for (const rawLine of String(text).split("\n")) {
    const declaredMatch = rawLine.match(/^threshold_db=(-?\d+(?:\.\d+)?)/);
    if (declaredMatch) {
      declaredThreshold = Number(declaredMatch[1]);
      ensure(declaredThreshold);
      continue;
    }
    const tagMatch = rawLine.match(/\[silencedetect@db(\d+(?:\.\d+)?)[\s\]]/);
    const threshold = tagMatch ? -Number(tagMatch[1]) : declaredThreshold;
    if (threshold == null) continue;
    const startMatch = rawLine.match(/silence_start:\s*(-?[\d.]+)/);
    if (startMatch) {
      ensure(threshold).push({ start: Number(startMatch[1]), end: null, duration: null });
      continue;
    }
    const endMatch = rawLine.match(/silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (endMatch) {
      const open = ensure(threshold).at(-1);
      if (open && open.end == null) {
        open.end = Number(endMatch[1]);
        open.duration = Number(endMatch[2]);
      }
    }
  }
  const intervals = [];
  for (const [db, entries] of byThreshold) {
    for (const entry of entries) {
      if (entry.end == null) continue;
      intervals.push({ thresholdDb: db, start: entry.start, end: entry.end, duration: entry.duration });
    }
  }
  return intervals.sort((left, right) => left.start - right.start || right.thresholdDb - left.thresholdDb);
};

export const overlappingThresholds = (silenceIntervals, start, end) => {
  const hits = new Set();
  for (const interval of silenceIntervals) {
    if (interval.end <= start || interval.start >= end) continue;
    hits.add(interval.thresholdDb);
  }
  return [...hits].sort((left, right) => right - left);
};

// Completion is independent of whether any silence was found. Legacy logs with
// detections at every threshold remain readable, but cannot establish zero hits.
export const silenceSweepCompleted = (text) => {
  const thresholds = String(text).match(/^scan_thresholds_db=([^\n]+)$/m)?.[1]?.split(",").map(Number);
  if (thresholds) return /^scan_completed=true$/m.test(text)
    && DEFAULT_SCAN_THRESHOLDS_DB.every((db) => thresholds.includes(db));
  const intervals = parseSilenceScan(text);
  return DEFAULT_SCAN_THRESHOLDS_DB.every((db) => intervals.some((entry) => entry.thresholdDb === db));
};

const BOUNDARY_TOLERANCE_SECONDS = 0.02;

/**
 * Derive the word-free spans that sat inside a pre-cleanup retained item, were
 * strictly internal (not the item's own head or tail), and are absent from the
 * locked timeline. These are the pauses the standard's cleanup steps are
 * responsible for, so recording them is the evidence that cleanup ran.
 */
export const deriveRemovedCandidates = ({
  sourceTranscript,
  preCleanupWindows,
  finalWindows,
  silenceIntervals = [],
  minimumSeconds = GAP_CANDIDATE_MINIMUM_SECONDS
}) => {
  const finalSpans = (finalWindows.clips ?? []).map((item) => itemSourceRange(item));
  const isRetained = (start, end) => finalSpans.some(
    (span) => span.start < end - BOUNDARY_TOLERANCE_SECONDS && span.end > start + BOUNDARY_TOLERANCE_SECONDS
  );
  const removed = [];
  const fps = Number(preCleanupWindows.timelineFps?.numerator ?? 30) / Number(preCleanupWindows.timelineFps?.denominator ?? 1);
  const baselineCandidates = detectGapCandidates({ sourceTranscript, timelineWindows: preCleanupWindows, fps, minimumSeconds, silenceIntervals }).candidates;
  for (const item of preCleanupWindows.clips ?? []) {
    const { start, end } = itemSourceRange(item);
    for (const candidate of baselineCandidates.filter((entry) => entry.itemId === item.itemId)) {
      const { sourceStart: spanStart, sourceEnd: spanEnd } = candidate;
      if (spanStart - start <= BOUNDARY_TOLERANCE_SECONDS || end - spanEnd <= BOUNDARY_TOLERANCE_SECONDS) continue;
      const cuts = [spanStart, spanEnd];
      for (const span of finalSpans) {
        if (span.start > spanStart && span.start < spanEnd) cuts.push(span.start);
        if (span.end > spanStart && span.end < spanEnd) cuts.push(span.end);
      }
      cuts.sort((left, right) => left - right);
      const excised = [];
      for (let index = 0; index < cuts.length - 1; index += 1) {
        const partStart = cuts[index];
        const partEnd = cuts[index + 1];
        if (partEnd - partStart < minimumSeconds) continue;
        if (isRetained(partStart, partEnd)) continue;
        excised.push([partStart, partEnd]);
      }
      const excisedSeconds = excised.reduce((total, [partStart, partEnd]) => total + (partEnd - partStart), 0);
      for (const [partStart, partEnd] of excised) {
        removed.push({
          id: `${item.itemId}-r${removed.length + 1}`,
          itemId: item.itemId,
          sourceStart: roundTo(partStart),
          sourceEnd: roundTo(partEnd),
          durationSeconds: roundTo(partEnd - partStart),
          originalPauseSeconds: roundTo(spanEnd - spanStart),
          retainedSeconds: roundTo(spanEnd - spanStart - excisedSeconds)
        });
      }
    }
  }
  return removed.sort((left, right) => left.sourceStart - right.sourceStart);
};
