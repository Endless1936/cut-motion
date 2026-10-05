import { normalizeCaptionText } from "./caption-review-utils.mjs";

/** Hosted tools may expose data directly, as JSON text, or inside MCP content. */
export function unwrapChatcut(value) {
  if (typeof value === "string") {
    try { return unwrapChatcut(JSON.parse(value)); } catch { return { text: value }; }
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(unwrapChatcut);
  const { structuredContent, content, ...metadata } = value;
  if (Array.isArray(content)) {
    const blocks = content.filter(block => block.type === "text").map(block => unwrapChatcut(block.text));
    const structured = structuredContent == null ? {} : unwrapChatcut(structuredContent);
    return { ...metadata, ...Object.assign({}, ...blocks), ...structured,
      text: structured?.text || blocks.map(block => block?.text ?? "").filter(Boolean).join("\n") || metadata.text || "" };
  }
  if (structuredContent != null) return { ...metadata, ...unwrapChatcut(structuredContent) };
  if (value.text && typeof value.text === "object") return { ...metadata, ...unwrapChatcut(value.text) };
  if (typeof value.text === "string") {
    try {
      const parsed = JSON.parse(value.text);
      if (parsed && typeof parsed === "object") return { ...metadata, ...unwrapChatcut(parsed) };
    } catch { /* Ordinary word-bearing text is already unwrapped. */ }
  }
  return value;
}

export const chatcutPages = value => {
  const data = unwrapChatcut(value);
  return Array.isArray(data) ? data : [data];
};
export const chatcutText = value => chatcutPages(value).map(page => page?.text ?? "").filter(Boolean).join("\n");

const range = value => ({ startFrame: value.startFrame ?? value.fromFrame,
  endFrame: value.endFrame ?? value.toFrame });
const quotedText = line => {
  const match = line.match(/\btext=("(?:\\.|[^"\\])*")/u);
  return match ? JSON.parse(match[1]) : "";
};
const validRange = value => Number.isInteger(value.startFrame) && Number.isInteger(value.endFrame)
  && value.startFrame >= 0 && value.endFrame > value.startFrame;

/** Accept the hosted read_captions JSON response, including its text-only payload. */
export function normalizeCaptionCards(value, { fps, projectId, timelineId } = {}) {
  const pages = chatcutPages(value);
  const cards = [];
  let resolvedFps = fps;
  for (const [pageIndex, page] of pages.entries()) {
    if (!page) throw new Error("Empty ChatCut caption response");
    if (projectId && page.projectId && page.projectId !== projectId) throw new Error("Caption project differs from the approved cut");
    const pageTimeline = page.timelineId ?? page.state?.id;
    if (timelineId && pageTimeline && pageTimeline !== timelineId) throw new Error("Caption timeline differs from the approved cut");
    const pageFps = page.fps ?? page.state?.fps;
    if (pageFps !== undefined) {
      if (resolvedFps !== undefined && pageFps !== resolvedFps) throw new Error("Caption FPS differs from the approved cut");
      resolvedFps = pageFps;
    }
    let pageCards;
    if (Array.isArray(page.cards)) {
      pageCards = page.cards.map(card => ({ ...card, ...range(card), words: (card.words ?? card.tokens ?? []).map(word => ({
        ...word, ...range(word), timingProvenance: word.timingProvenance ?? word.timing,
        sourceTokenIds: word.sourceTokenIds ?? word.sourceTokens
      })) }));
    } else {
      pageCards = [];
      let card;
      for (const line of String(page.text ?? "").split("\n")) {
        const header = line.match(/^\[C\d+\]\s+id=(\S+).*?\bframe=(\d+)-(\d+)/u);
        if (header) {
          card = { id: header[1], startFrame: Number(header[2]), endFrame: Number(header[3]), text: quotedText(line), words: [] };
          pageCards.push(card);
          continue;
        }
        const token = line.match(/^\s*- token=(\S+)\s+frame=(\d+)-(\d+).*?\btiming=(\S+)/u);
        if (card && token) card.words.push({ id: token[1], startFrame: Number(token[2]), endFrame: Number(token[3]),
          text: quotedText(line), timingProvenance: token[4], sourceTokenIds: line.match(/\bsourceTokens=(\S+)/u)?.[1] });
      }
    }
    if (pageCards.some(card => !validRange(card) || card.words.some(word => !Number.isInteger(word.startFrame)
      || !Number.isInteger(word.endFrame) || word.startFrame < 0 || word.endFrame < word.startFrame))) {
      throw new Error(`Caption page ${pageIndex + 1} has invalid frame ranges`);
    }
    // Hosted responses include zero-frame tokens; preserve card wording, but never invent their word duration.
    for (const card of pageCards) card.words = card.words.filter(word => validRange(word) && String(word.text).trim());
    cards.push(...pageCards);
    if (pageIndex === pages.length - 1 && (page.hasMore === true || page.nextOffset != null)) {
      throw new Error("Caption response has another page; save each returned page once in order");
    }
  }
  if (!(resolvedFps > 0) || !Number.isFinite(resolvedFps)) throw new Error("Caption frame timing needs the approved timeline FPS");
  const seen = new Set();
  for (const card of cards) {
    const key = `${card.id}:${card.startFrame}:${card.endFrame}`;
    if (seen.has(key)) throw new Error("Caption response repeats a card; remove duplicate pages");
    seen.add(key);
  }
  if (!cards.length) throw new Error("ChatCut caption response contains no cards");
  return { fps: resolvedFps, cards };
}

/** Wording corrections are applied once; they do not alter any timing evidence. */
export function correctCaptionText(text, corrections = {}) {
  const entries = Object.entries(corrections).filter(([from]) => from.replace(/\s/gu, "").length).sort((a, b) => b[0].length - a[0].length);
  if (!entries.length) return String(text);
  const key = value => String(value).replace(/\s/gu, "").toLowerCase();
  // An expansion such as 即梦 -> 即梦AI must preserve an already-correct name,
  // including when correct and incorrect occurrences share one phrase.
  const expanded = entries.filter(([from, to]) => key(to) !== key(from) && key(to).includes(key(from)))
    .map(([, to]) => [String(to), String(to)]);
  const byText = new Map([...expanded, ...entries].map(([from, to]) => [key(from), to]));
  const pattern = [...new Set([...expanded, ...entries].map(([from]) => from))].sort((a, b) => b.length - a.length)
    .map(from => [...from.replace(/\s/gu, "")]
    .map(character => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")).join("|");
  return String(text).replace(new RegExp(pattern, "giu"), match => String(byText.get(key(match))));
}

/** Reuse existing phrase cards where wording matches; sparse edits replace only affected entries. */
export function deriveCaptionCues(transcript, captionData, corrections = {}, edits = {}, fps = captionData?.fps ?? 30) {
  return transcript.segments.flatMap(segment => {
    const finalize = cues => {
      const canonical = normalizeCaptionText(cues.map(cue => cue.text).join("")) === normalizeCaptionText(segment.text);
      return cues.map(cue => ({ ...cue, text: canonical ? cue.text : correctCaptionText(cue.text, corrections) }));
    };
    const cards = captionData?.cards.filter(card => card.endFrame / captionData.fps > segment.start + 1e-6
      && card.startFrame / captionData.fps < segment.end - 1e-6) ?? [];
    const cues = finalize(cards.map(card => {
      const contained = card.startFrame / captionData.fps >= segment.start - 1e-6 && card.endFrame / captionData.fps <= segment.end + 1e-6;
      const words = card.words.filter(word => word.endFrame / captionData.fps > segment.start + 1e-6
        && word.startFrame / captionData.fps < segment.end - 1e-6);
      const text = contained ? card.text : words.map(word => word.text).join("");
      return { segmentId: segment.id, text,
        start: Math.max(segment.start, card.startFrame / captionData.fps), end: Math.min(segment.end, card.endFrame / captionData.fps) };
    }).filter(cue => cue.text));
    if (edits[segment.id]) {
      const authored = edits[segment.id];
      if (authored.every(cue => typeof cue === "string")) {
        const phrases = finalize(authored.map(text => ({ segmentId: segment.id, text })));
        const words = cards.flatMap(card => card.words).filter(word => word.timingProvenance === "measured"
          && word.startFrame / fps >= segment.start - 1e-6 && word.endFrame / fps <= segment.end + 1e-6)
          .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
        const prefixes = [""];
        for (const word of words) prefixes.push(prefixes.at(-1) + word.text);
        const normalizedPrefixes = prefixes.map(text => normalizeCaptionText(correctCaptionText(text, corrections)));
        let prefix = "";
        let firstWord = 0;
        const aligned = phrases.map(cue => {
          prefix += normalizeCaptionText(cue.text);
          const endWord = normalizedPrefixes.indexOf(prefix, firstWord + 1);
          const result = endWord > firstWord ? { ...cue, start: words[firstWord].startFrame / fps, end: words[endWord - 1].endFrame / fps } : null;
          if (endWord > firstWord) firstWord = endWord;
          return result;
        });
        if (aligned.every((cue, index) => cue && cue.end > cue.start && (index === 0 || cue.start >= aligned[index - 1]?.end))
          && firstWord === words.length) return aligned;
        if (phrases.length === cues.length && phrases.every((cue, index) => normalizeCaptionText(cue.text) === normalizeCaptionText(cues[index].text))) {
          return phrases.map((cue, index) => ({ ...cue, start: cues[index].start, end: cues[index].end }));
        }
        // Caption-only estimates stay in this plan; MG timing reads measured tokens independently.
        const startFrame = Math.ceil(segment.start * fps - 1e-6);
        const endFrame = Math.floor(segment.end * fps + 1e-6);
        const spareFrames = endFrame - startFrame - phrases.length;
        if (spareFrames < 0) throw new Error(`${segment.id}: fewer caption frames than phrases; combine adjacent phrases`);
        const weights = phrases.map(cue => Math.max(1, normalizeCaptionText(cue.text).length));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let consumed = 0;
        return phrases.map((cue, index) => {
          const from = startFrame + index + Math.round(spareFrames * consumed / total);
          consumed += weights[index];
          const to = index === phrases.length - 1 ? endFrame : startFrame + index + 1 + Math.round(spareFrames * consumed / total);
          return { ...cue, start: from / fps, end: to / fps };
        });
      }
      return finalize(authored.map(cue => ({ ...cue, segmentId: segment.id })));
    }
    if (cues.length && normalizeCaptionText(cues.map(cue => cue.text).join("")) === normalizeCaptionText(segment.text)
      && cues.every((cue, index) => index === 0 || cue.start >= cues[index - 1].end - 1e-6)) return cues;
    return [{ segmentId: segment.id, text: segment.text, start: segment.start, end: segment.end }];
  });
}
