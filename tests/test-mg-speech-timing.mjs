import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapSourceWord, prepareSpeechTiming, loadSpeechTiming, keywordFrame, resolveRevealTimes, bindSpeechReveals } from "../scripts/mg-speech-timing.mjs";
import { resolveComponent } from "../scripts/motion-template-library.mjs";

const clip = { itemId: "abcdef12-3456", timelineStartFrame: 60, durationFrames: 90, srcStartUs: 10000000, srcEndUs: 13000000, playbackRateNumerator: 1, playbackRateDenominator: 1 };
const word = { text: "文", sourceStartUs: 10310000, sourceEndUs: 10510000 };
assert.equal(mapSourceWord(word, clip, 30).startFrame, 70); // ceil, never the rounded early frame
assert.equal(mapSourceWord({ ...word, sourceStartUs: 9800000 }, clip, 30).startFrame, 60);
assert.equal(mapSourceWord({ ...word, sourceStartUs: 12900000, sourceEndUs: 13200000 }, clip, 30).endFrame, 150);
assert.equal(mapSourceWord({ ...word, sourceStartUs: 9500000, sourceEndUs: 9900000 }, clip, 30), null);
assert.equal(mapSourceWord(word, { ...clip, playbackRateNumerator: 2, durationFrames: 45 }, 30).startFrame, 65);

