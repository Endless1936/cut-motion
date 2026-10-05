import test from "node:test";
import assert from "node:assert/strict";
import { tightenEdges, timelineClips } from "../scripts/roughcut.mjs";
const clip = (id, from = 0, source = 0) => ({ id, itemType: "video", asset: { id: "source" }, trackId: "v1", timelineRange: { fromFrame: from, toFrame: from + 30 }, sourceRange: { start: source * 1e6, end: (source + 1) * 1e6 } });
test("one-frame safety and ripple shortening preserve source boundaries", () => {
  const rms = Array.from({ length: 200 }, (_, i) => i % 100 >= 20 && i % 100 < 80 ? 500 : 0);
  const p = tightenEdges({ fps: 30, clips: [clip("a"), clip("b", 30, 1)] }, { rms });
  assert.equal(p.clips[0].headFrames, 5); assert.equal(p.clips[0].tailFrames, 5);
  assert.equal(p.clips[1].timelineStartFrame, 20); assert.equal(p.totalTrimFrames, 20);
});
test("soft sustained speech guards both edges; no activity is kept", () => {
  const rms = Array.from({ length: 100 }, (_, i) => i >= 5 && i < 95 ? (i >= 20 && i < 80 ? 500 : 120) : 0);
  const p = tightenEdges({ fps: 30, clips: [clip("a")] }, { rms });
  assert.equal(p.totalTrimFrames, 0);
  assert.equal(tightenEdges({ fps: 30, clips: [clip("a")] }, { rms: Array(100).fill(0) }).totalTrimFrames, 0);
});
test("sound outside a retained clip cannot influence its edge", () => {
  const rms = Array.from({ length: 100 }, (_, i) => i < 25 ? 500 : 0);
  const c = { ...clip("a"), sourceRange: { start: 250000, end: 750000 }, timelineRange: { fromFrame: 0, toFrame: 15 } };
  assert.equal(tightenEdges({ fps: 30, clips: [c] }, { rms }).totalTrimFrames, 0);
});
test("snapshot pages unwrap and incomplete or retimed footage is explicit", () => {
  const page = { state: { id: "t", fps: 30, durationFrames: 30 }, timeline: { totalEntries: 1, entries: [clip("a")] } };
  assert.equal(timelineClips([{ structuredContent: page }]).clips.length, 1);
  assert.throws(() => timelineClips({ ...page, timeline: { totalEntries: 2, entries: [clip("a")] } }), /all preview pages/);
  assert.throws(() => timelineClips({ ...page, timeline: { totalEntries: 1, entries: [{ ...clip("a"), playbackRate: 2 }] } }), /1×/);
});
