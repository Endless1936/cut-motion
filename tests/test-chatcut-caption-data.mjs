import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeCaptionCards, correctCaptionText, deriveCaptionCues, chatcutText } from "../scripts/chatcut-caption-data.mjs";
import { applyCorrections, buildMainTimelineTranscript, buildCaptionPlan } from "../scripts/plan-artifacts.mjs";
import { keywordFrame, prepareSpeechTiming, loadSpeechTiming } from "../scripts/mg-speech-timing.mjs";

const text = '[C0] id=cue:a mode=auto frame=0-30 text="扣 d ex 文案"\n'
  + ' - token=a frame=2-4 duration=2 timing=measured sourceTokens=source-a text="扣"\n'
  + ' - token=b frame=4-5 duration=1 timing=measured sourceTokens=source-b text="d"\n'
  + ' - token=c frame=5-6 duration=1 timing=measured sourceTokens=source-c text="ex"\n'
  + ' - token=d frame=6-10 duration=4 timing=measured sourceTokens=source-d text="文案"\n'
  + ' - token=z frame=10-10 duration=0 timing=measured sourceTokens=source-z text="，"\n'
  + '[C1] id=cue:b mode=custom frame=30-60 text="画面"\n'
  + ' - token=e frame=30-40 duration=10 timing=estimated sourceTokens=none text="画面"\n';
const response = { structuredContent: { projectId: "project", timelineId: "timeline", hasMore: false, text } };
const corrections = { "扣dex": "Codex" };
const data = normalizeCaptionCards(response, { fps: 30 });
assert.equal(data.cards.length, 2);
assert.equal(data.cards[0].words[0].sourceTokenIds, "source-a");
assert.equal(data.cards[1].words[0].timingProvenance, "estimated");
assert.equal(chatcutText(JSON.stringify({ text: "word evidence" })), "word evidence");
assert.equal(chatcutText({ content: [{ type: "text", text: JSON.stringify({ structuredContent: { text: "word evidence" } }) }] }), "word evidence");
assert.equal(chatcutText({ structuredContent: null, content: [{ type: "text", text: "word evidence" }] }), "word evidence");
assert.deepEqual(normalizeCaptionCards({ content: [{ type: "text", text: JSON.stringify(response) }] }, { fps: 30 }), data);
assert.equal(correctCaptionText("扣 d ex 文案", corrections), "Codex 文案");
assert.equal(correctCaptionText("甲甲", { 甲: "乙", 乙: "丙" }), "乙乙", "corrections never cascade");
assert.equal(correctCaptionText("即梦AI和即梦", { 即梦: "即梦AI" }), "即梦AI和即梦AI", "mixed canonical and raw names expand only the raw occurrence");
assert.throws(() => normalizeCaptionCards({ ...response.structuredContent, hasMore: true }, { fps: 30 }), /another page/);
assert.throws(() => normalizeCaptionCards([response, response], { fps: 30 }), /repeats a card/);
assert.throws(() => normalizeCaptionCards(response, { fps: 30, projectId: "other" }), /project/);
const second = { cards: [{ id: "cue:c", startFrame: 60, endFrame: 90, text: "音频", words: [] }], hasMore: false };
assert.equal(normalizeCaptionCards([{ ...response.structuredContent, hasMore: true }, second], { fps: 30 }).cards.length, 3);

