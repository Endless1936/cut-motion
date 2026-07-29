const decimal = (value) => Number(Number(value).toFixed(6));

export const transcriptWordsById = (transcript) => new Map(
  (transcript.segments ?? []).flatMap((segment) => (segment.words ?? []).map((word, index) => [
    `${segment.id}:word-${String(index + 1).padStart(3, "0")}`,
    word
  ]))
);

export const resolveBeatRenderWindow = (beat, beatMap, wordsById) => {
  const fps = Number(beatMap.fps);
  const fullDuration = Number(beatMap.duration);
  const start = Number(beat.start);
  const entryWord = wordsById.get(beat.entryAnchorWordId);
  const exitWord = wordsById.get(beat.exitAnchorWordId);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`${beat.id}: Beat Map fps must be positive`);
  if (!Number.isFinite(fullDuration) || fullDuration <= 0) throw new Error(`${beat.id}: Beat Map duration must be positive`);
  if (!Number.isFinite(start) || start < 0) throw new Error(`${beat.id}: Beat start must be non-negative`);
  if (!entryWord || !exitWord) throw new Error(`${beat.id}: entry and exit anchors must resolve`);
  if (!Number.isInteger(beat.exitAnchorOffsetFrames) || beat.exitAnchorOffsetFrames < 0) {
    throw new Error(`${beat.id}: exitAnchorOffsetFrames must be a non-negative integer`);
  }
  if (!Number.isInteger(beat.exitFrames) || beat.exitFrames < 1) {
    throw new Error(`${beat.id}: exitFrames must be a positive integer`);
  }
  const exitStart = Number(exitWord.end) + beat.exitAnchorOffsetFrames / fps;
  const exitDuration = beat.exitFrames / fps;
  const unclampedEnd = exitStart + exitDuration;
  const end = Math.min(fullDuration, unclampedEnd);
  if (!Number.isFinite(exitStart) || end <= start) throw new Error(`${beat.id}: resolved render window is invalid`);
  return {
    start: decimal(start),
    end: decimal(end),
    entryAnchorTime: decimal(Number(entryWord.start)),
    exitAnchorTime: decimal(exitStart),
    exitStartTime: decimal(exitStart),
    exitDuration: decimal(exitDuration),
    unclampedEnd: decimal(unclampedEnd)
  };
};
