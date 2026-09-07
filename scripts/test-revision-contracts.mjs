import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertCaptionSequence, frameWindowTiming } from "./frame-window-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";
import { createTimelineCut, cutFromSeconds, retimeDocument } from "./timeline-cut-utils.mjs";
import { clippedContentRect, findContentCollision, bindFaceCoverApproval } from "./build-composition.mjs";

const cue = (id, startFrame, endFrame) => ({ id, startFrame, endFrame, lines: [id] });
assertCaptionSequence([cue("a", 0, 32), cue("b", 32, 60)]);
assert.throws(() => assertCaptionSequence([cue("a", 0, 32), cue("b", 31, 60)]), /overlaps/);
assert.throws(() => assertCaptionSequence([cue("a", 32, 60), cue("b", 0, 32)]), /precedes/);
assert.throws(() => assertCaptionSequence([cue("a", 0, 32), cue("a", 32, 60)]), /Duplicate/);
for (const fps of [24, 30, 30000 / 1001, 60]) {
  for (let start = 0; start < 300; start++) {
    for (const length of [1, 3, 31, 59, 89, 200]) {
      const end = start + length;
      const timing = frameWindowTiming(cue("a", start, end), fps);
      assert.ok(timing.start + timing.duration <= end / fps, "outgoing caption must be hidden on the next cue's first frame");
      assert.ok((end - 1) / fps < timing.start + timing.duration, "last included frame must remain visible");
    }
  }
}
const transcript = { segments: [{ id: "s", words: [{ text: "测试", start: 4, end: 5 }] }] };
for (const blank of [undefined, null, "", "  "]) {
  const resolved = resolveCaptionCues({ cues: [{ id: "a", startWordId: "s:word-001", endWordId: "s:word-001", start: blank, end: blank }] }, transcript);
  assert.equal(resolved[0].start, 4);
  assert.equal(resolved[0].end, 5);
}
assert.throws(() => resolveCaptionCues({ cues: [{ id: "a", startWordId: "s:word-001", endWordId: "s:word-001", start: false }] }, transcript), /timestamp/);

const cut = createTimelineCut(30, 626, 1140);
const captions = { source: { fps: 30 }, duration: 148.6, cues: [cue("before", 580, 626), cue("removed", 626, 1140), cue("after", 1140, 1181)] };
const original = JSON.stringify(captions);
const shifted = retimeDocument(captions, cut);
assert.equal(JSON.stringify(captions), original, "the settled source must remain immutable");
assert.deepEqual(shifted.removedIds, ["removed"]);
assert.deepEqual(shifted.document.cues.map(c => [c.startFrame, c.endFrame]), [[580, 626], [626, 667]]);
assert.equal(shifted.document.cues[1].start, 626 / 30);
assert.ok(Math.abs(shifted.document.duration - 3944 / 30) < 1e-9);
assert.deepEqual(cutFromSeconds(30, 626 / 30, 38), cut);
assert.throws(() => cutFromSeconds(30, 20.85, 38), /integer frame/);
assert.throws(() => createTimelineCut(0, 1, 2), /fps/);
assert.throws(() => retimeDocument({ ...captions, source: { fps: 60 } }, cut), /differs/);
assert.throws(() => retimeDocument({ ...captions, duration: 20 }, cut), /beyond/);
assert.throws(() => retimeDocument({ cues: [cue("crossing", 620, 630)] }, cut), /crosses/);
assert.throws(() => retimeDocument({ cues: [cue("enclosing", 600, 1200)] }, cut), /crosses/);
assert.throws(() => retimeDocument({ segments: [] }, cut), /Only released captions/);