const snapshot = { projectId: "project", state: { id: "timeline", fps: 30, durationFrames: 60 }, transcript: {
  coverage: "complete", entries: [{ itemId: "item", text: "扣 d ex 文案画面", sourceRange: { start: 0, end: 2000000 },
    timelineRange: { fromFrame: 0, toFrame: 60 } }]
} };
const transcript = buildMainTimelineTranscript({ snapshot, corrections });
assert.equal(transcript.segments[0].text, "Codex 文案画面");
assert.equal(transcript.segments[0].rawText, "扣 d ex 文案画面");
assert.deepEqual(deriveCaptionCues(transcript, data, corrections).map(cue => cue.text), ["Codex 文案", "画面"]);
const phrases = { "main-001": ["Codex文案", "画面"] };
const measuredCards = structuredClone(data);
measuredCards.cards[1].words[0].timingProvenance = "measured";
const measuredPhrases = deriveCaptionCues(transcript, measuredCards, corrections, phrases);
assert.deepEqual(measuredPhrases.map(cue => [cue.start, cue.end]), [[2 / 30, 10 / 30], [1, 40 / 30]], "semantic phrases reuse measured token boundaries");
const cardPhrases = deriveCaptionCues(transcript, data, corrections, phrases);
assert.deepEqual(cardPhrases.map(cue => [cue.start, cue.end]), [[0, 1], [1, 2]], "without complete word coverage, exact existing card phrases retain their ranges");
const estimatedPhrases = deriveCaptionCues(transcript, undefined, corrections, phrases, 24);
assert.equal(estimatedPhrases[0].start, 0);
assert.equal(estimatedPhrases.at(-1).end, 2);
assert(estimatedPhrases.every(cue => Number.isInteger(cue.start * 24) && Number.isInteger(cue.end * 24)), "caption-only allocation uses timeline frames");
const narrowTranscript = { segments: [{ id: "narrow", text: "很".repeat(99) + "短", start: 0, end: 2 / 30 }] };
const narrowCues = deriveCaptionCues(narrowTranscript, undefined, {}, { narrow: ["很".repeat(99), "短"] });
assert.deepEqual(narrowCues.map(cue => [cue.start, cue.end]), [[0, 1 / 30], [1 / 30, 2 / 30]], "even extreme phrase weights reserve at least one frame each");
assert.throws(() => deriveCaptionCues({ segments: [{ ...narrowTranscript.segments[0], end: 1 / 30 }] }, undefined, {},
  { narrow: ["很".repeat(99), "短"] }), /fewer caption frames/, "only physically insufficient input is rejected");
assert.deepEqual(deriveCaptionCues(transcript, data, corrections, { "main-001": [{ text: "Codex文案画面", start: .15, end: 1.8 }] })
  .map(cue => [cue.start, cue.end]), [[.15, 1.8]], "explicit authored times remain unchanged");
const semanticPlan = buildCaptionPlan({ transcript, captionData: measuredCards, corrections, captionEdits: phrases, fps: 30 });
assert.equal(semanticPlan.cues[0].start, .066667);
assert.deepEqual(semanticPlan.cues.map(cue => cue.text), ["Codex文案", "画面"]);
const plan = buildCaptionPlan({ transcript, captionData: data, corrections, captionEdits: {
  "main-001": [{ text: "Codex", start: 0, end: .2 }, { text: "文案画面", start: .2, end: 2 }]
} });
assert.deepEqual(plan.cues.map(cue => cue.text), ["Codex", "文案画面"]);
const folded = applyCorrections([{ text: "扣", start: 0, end: .1 }, { text: "d", start: .1, end: .2 },
  { text: "ex", start: .2, end: .4 }], corrections);
assert.deepEqual(folded.map(({ text, start, end }) => ({ text, start, end })), [{ text: "Codex", start: 0, end: .4 }]);

const expansionSnapshot = { state: { id: "expansion", fps: 30, durationFrames: 30 }, transcript: {
  coverage: "complete", entries: [{ itemId: "item", text: "即梦AI和即梦", timelineRange: { fromFrame: 0, toFrame: 30 } }]
} };
const expansionCorrections = { 即梦: "即梦AI" };
const expansionTranscript = buildMainTimelineTranscript({ snapshot: expansionSnapshot, corrections: expansionCorrections });
assert.equal(expansionTranscript.segments[0].text, "即梦AI和即梦AI");
const expansionCue = { segmentId: "main-001", text: "即梦AI和即梦", start: 0, end: 1 };
for (const options of [
  { captionEdits: {} }, // Automatic fallback uses the already-corrected transcript.
  { captionData: { fps: 30, cards: [{ id: "card", startFrame: 0, endFrame: 30, text: "即梦AI和即梦", words: [] }] } },
  { captionEdits: { "main-001": [expansionCue] } },
  { captionCues: [expansionCue] },
  { captionEdits: { "main-001": [{ ...expansionCue, text: "即梦AI和即梦AI" }] } },
  { captionCues: [{ ...expansionCue, text: "即梦AI和即梦AI" }] }
]) {
  const result = buildCaptionPlan({ transcript: expansionTranscript, corrections: expansionCorrections, ...options });
  assert.equal(result.cues[0].text, "即梦AI和即梦AI", "fallback/cards/sparse/fulltrack never recorrect canonical wording");
}