const job = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-speech-test-"));
try {
  fs.mkdirSync(path.join(job, "state"));
  const json = (name, data) => fs.writeFileSync(path.join(job, "state", name), JSON.stringify(data));
  const pages = [{ projectId: "project", state: { id: "timeline" }, transcript: { entries: [
    { itemId: clip.itemId, sourceRange: { start: 10000000, end: 11500000 } },
    { itemId: clip.itemId, sourceRange: { start: 11500000, end: 13000000 } }
  ] } }];
  json("chatcut-main-timeline.json", pages);
  json("timeline-source-windows.json", { sourceAssetId: "asset", sourceSha256: "source", timelineFps: { numerator: 30, denominator: 1 }, clips: [clip] });
  const lookup = { provider: "chatcut.find_transcript", projectId: "project", timelineId: "timeline", assetId: "asset", lookups: [{ text: '\n1. match\n  V1 [item abcdef1234]: 60f → 150f\n  Words:\n    69f → 75f (source 00:10.310 → 00:10.510) 文\n    75f → 81f (source 00:10.510 → 00:10.710) 案、\n    120f → 126f (source 00:12.000 → 00:12.200) 豆\n    126f → 132f (source 00:12.200 → 00:12.400) 包。\n' }] };
  const timing = prepareSpeechTiming(job, lookup);
  assert.deepEqual(timing.words.map(word => word.segmentId), ["main-001", "main-001", "main-002", "main-002"]); // one clip can have several transcript entries
  assert.equal(keywordFrame(timing, { keyword: "文案", segmentId: "main-001" }), 70);
  assert.equal(keywordFrame(timing, { keyword: "豆包", segmentId: "main-002" }), 120);
  assert.throws(() => keywordFrame(timing, { keyword: "豆包", segmentId: "main-001" }), /found 0/);
  assert.throws(() => keywordFrame({ ...timing, words: [...timing.words, ...timing.words] }, { keyword: "文案", segmentId: "main-001" }), /found 2/);
  const gap = { ...timing, words: timing.words.slice(0, 2).map((word, index) => index ? { ...word, sourceStartUs: 12000000 } : word) };
  assert.throws(() => keywordFrame(gap, { keyword: "文案", segmentId: "main-001" }), /found 0/);
  const beat = { id: "beat-test", templateData: { revealCues: [{ keyword: "文案", segmentId: "main-001" }, { after: 0, delayFrames: 6 }, { keyword: "豆包", segmentId: "main-002" }] } };
  const window = { start: 2, exitStartTime: 4.5 };
  assert.deepEqual(resolveRevealTimes(beat, window, timing), [.333333, .533333, 2]);
  const canonicalBeat={...beat,start:2,end:4.5,templateData:{...beat.templateData,items:["文案","说明"],result:"豆包"}};
  const canonical=resolveComponent("converge-sources").render({beat:canonicalBeat});
  const bound=bindSpeechReveals(canonical.fragment,canonicalBeat,window,timing);
  assert.deepEqual([...bound.matchAll(/data-at="([^"]+)"/g)].map(match=>Number(match[1])),[.333333,.533333,2],"Reusable variable-count MG keeps irregular spoken intervals");
  assert.equal(bindSpeechReveals('<b data-at="0"></b><i data-at=".5"></i><b data-at="1"></b>', beat, window, timing), '<b data-at="0.333333"></b><i data-at="0.533333"></i><b data-at="2"></b>');
  assert.throws(() => bindSpeechReveals('<b data-at="0"></b>', beat, window, timing), /slots/);
  assert.throws(() => resolveRevealTimes(beat, { ...window, exitStartTime: 4 }, timing), /readable window/);
  assert.equal(resolveRevealTimes({ templateData: { revealTimes: [0, .5] } }, window, null), null); // existing jobs remain readable
  json("mg-speech-timing.json", timing);
  assert.equal(loadSpeechTiming(job).words.length, 4);
  assert.throws(() => loadSpeechTiming(job, 60), /FPS/);
  assert.throws(() => prepareSpeechTiming(job, { ...lookup, timelineId: "other" }), /provenance/);
  json("chatcut-main-timeline.json", [...pages, { projectId: "changed" }]);
  assert.throws(() => loadSpeechTiming(job), /stale/);

  const splitJob = path.join(job, "split-entry");
  fs.mkdirSync(path.join(splitJob, "state"), { recursive: true });
  const splitWrite = (name, value) => fs.writeFileSync(path.join(splitJob, "state", name), JSON.stringify(value));
  splitWrite("chatcut-main-timeline.json", [{ projectId: "project", state: { id: "timeline" }, transcript: { entries: [
    { itemId: clip.itemId, sourceRange: { start: 10000000, end: 10400000 } },
    { itemId: clip.itemId, sourceRange: { start: 10400000, end: 13000000 } }
  ] } }]);
  splitWrite("timeline-source-windows.json", { sourceAssetId: "asset", sourceSha256: "source", timelineFps: { numerator: 30, denominator: 1 }, clips: [clip] });
  const splitTiming = prepareSpeechTiming(splitJob, lookup);
  assert.equal(splitTiming.words.find(word => word.segmentId === "main-001" && word.text === "文").endFrame, 72);
  assert.equal(keywordFrame(splitTiming, { keyword: "文案", segmentId: "main-002" }), 72, "A word crossing entries cannot make the second entry start before its own source range");
  splitWrite("mg-speech-timing.json", { ...splitTiming, words: splitTiming.words.map(word => word.text === "文"
    ? { ...word, startFrame: 70, endFrame: 76, sourceStartUs: 10310000, sourceEndUs: 10510000 } : word) });
  const refreshedSplit = prepareSpeechTiming(splitJob, lookup);
  assert.equal(refreshedSplit.words.find(word => word.segmentId === "main-001" && word.text === "文").endFrame, 72, "Fresh source evidence repairs a previously cached overlong word");
  assert.equal(keywordFrame(refreshedSplit, { keyword: "文案", segmentId: "main-002" }), 72);

  const multiJob = path.join(job, "multi-source");
  fs.mkdirSync(path.join(multiJob, "state"), { recursive: true });
  const multiWrite = (name, value) => fs.writeFileSync(path.join(multiJob, "state", name), JSON.stringify(value));
  const multiClips = [
    { assetId: "asset-a", itemId: "shared12-a", timelineStartFrame: 0 },
    { assetId: "asset-b", itemId: "shared12-b", timelineStartFrame: 30 },
    { assetId: "asset-a", itemId: "replay-a", timelineStartFrame: 60 }
  ].map(clip => ({ ...clip, durationFrames: 30, srcStartUs: 0, srcEndUs: 1000000, playbackRateNumerator: 1, playbackRateDenominator: 1 }));
  multiWrite("chatcut-main-timeline.json", [{ projectId: "project", state: { id: "timeline" }, transcript: { entries:
    multiClips.map(clip => ({ itemId: clip.itemId, sourceRange: { start: 0, end: 1000000 } })) } }]);
  multiWrite("timeline-source-windows.json", { schemaVersion: 2, sources: [
    { sourceAssetId: "asset-a", sourceSha256: "source-a" }, { sourceAssetId: "asset-b", sourceSha256: "source-b" }
  ], timelineFps: { numerator: 30, denominator: 1 }, clips: multiClips });
  const multiLookup = (assetId, text, placements) => ({ provider: "chatcut.find_transcript", projectId: "project", timelineId: "timeline", assetId,
    lookups: [{ text: `\n1. match\n ${placements}\n Words:\n 6f → 9f (source 00:00.200 → 00:00.300) ${text}\n` }] });
  const firstSource = prepareSpeechTiming(multiJob, multiLookup("asset-a", "画面", "[item shared12] [item replay-a]"));
  assert.deepEqual(firstSource.words.map(word => [word.segmentId, word.startFrame, word.assetId]), [["main-001", 6, "asset-a"], ["main-003", 66, "asset-a"]]);
  multiWrite("mg-speech-timing.json", firstSource);
  const bothSources = prepareSpeechTiming(multiJob, multiLookup("asset-b", "音频", "[item shared12]"));
  assert.equal(bothSources.words.length, 3, "Collecting B retains A and its genuine replay");
  assert.equal(keywordFrame(bothSources, { keyword: "音频", segmentId: "main-002" }), 36);
  assert.equal(keywordFrame(bothSources, { keyword: "画面", segmentId: "main-003" }), 66);
  assert.throws(() => prepareSpeechTiming(multiJob, multiLookup("unknown", "音频", "[item shared12]")), /provenance/);
  assert.throws(() => prepareSpeechTiming(multiJob, multiLookup("asset-b", "音频", "[item replay-a]")), /no usable word/);
} finally { fs.rmSync(job, { recursive: true, force: true }); }
console.log("MG speech timing: source trims, rates, repeated clip entries, keyword anchors, missing/ambiguous cues, custom slots and stale snapshots passed");
