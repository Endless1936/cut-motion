import test from "node:test";
import assert from "node:assert/strict";
import { unwrapToolResult, readCaptionTiming, readFindTranscriptTiming, readTiming, resolveKeywordTiming, projectSourceTiming } from "../scripts/timing.mjs";

const response = { fps: 30, cards: [{ id: "c1", text: "你好你好", tokens: [
  { id: "a", text: "你好", fromFrame: 30, endFrame: 45, timingProvenance: "asr" },
  { id: "b", text: "你好", fromFrame: 60, endFrame: 75, timingProvenance: "asr" }
] }] };

test("tool JSON envelopes are unpacked without parsing display summaries", () => {
  assert.deepEqual(unwrapToolResult({ structuredContent: response }), response);
  assert.deepEqual(unwrapToolResult({ content: [{ type: "text", text: JSON.stringify(response) }] }), response);
  assert.deepEqual(unwrapToolResult(JSON.stringify(response)), response);
  assert.throws(() => unwrapToolResult("{truncated"), /complete JSON/);
  assert.throws(() => unwrapToolResult({ content: [{ type: "text", text: "Tool output summary" }] }), /no structured JSON/);
});

test("actual frame timings preserve repeated words and require occurrence", () => {
  const timing = readCaptionTiming(response);
  assert.deepEqual(timing.words.map(w => [w.text, w.start, w.end]), [["你好", 1, 1.5], ["你好", 2, 2.5]]);
  assert.throws(() => resolveKeywordTiming(timing, "你好"), /2 measured occurrences/);
  assert.equal(resolveKeywordTiming(timing, "你好", { occurrence: 2 }).start, 2);
  assert.equal(resolveKeywordTiming(timing, "你好", { from: 1.8 }).start, 2);
  assert.throws(() => resolveKeywordTiming(timing, "你好", { occurrence: 0 }), /one-based/);
});

test("find_transcript text Words blocks carry actual timeline frames without source projection", () => {
  const text = '# Provenance: find_transcript | timestamps=source ms + timeline frames\nFound 1 match(es) for "音频"\n1. [1] "[音频]"\n   Timeline placement:\n     V1 [item clip1]: 30f → 42f\n   Words:\n     30f → 36f  (source 00:05.000 → 00:05.200)   音\n     36f → 42f  (source 00:05.200 → 00:05.400)   频\n';
  const timing = readTiming({ structuredContent: { text } }, { fps: 30 });
  assert.equal(timing.provider, "chatcut.find_transcript");
  assert.equal(resolveKeywordTiming(timing, "音频").start, 1);
  assert.equal(timing.words[0].sourceStart, "00:05.000");
  assert.equal(readFindTranscriptTiming({ content: [{ type: "text", text }] }).words.length, 2);
  assert.throws(() => readTiming({ structuredContent: { text: "(no captions item associated with current track scope)" } }), /No find_transcript/);
  assert.throws(() => readFindTranscriptTiming({ text: text.split("   Words:")[0] }), /includeWordTimestamps/);
});

test("overlapping lookups share the same frame evidence but real repetitions remain", () => {
  const text = '# Provenance: find_transcript | timestamps=source ms + timeline frames\nWords:\n  30f → 36f (source 00:05.000 → 00:05.200) 音\n  36f → 42f (source 00:05.200 → 00:05.400) 频\n';
  const replay = text.replace("30f", "90f").replaceAll("36f", "96f").replace("42f", "102f");
  const timing = readFindTranscriptTiming({ lookups: [
    { query: "音频", text }, { query: "包括音频", text }, { query: "音频", text: replay }
  ] });
  assert.equal(timing.words.length, 4);
  assert.deepEqual(timing.words[0].queries, ["音频", "包括音频"]);
  assert.throws(() => resolveKeywordTiming(timing, "音频"), /2 measured occurrences/);
  assert.equal(resolveKeywordTiming(timing, "音频", { occurrence: 2 }).start, 3);
  assert.equal(resolveKeywordTiming(timing, "音频", { query: "包括音频" }).start, 1);
});

test("Card/sentence timing and synthetic tokens cannot manufacture keyword onsets", () => {
  assert.throws(() => readCaptionTiming({ fps: 30, cards: [{ text: "文案画面", fromFrame: 0, endFrame: 60 }] }), /No measured/);
  assert.throws(() => readCaptionTiming({ fps: 30, transcript: { entries: [] } }), /Card spans/);
  const partial = readCaptionTiming({ fps: 30, cards: [{ id: "c1", tokens: [
    { text: "包括文案", fromFrame: 0, endFrame: 60 },
    { text: "画面", fromFrame: 60, endFrame: 90, timingProvenance: "interpolated" }
  ] }] });
  assert.equal(partial.missing.length, 1);
  assert.throws(() => resolveKeywordTiming(partial, "文案"), /token-boundary/);
});

test("measured token phrases join only across observed adjacent words", () => {
  const timing = { words: [
    { text: "音", start: 1, end: 1.1 }, { text: "频", start: 1.1, end: 1.3 },
    { text: "剪", start: 3, end: 3.1 }, { text: "辑", start: 4, end: 4.1 }
  ] };
  assert.equal(resolveKeywordTiming(timing, "音频").start, 1);
  assert.throws(() => resolveKeywordTiming(timing, "剪辑"), /No measured/);
  assert.throws(() => resolveKeywordTiming({ words: [
    { text: "文案", start: 1, end: 1.2, queries: ["文案"] },
    { text: "画面", start: 1.25, end: 1.5, queries: ["画面"] }
  ] }, "文案画面"), /No measured/);
});

test("local source projection handles speed and replay without a state-file chain", () => {
  const timing = projectSourceTiming([{ text: "文案", start: 1, end: 1.4, sourceId: "a" }], [
    { id: "one", sourceId: "a", sourceStart: 0, sourceEnd: 2, timelineStart: 0, rate: 2 },
    { id: "replay", sourceId: "a", sourceStart: 0, sourceEnd: 2, timelineStart: 3 }
  ]);
  assert.deepEqual(timing.words.map(w => w.start), [0.5, 4]);
  assert.equal(resolveKeywordTiming(timing, "文案", { occurrence: 2 }).start, 4);
  const clipped = projectSourceTiming([{ text: "文案", start: 1, end: 1.4 }], [
    { sourceStart: 1.2, sourceEnd: 2, timelineStart: 0 }
  ]);
  assert.equal(clipped.words[0].onsetMeasured, false);
  assert.throws(() => resolveKeywordTiming(clipped, "文案"), /No measured/);
});
