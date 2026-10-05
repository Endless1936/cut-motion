#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File } from "../scripts/workflow-utils.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/prepare-rough-cut.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-prepare-"));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function job(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "input"), { recursive: true });
  fs.mkdirSync(path.join(dir, "state"));
  fs.writeFileSync(path.join(dir, "input", "source.mov"), "fixture source");
  write(path.join(dir, "state", "project.json"), { sourceVideo: "input/source.mov", fps: 30 });
  write(path.join(dir, "state", "workflow.json"), { currentState: "motion-plan", mode: "review", history: [], gates: {} });
  return dir;
}
function run(dir, command, page, success = true) {
  const input = path.join(dir, "state", "response.json");
  write(input, page);
  const result = spawnSync(process.execPath, [script, dir, command, input], { encoding: "utf8" });
  if (success) assert.equal(result.status, 0, result.stderr || result.stdout);
  else assert.notEqual(result.status, 0, "Incomplete input unexpectedly passed");
  return `${result.stdout}\n${result.stderr}`;
}
try {
  const page = { asset: { id: "asset", durationMs: 1000 }, transcript: { ranges: [
    { range: { startMs: 0, endMs: 1000 }, segments: [{ text: "你好", startMs: 200, endMs: 800 }] }
  ] } };
  const imported = job("transcript");
  run(imported, "transcript", { structuredContent: page });
  const transcript = read(path.join(imported, "state", "source-transcript.json"));
  assert.equal(transcript.segments[0].words[0].start, 0.2);
  assert.equal(transcript.segments[0].text, "你好");
  assert.equal(read(path.join(imported, "state", "workflow.json")).sourceTranscriptSha256,
    sha256File(path.join(imported, "state", "source-transcript.json")));

  const incomplete = job("missing-page");
  const missing = structuredClone(page);
  missing.transcript.ranges[0].range.endMs = 500;
  assert.match(run(incomplete, "transcript", missing, false), /remaining source transcript pages/);
  assert.equal(fs.existsSync(path.join(incomplete, "state", "transcript.json")), false);

  const tightened = job("tighten");
  const indexPath = path.join(tightened, "state", "source-audio-waveform-index.json");
  write(indexPath, {
    schemaVersion: 4,
    source: { sha256: sha256File(path.join(tightened, "input", "source.mov")), startTimeUs: 0, durationUs: 1000000 },
    audio: { startTimeUs: 0, durationUs: 1000000, sampleRate: 48000, channels: 1 },
    waveform: { windowMs: 10, windowSamples: 480, decodedSampleCount: 48000,
      featureOrderPerChannel: ["linearPeak16", "linearRms16", "zeroCrossings", "exactZeroSamples"],
      windows: Array.from({ length: 100 }, (_, i) => i >= 20 && i < 80 ? [600, 600, 4, 0] : [0, 0, 0, 480]) }
  });
  const indexHash = sha256File(indexPath);
  run(tightened, "tighten", { projectId: "project", state: { id: "timeline", fps: 30, durationFrames: 30 },
    timeline: { totalEntries: 1, entries: [{ id: "clip", itemType: "video", asset: { id: "asset" }, trackId: "track",
      timelineRange: { fromFrame: 0, toFrame: 30 }, sourceRange: { start: 0, end: 1000000 } }] } });
  assert.equal(sha256File(indexPath), indexHash, "Valid cached index must be reused");
  const plan = read(path.join(tightened, "state", "seam-tightening-plan.json"));
  const proposed = read(path.join(tightened, "state", "timeline-source-windows.proposed.json"));
  assert.equal(plan.proposedTotalTrimFrames, 10);
  assert.equal(proposed.clips[0].durationFrames, 20);
  assert.equal(proposed.clips[0].srcStartUs, plan.clips[0].sourceStartUsAfterTrim);
  assert.equal(read(path.join(tightened, "state", "timeline-source-windows.json")).clips[0].durationFrames, 30);
  assert.deepEqual(plan.editItemArgs, { projectId: "project", ripple: false, updates: [{
    id: "clip", timelineId: "timeline", trackId: "track", fromFrame: 0,
    durationInFrames: 20, sourceStartFromInSeconds: plan.clips[0].sourceStartUsAfterTrim / 1e6,
  }] });

  // Rounded microsecond endpoints can represent slightly more than two frames.
  // Only the first clip needs tightening; later clips shift but must not grow.
  const precise = job("frame-preservation");
  const preciseIndex = read(indexPath);
  preciseIndex.source.sha256 = sha256File(path.join(precise, "input", "source.mov"));
  preciseIndex.source.durationUs = preciseIndex.audio.durationUs = 2000000;
  preciseIndex.waveform.decodedSampleCount = 96000;
  preciseIndex.waveform.windows.push(...Array.from({ length: 100 }, () => [600, 600, 4, 0]));
  write(path.join(precise, "state", "source-audio-waveform-index.json"), preciseIndex);
  const preciseEntries = [{ id: "trimmed", itemType: "video", asset: { id: "asset" }, trackId: "track",
    timelineRange: { fromFrame: 0, toFrame: 30 }, sourceRange: { start: 0, end: 1000000 } },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `unchanged-${i}`, itemType: "video", asset: { id: "asset" }, trackId: "track",
      timelineRange: { fromFrame: 30 + i * 2, toFrame: 32 + i * 2 },
      sourceRange: { start: Math.round(1000000 + i * 2e6 / 30), end: Math.round(1000000 + (i + 1) * 2e6 / 30) } }))];
  assert.ok(preciseEntries.slice(1).some(e => Math.ceil((e.sourceRange.end - e.sourceRange.start) * 30 / 1e6) > 2),
    "Fixture exposes the extra-frame error caused by microsecond ceil conversion");
  const precisePages = [preciseEntries.slice(0, 8), preciseEntries.slice(8)].map(entries => ({ structuredContent: {
    projectId: "precise-project", state: { id: "precise-timeline", fps: 30, durationFrames: 60 },
    timeline: { totalEntries: 16, entries },
  } }));
  run(precise, "tighten", precisePages);
  const precisePlan = read(path.join(precise, "state", "seam-tightening-plan.json"));
  assert.equal(precisePlan.proposedDurationFrames, 50);
  assert.equal(precisePlan.editItemArgs.updates.length, 16, "Submit all final track positions together");
  for (const [i, update] of precisePlan.editItemArgs.updates.slice(1).entries()) {
    assert.equal(update.durationInFrames, 2, "Untrimmed clip keeps its original frame duration");
    assert.equal(update.fromFrame, 20 + i * 2, "Later clip shifts by the preceding trim only");
    assert.equal(update.sourceStartFromInSeconds, preciseEntries[i + 1].sourceRange.start / 1e6);
    assert.equal(update.timelineId, "precise-timeline");
    assert.equal(update.trackId, "track");
  }
  const beforeMixed = sha256File(path.join(precise, "state", "seam-tightening-plan.json"));
  const mixedPages = structuredClone(precisePages);
  mixedPages[1].structuredContent.projectId = "different-project";
  assert.match(run(precise, "tighten", mixedPages, false), /different snapshots or projects/);
  assert.equal(sha256File(path.join(precise, "state", "seam-tightening-plan.json")), beforeMixed);

  run(tightened, "tighten", { state: { id: "timeline", fps: 30, durationFrames: 2 },
    timeline: { totalEntries: 1, entries: [{ id: "no-op", itemType: "video", asset: { id: "asset" }, trackId: "track",
      timelineRange: { fromFrame: 0, toFrame: 2 }, sourceRange: { start: 0, end: 66667 } }] } });
  assert.deepEqual(read(path.join(tightened, "state", "seam-tightening-plan.json")).editItemArgs,
    { ripple: false, updates: [] }, "No trim needs no edit call, including legacy snapshots without projectId");

  const mapped = job("approved-windows");
  const encoded = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=16x16:r=30:d=1", "-c:v", "libx264", "-y", path.join(mapped, "input", "source.mov")], { encoding: "utf8" });
  assert.equal(encoded.status, 0, encoded.stderr);
  const entry = (id, from, to, start, end, playbackRate = 1) => ({ id, itemType: "video", asset: { id: "asset" }, trackId: "track",
    timelineRange: { fromFrame: from, toFrame: to }, sourceRange: { start, end }, playbackRate });
  const snapshot = (durationFrames, entries) => ({ state: { id: "timeline", fps: 30, durationFrames }, timeline: { totalEntries: entries.length, entries } });
  run(mapped, "windows", [snapshot(30, [entry("first", 0, 30, 0, 1000000)])]);
  assert.equal(fs.existsSync(path.join(mapped, "state", "source-audio-waveform-index.json")), false);
  assert.equal(fs.existsSync(path.join(mapped, "state", "seam-tightening-plan.json")), false);
  run(mapped, "windows", { structuredContent: snapshot(18, [entry("first", 0, 6, 0, 200000), entry("second", 6, 18, 600000, 1000000)]) });
  const revisedWindows = read(path.join(mapped, "state", "timeline-source-windows.json"));
  assert.deepEqual(revisedWindows.clips.map(c => [c.itemId, c.timelineStartFrame, c.durationFrames, c.srcStartUs]), [["first", 0, 6, 0], ["second", 6, 12, 600000]]);
  run(mapped, "windows", snapshot(15, [entry("fast", 0, 15, 0, 1000000, 2)]));
  const fast = read(path.join(mapped, "state", "timeline-source-windows.json")).clips[0];
  assert.equal(fast.playbackRateNumerator / fast.playbackRateDenominator, 2);
  const beforeInvalid = sha256File(path.join(mapped, "state", "timeline-source-windows.json"));
  run(mapped, "windows", snapshot(15, [entry("invalid", 0, 15, 0, 1000000, 1)]), false);
  assert.equal(sha256File(path.join(mapped, "state", "timeline-source-windows.json")), beforeInvalid);
  console.log("prepare-rough-cut fixtures passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
