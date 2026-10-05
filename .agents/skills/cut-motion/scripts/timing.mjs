#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const normalize = value => String(value ?? "").normalize("NFKC").replace(/[\p{P}\p{Z}\s]/gu, "").toLowerCase();
const seconds = value => Number(value.toFixed(6));

// Parse the saved tool result, never a displayed/truncated tool-output summary.
export function unwrapToolResult(value) {
  if (typeof value === "string") {
    try { return unwrapToolResult(JSON.parse(value)); }
    catch { throw new Error("Timing input must be complete JSON; save the raw tool result rather than its printed summary"); }
  }
  if (Array.isArray(value)) return value.map(unwrapToolResult);
  if (!value || typeof value !== "object") throw new Error("Timing input needs a JSON object");
  if (value.structuredContent != null) return unwrapToolResult(value.structuredContent);
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (block.type !== "text") continue;
      let parsed;
      try { parsed = JSON.parse(block.text); } catch { continue; }
      return unwrapToolResult(parsed);
    }
    const text = value.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    if (/Provenance:\s*find_transcript/iu.test(text)) return { text };
    throw new Error("Tool result has no structured JSON timing data; keep the raw response or fetch the missing words locally");
  }
  return value;
}

function measured(token) {
  const provenance = token.timingProvenance ?? token.timing?.provenance ?? token.provenance;
  if (provenance == null) return true; // Canonical word frames, not Card spans.
  const label = typeof provenance === "string" ? provenance : provenance.kind ?? provenance.type ?? provenance.source;
  return typeof label === "string" && /asr|source|measured|aligned|transcri|canonical/iu.test(label)
    && !/interpolat|estimat|synthetic|unknown|unavailable|fallback|uniform/iu.test(label);
}

const fpsValue = value => typeof value === "number" ? value : value?.numerator / value?.denominator;
const tokenRange = token => ({
  startFrame: token.fromFrame ?? token.startFrame ?? token.frameRange?.fromFrame ?? token.frameRange?.startFrame,
  endFrame: token.endFrame ?? token.toFrame ?? token.frameRange?.endFrame ?? token.frameRange?.toFrame
});

// Existing find_transcript Words blocks already report the locked timeline frames.
export function readFindTranscriptTiming(raw, { fps = 30 } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Supply the actual timeline FPS");
  const unpacked = unwrapToolResult(raw);
  const pages = Array.isArray(unpacked) ? unpacked : [unpacked];
  const records = new Map(), missing = [];
  for (const page of pages) {
    const lookups = page.lookups ?? [page];
    for (const lookup of lookups) {
      const text = lookup.text;
      if (typeof text !== "string" || !/Provenance:\s*find_transcript/iu.test(text)) {
        missing.push({ query: lookup.query, reason: "No find_transcript word timing response" });
        continue;
      }
      const query = lookup.query ?? text.match(/Found \d+ match\(es\) for "([^"\n]+)"/u)?.[1];
      const found = [...text.matchAll(/^\s*(\d+)f\s*[→>-]+\s*(\d+)f\s+\(source\s+([\d:.]+)\s*[→>-]+\s*([\d:.]+)\)\s+([^\n]+)$/gmu)];
      if (found.length === 0) missing.push({ query, reason: "No measured timeline word frames; request includeWordTimestamps:true for this keyword" });
      for (const match of found) {
        const startFrame = Number(match[1]), endFrame = Number(match[2]);
        if (endFrame <= startFrame) continue;
        const token = { text: match[5].trim(), startFrame, endFrame, start: seconds(startFrame / fps), end: seconds(endFrame / fps),
          queries: query ? [query] : [], timingProvenance: "chatcut.find_transcript", sourceStart: match[3], sourceEnd: match[4] };
        // Re-reading the same measured token in overlapping queries is one piece of evidence.
        // Real repeats/replays have different timeline frames and remain separate.
        const key = JSON.stringify([startFrame, endFrame, token.sourceStart, token.sourceEnd, token.text]);
        const existing = records.get(key);
        if (existing) existing.queries = [...new Set([...existing.queries, ...token.queries])];
        else records.set(key, token);
      }
    }
  }
  const words = [...records.values()].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  if (!words.length) throw new Error(missing[0]?.reason ?? "No measured word timestamps; do not infer them from sentence spans");
  return { provider: "chatcut.find_transcript", fps, words, missing };
}

export function readTiming(raw, options = {}) {
  const unpacked = unwrapToolResult(raw);
  const first = Array.isArray(unpacked) ? unpacked[0] : unpacked;
  return first?.cards ? readCaptionTiming(unpacked, options) : readFindTranscriptTiming(unpacked, options);
}

