const IGNORED_CAPTION_CHARACTERS = /[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u;
export const normalizeCaptionText = (value) => [...String(value).normalize("NFKC").toLowerCase()]
  .filter((character) => !IGNORED_CAPTION_CHARACTERS.test(character))
  .join("");

export const transcriptWords = (transcript) => {
  const words = [];
  for (const segment of transcript.segments ?? []) {
    for (const [index, word] of (segment.words ?? []).entries()) {
      words.push({
        ...word,
        id: `${segment.id}:word-${String(index + 1).padStart(3, "0")}`,
        segmentId: segment.id
      });
    }
  }
  return words;
};

export const resolveCaptionCues = (plan, transcript) => {
  const authoredTime = (value, fallback) => {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return fallback;
    if ((typeof value !== "number" && typeof value !== "string") || !Number.isFinite(Number(value))) {
      throw new Error("Caption timestamp must be numeric or left blank for word alignment");
    }
    return Number(value);
  };
  const cues = plan.cues ?? [];
  const manualRanges = cues.some((cue) => cue.segmentId !== undefined);
  if (manualRanges) {
    if (cues.some((cue) => cue.segmentId === undefined || cue.startWordId !== undefined || cue.endWordId !== undefined)) {
      throw new Error("caption plan cannot mix manual segment ranges with word ranges");
    }
    const segments = transcript.segments ?? [];
    const indexBySegmentId = new Map(segments.map((segment, index) => [segment.id, index]));
    let previousSegmentIndex = -1;
    let previousEnd = -Infinity;
    return cues.map((cue) => {
      const segmentIndex = indexBySegmentId.get(cue.segmentId);
      if (segmentIndex === undefined) throw new Error(`${cue.id}: segmentId does not resolve`);
      const segment = segments[segmentIndex];
      const start = authoredTime(cue.start, null);
      const end = authoredTime(cue.end, null);
      if (start === null || end === null || !(end > start)) throw new Error(`${cue.id}: manual caption range needs numeric start and end`);
      if (start < segment.start - 1e-6 || end > segment.end + 1e-6) {
        throw new Error(`${cue.id}: manual caption range must stay within ${cue.segmentId}`);
      }
      if (segmentIndex < previousSegmentIndex || start < previousEnd - 1e-6) {
        throw new Error(`${cue.id}: manual caption ranges must follow the transcript and timeline order`);
      }
      previousSegmentIndex = segmentIndex;
      previousEnd = end;
      return { ...cue, start: Number(start.toFixed(6)), end: Number(end.toFixed(6)), resolvedText: cue.text };
    });
  }
  const words = transcriptWords(transcript);
  const indexById = new Map(words.map((word, index) => [word.id, index]));
  let previousEndIndex = -1;
  return cues.map((cue) => {
    const startIndex = indexById.get(cue.startWordId);
    const endIndex = indexById.get(cue.endWordId);
    if (startIndex === undefined) throw new Error(`${cue.id}: startWordId does not resolve`);
    if (endIndex === undefined) throw new Error(`${cue.id}: endWordId does not resolve`);
    if (endIndex < startIndex) throw new Error(`${cue.id}: endWordId precedes startWordId`);
    if (startIndex !== previousEndIndex + 1) {
      throw new Error(`${cue.id}: word range must continue immediately after the previous cue`);
    }
    const cueWords = words.slice(startIndex, endIndex + 1);
    previousEndIndex = endIndex;
    return {
      ...cue,
      start: Number(authoredTime(cue.start, cueWords[0].start).toFixed(6)),
      end: Number(authoredTime(cue.end, cueWords.at(-1).end).toFixed(6)),
      resolvedText: cueWords.map((word) => word.text).join(""),
      startWordIndex: startIndex,
      endWordIndex: endIndex
    };
  });
};