const job = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-caption-data-"));
try {
  fs.mkdirSync(path.join(job, "state"));
  const write = (name, value) => fs.writeFileSync(path.join(job, "state", name), JSON.stringify(value));
  write("chatcut-main-timeline.json", [snapshot]);
  write("planning-inputs.json", { corrections });
  const timing = prepareSpeechTiming(job, response);
  assert.equal(timing.provider, "chatcut.read_captions");
  assert.equal(timing.words.length, 4, "estimated token/card timing is excluded");
  assert.equal(keywordFrame(timing, { segmentId: "main-001", keyword: "Codex" }), 2);
  assert.equal(keywordFrame(timing, { segmentId: "main-001", keyword: "文案" }), 6);
  assert.throws(() => keywordFrame(timing, { segmentId: "main-001", keyword: "画面" }), /found 0/);
  const repeated = { fps: 30, words: [{ segmentId: "main-001", text: "文案", startFrame: 1, endFrame: 3 },
    { segmentId: "main-001", text: "文案", startFrame: 9, endFrame: 11 }] };
  assert.throws(() => keywordFrame(repeated, { segmentId: "main-001", keyword: "文案" }), /found 2/);
  assert.equal(keywordFrame(repeated, { segmentId: "main-001", keyword: "文案", occurrence: 2 }), 9);
  write("mg-speech-timing.json", timing);
  assert.equal(loadSpeechTiming(job).words.length, 4, "direct timeline words need no source-window file");
  write("planning-inputs.json", { corrections: { "扣dex": "NewName" } });
  assert.equal(keywordFrame(loadSpeechTiming(job), { segmentId: "main-001", keyword: "NewName" }), 2);

  const windows = { sourceAssetId: "asset", sourceSha256: "source", timelineFps: { numerator: 30, denominator: 1 }, clips: [
    { itemId: "item", timelineStartFrame: 0, durationFrames: 60, srcStartUs: 0, srcEndUs: 2000000,
      playbackRateNumerator: 1, playbackRateDenominator: 1 }
  ] };
  write("timeline-source-windows.json", windows);
  const localLookup = { provider: "chatcut.find_transcript", projectId: "project", timelineId: "timeline", assetId: "asset",
    lookups: [{ text: '\n1. result\n V1 [item item]\n Words:\n'
      + ' 6f → 10f (source 00:00.200 → 00:00.333) 文案\n'
      + ' 30f → 40f (source 00:01.000 → 00:01.300) 画面\n'
      + ' 45f → 51f (source 00:01.500 → 00:01.700) 画面\n' }]
  };
  const supplemented = prepareSpeechTiming(job, localLookup);
  assert.equal(supplemented.words.length, 6, "local lookup retains four caption tokens and adds both real occurrences");
  assert.equal(supplemented.words.find(word => word.text === "文案").id, "d", "overlapping existing measured word wins");
  assert.equal(keywordFrame(supplemented, { segmentId: "main-001", keyword: "画面", occurrence: 2 }), 45);
  for (const wrapped of [
    { ...localLookup, lookups: [{ text: JSON.stringify({ text: localLookup.lookups[0].text }) }] },
    { ...localLookup, lookups: [{ text: { structuredContent: { text: localLookup.lookups[0].text } } }] },
    { ...localLookup, lookups: [{ content: [{ type: "text", text: JSON.stringify({ text: localLookup.lookups[0].text }) }] }] },
    { structuredContent: localLookup },
    { content: [{ type: "text", text: JSON.stringify(localLookup) }] }
  ]) assert.equal(prepareSpeechTiming(job, wrapped).words.length, 6, "nested tool responses retain their real word evidence");
  write("mg-speech-timing.json", { ...timing, snapshotSha256: "obsolete" });
  assert.equal(prepareSpeechTiming(job, localLookup).words.length, 3, "obsolete snapshot tokens are not reused");
  write("mg-speech-timing.json", supplemented);
  write("timeline-source-windows.json", { ...windows, sourceSha256: "changed" });
  assert.equal(prepareSpeechTiming(job, localLookup).words.length, 3, "obsolete source mapping tokens are not reused");
} finally { fs.rmSync(job, { recursive: true, force: true }); }
console.log("ChatCut caption data: hosted text/arrays, pages, corrected wording, sparse edits, measured-only timing and real repeats passed");