export function readCaptionTiming(raw, { fps: suppliedFps } = {}) {
  const unpacked = unwrapToolResult(raw);
  const pages = Array.isArray(unpacked) ? unpacked : [unpacked];
  const fps = fpsValue(suppliedFps ?? pages[0]?.fps ?? pages[0]?.state?.fps);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Supply the actual timeline FPS with --fps when the caption response does not report it");
  const words = [], missing = [];
  for (const page of pages) {
    const pageFps = fpsValue(page.fps ?? page.state?.fps ?? fps);
    if (pageFps !== fps) throw new Error("Caption pages report different FPS; use one locked timeline");
    if (!Array.isArray(page.cards)) throw new Error("Expected read_captions Cards with words:true; Card spans and preview transcript sentences are not word timing");
    for (const card of page.cards) {
      const variants = card.words || card.tokens ? [card] : Array.isArray(card.variants) ? card.variants : [];
      if (variants.length === 0) missing.push({ cardId: card.id, text: card.text, reason: "No word tokens; read this Card with words:true" });
      for (const variant of variants) {
        const tokens = variant.words ?? variant.tokens;
        if (!Array.isArray(tokens) || tokens.length === 0) {
          missing.push({ cardId: card.id, reason: "No word tokens" });
          continue;
        }
        for (const token of tokens) {
          const { startFrame, endFrame } = tokenRange(token);
          if (!token.text || !Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame <= startFrame || !measured(token)) {
            missing.push({ cardId: card.id, tokenId: token.id, text: token.text, reason: "No measured absolute word frame range" });
            continue;
          }
          words.push({ text: token.text, start: seconds(startFrame / fps), end: seconds(endFrame / fps),
            startFrame, endFrame, cardId: card.id, tokenId: token.id,
            ...(variant.language ? { language: variant.language } : {}),
            ...(token.timingProvenance ? { timingProvenance: token.timingProvenance } : {}) });
        }
      }
    }
  }
  words.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  if (words.length === 0) throw new Error(`No measured word timing: ${missing[0]?.reason ?? "no Cards"}; fetch only the needed keywords instead of estimating sentence timings`);
  return { provider: "chatcut.read_captions", fps, words, missing };
}

// One-based occurrence disambiguates actual repeated speech without text deduplication.
export function resolveKeywordTiming(timing, keyword, { occurrence, from = 0, to = Infinity, language, query, maxGap = 0.5 } = {}) {
  const target = normalize(keyword);
  if (!target) throw new Error("Keyword must contain spoken text");
  const words = timing.words.filter(word => word.onsetMeasured !== false && word.start >= from && word.start < to
    && (!language || word.language === language) && (!query || word.query === query || word.queries?.includes(query)));
  const matches = [];
  for (let first = 0; first < words.length; first++) {
    let text = "";
    for (let last = first; last < words.length; last++) {
      if (last > first && (words[last].start < words[last - 1].end || words[last].start - words[last - 1].end > maxGap)) break;
      if (last > first && words[last].queries && words[last - 1].queries
        && !words[last].queries.some(query => words[last - 1].queries.includes(query))) break;
      text += normalize(words[last].text);
      if (text === target) {
        matches.push({ start: words[first].start, end: words[last].end, words: words.slice(first, last + 1) });
        break;
      }
      if (!target.startsWith(text)) break;
    }
  }
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) throw new Error("occurrence is a one-based positive integer");
  if (matches.length > 1 && occurrence === undefined) throw new Error(`Keyword '${keyword}' has ${matches.length} measured occurrences; specify occurrence or a local time range`);
  const match = matches[(occurrence ?? 1) - 1];
  if (!match) throw new Error(`No measured token-boundary timing for '${keyword}' in this range; fetch its local word timing, do not divide a sentence span`);
  return match;
}

// Optional local fallback: inputs already have measured source-word seconds and actual clip placements.
export function projectSourceTiming(sourceWords, clips, { fps = 30 } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("Projection needs a positive timeline FPS");
  const words = [];
  for (const clip of clips) {
    const rate = clip.rate ?? 1;
    if (![clip.sourceStart, clip.sourceEnd, clip.timelineStart, rate].every(Number.isFinite) || clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart || clip.timelineStart < 0 || rate <= 0) throw new Error("Clip needs sourceStart/sourceEnd/timelineStart seconds and positive rate");
    for (const word of sourceWords) {
      if (clip.sourceId !== undefined && word.sourceId !== clip.sourceId) continue;
      if (!word.text || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || !measured(word)) continue;
      const begin = Math.max(word.start, clip.sourceStart), end = Math.min(word.end, clip.sourceEnd);
      if (end <= begin) continue;
      words.push({ ...word, start: seconds(clip.timelineStart + (begin - clip.sourceStart) / rate),
        end: seconds(clip.timelineStart + (end - clip.sourceStart) / rate), clipId: clip.id,
        // A cut inside a token has no measured onset for the full word.
        onsetMeasured: begin === word.start });
    }
  }
  words.sort((a, b) => a.start - b.start || a.end - b.end);
  return { provider: "source-word-projection", fps, words, missing: [] };
}

function main(args) {
  const [input, output, ...options] = args;
  if (!input || !output) throw new Error("Usage: node timing.mjs <raw-caption-result.json> <timing-cache.json> [--fps 30] [--keyword text] [--occurrence 1]");
  const flag = name => { const at = options.indexOf(name); return at < 0 ? undefined : options[at + 1]; };
  const fps = flag("--fps");
  const timing = readTiming(fs.readFileSync(input, "utf8"), fps ? { fps: Number(fps) } : {});
  if (path.resolve(input) === path.resolve(output) || /(?:^|[\/])plan(?:\.example)?\.json$/u.test(output)) throw new Error("Write a separate timing cache; the tool does not replace the plan or its corrected captions");
  const keyword = flag("--keyword"), occurrence = flag("--occurrence");
  const match = keyword ? resolveKeywordTiming(timing, keyword, occurrence ? { occurrence: Number(occurrence) } : {}) : undefined;
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(timing, null, 2) + "\n");
  console.log(JSON.stringify({ output, words: timing.words.length, missing: timing.missing.length, ...(match ? { keyword, start: match.start, end: match.end } : {}) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
