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
} finally { fs.rmSync(job, { recursive: true, force: true }); }
console.log("MG speech timing: source trims, rates, repeated clip entries, keyword anchors, missing/ambiguous cues, custom slots and stale snapshots passed");