const beatMap = { fps: 30, duration: 148.6, beats: [
  { id: "removed", start: 22, end: 24, microEvents: [{ time: 22 }] },
  { id: "after", start: 40, end: 42, audioAnchorTime: 40, entryAnchorWordId: "s:word-001", microEvents: [{ time: 40.2, duration: 0.4 }], assets: [{ mediaStart: 72, duration: 2 }] }
] };
const shiftedBeats = retimeDocument(beatMap, cut).document;
assert.equal(shiftedBeats.beats.length, 1);
assert.equal(shiftedBeats.beats[0].start, 40 - 514 / 30);
assert.equal(shiftedBeats.beats[0].microEvents[0].time, 40.2 - 514 / 30);
assert.equal(shiftedBeats.beats[0].microEvents[0].duration, 0.4);
assert.equal(shiftedBeats.beats[0].assets[0].mediaStart, 72, "asset-local offsets are not composition timestamps");
assert.equal(shiftedBeats.beats[0].entryAnchorWordId, "s:word-001");
assert.throws(() => retimeDocument({ beats: [{ id: "cross", start: 20, end: 40 }] }, cut), /crosses/);
assert.throws(() => retimeDocument({ beats: [{ id: "bad-event", start: 40, end: 42, microEvents: [{ time: 37 }] }] }, cut), /deleted passage/);
for (const fps of [30, 30000 / 1001]) {
  const boundaryCut = createTimelineCut(fps, 626, 1140);
  const rounded = (time) => Number(time.toFixed(6));
  const result = retimeDocument({ fps, beats: [
    { id: "before", start: 0, end: rounded(boundaryCut.start) },
    { id: "inside", start: rounded(boundaryCut.start), end: rounded(boundaryCut.end) },
    { id: "after", start: rounded(boundaryCut.end), end: 50, audioAnchorTime: rounded(boundaryCut.end), microEvents: [{time: rounded(boundaryCut.end)}] }
  ] }, boundaryCut);
  assert.deepEqual(result.removedIds, ["inside"]);
  assert.ok(Math.abs(result.document.beats[1].start - boundaryCut.start) < 1e-12);
  assert.equal(result.document.beats[1].audioAnchorTime, result.document.beats[1].start);
  assert.equal(result.document.beats[1].microEvents[0].time, result.document.beats[1].start);
  assert.throws(() => retimeDocument({beats:[{id:"cross",start:0,end:boundaryCut.start+1/fps}]},boundaryCut), /crosses/);
  assert.throws(() => retimeDocument({beats:[{id:"cross",start:boundaryCut.end-1/fps,end:50}]},boundaryCut), /crosses/);
}
const group = '<div data-motion-group="proof" data-axis="A" data-face-cover-approval="user"></div>';
assert.throws(() => bindFaceCoverApproval(group, {id:"proof"}), /recorded user instruction/);
assert.throws(() => bindFaceCoverApproval(group, {id:"proof",layout:{faceCoverApproval:"user",faceSafetyNote:" "}}), /recorded user instruction/);
assert.match(bindFaceCoverApproval('<div data-motion-group="proof" data-axis="A"></div>', {id:"proof",layout:{faceCoverApproval:"user",faceSafetyNote:"User explicitly permits extended coverage"}}), /data-face-cover-approval="user"/);

const root = {};
const panel = { parentElement: root, getBoundingClientRect: () => ({ left: 60, top: 350, right: 1020, bottom: 887 }) };
const image = { parentElement: panel, getBoundingClientRect: () => ({ left: -400, top: -200, right: 1700, bottom: 1000 }) };
assert.deepEqual(clippedContentRect(image, root, () => ({ overflowX: "hidden", overflowY: "hidden" })),
  { left: 60, top: 350, right: 1020, bottom: 887, width: 960, height: 537 });
assert.equal(clippedContentRect(image, root, () => ({ overflowX: "visible", overflowY: "hidden" })).left, -400, "unclipped overflow must remain detectable");
assert.equal(clippedContentRect({ ...image, parentElement: root }, root).left, -400, "the root must not hide canvas overflow");
const collisionImage = {...image,textContent:"",dataset:{}};
const label = {parentElement:root,textContent:"label",dataset:{},getBoundingClientRect:()=>({left:1030,top:350,right:1100,bottom:400,width:70,height:50})};
const visibleRect = (element) => clippedContentRect(element,root,()=>({overflowX:"hidden",overflowY:"hidden"}));
assert.equal(findContentCollision([collisionImage,label],visibleRect),null,"cropped-away image must not collide with a label");
assert.ok(findContentCollision([collisionImage,{...label,getBoundingClientRect:()=>({left:900,top:350,right:1000,bottom:400})}],visibleRect),"visible image overlap must still fail");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-revision-"));
try {
  const input = path.join(temp, "captions.json");
  const output = path.join(temp, "candidate.json");
  fs.writeFileSync(input, original);
  const script = fileURLToPath(new URL("./shift-timestamps.sh", import.meta.url));
  const run = (target, start = String(626 / 30)) => spawnSync("bash", [script, input, start, "38", target], { encoding: "utf8" });
  assert.equal(run(output).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).cues[1].startFrame, 626);
  assert.notEqual(run(output).status, 0, "never replace a candidate silently");
  assert.notEqual(run(input).status, 0, "never replace the source");
  assert.notEqual(run(path.join(temp, "invalid.json"), "20.85").status, 0);
  assert.ok(!fs.existsSync(path.join(temp, "invalid.json")), "invalid cuts must not create output");
  assert.equal(fs.readFileSync(input, "utf8"), original);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("Revision contracts passed: caption exclusivity, blank alignment, frame cuts, candidate safety, clipped focus bounds.");
