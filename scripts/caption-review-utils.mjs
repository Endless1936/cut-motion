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
  const words = transcriptWords(transcript);
  const indexById = new Map(words.map((word, index) => [word.id, index]));
  let previousEndIndex = -1;
  return (plan.cues ?? []).map((cue) => {
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
