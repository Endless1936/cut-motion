#!/usr/bin/env node
// Compute the mandatory terminal-tail / seam tightening plan from original-source
// audio evidence. ASR only locates candidates; the cut frame comes from the
// waveform. This is the computation behind standard fast-path step 3 and the
// "Source-waveform boundary refinement" rules — it replaces the two formulas
// that were tried by hand and failed:
//
//   max(ASR word end, waveform end)  — ASR word ends routinely overshoot real
//                                      energy, so max() preserves the blank it
//                                      is supposed to remove.
//   dB-threshold sweeps              — a threshold labels silence, it does not
//                                      locate a physical edge.
//
// Usage:
//   node scripts/compute-seam-tightening.mjs \
//     --index state/source-audio-waveform-index.json \
//     --windows state/timeline-source-windows.json \
//     [--out state/seam-tightening-plan.json] [--fps 30]
//
// Without --out it prints the plan and changes nothing.
//
// Inputs
//   --index    schema-v3/v4 waveform index from index-source-silence.mjs.
//   --windows  array of { "srcStartUs": <int>, "srcEndUs": <int> } in timeline
//              order, one per retained clip. Source time, not timeline time.
//
// Decide-then-quantize: the waveform boundary is found in microseconds, then
// rounded onto the frame grid. leaveFrames keeps one full frame of the tail so
// the cut never lands inside the last audible sample.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1] ?? fallback;
};

const index = JSON.parse(readFileSync(flag("index"), "utf8"));
const windows = JSON.parse(readFileSync(flag("windows"), "utf8"));
const fps = Number(flag("fps", 30));
const out = flag("out");

if (!Array.isArray(windows) || windows.length === 0) {
  console.error("--windows must be a non-empty array of { srcStartUs, srcEndUs }");
  process.exit(1);
}

const wf = index.waveform;
const windowMs = wf?.windowMs ?? 10;
const featureOrder = wf?.featureOrderPerChannel ?? [
  "peakSample",
  "rmsSample",
  "zeroCrossings",
  "exactZeroSamples",
];
const perChannel = featureOrder.length;
// The index has shipped this field under different names (rmsSample, linearRms16).
// Match on "rms" rather than an exact name, so a rename cannot silently zero every window.
const rmsIndex = featureOrder.findIndex((f) => /rms/i.test(f));
if (rmsIndex === -1) {
  console.error(`No RMS feature in featureOrderPerChannel: ${JSON.stringify(featureOrder)}`);
  process.exit(1);
}
const rows = wf.windows;
const channels = Math.max(1, Math.floor(rows[0].length / perChannel));

// Loudest channel wins: a mono-ish or hard-panned delivery must not read as silence.
const rmsAt = (i) => {
  let best = 0;
  for (let c = 0; c < channels; c += 1) {
    const v = rows[i][c * perChannel + rmsIndex];
    if (v > best) best = v;
  }
  return best;
};
const timeUs = (i) => i * windowMs * 1000;
const idxBefore = (us) => Math.min(rows.length - 1, Math.floor(us / (windowMs * 1000)));

const SPEECH = 200; // confident speech
const CONTENT = 100; // quiet but real: word tails, breaths
const RUN = 3; // consecutive windows that prove content, not a stray sample
const leaveFrames = 1;
const FRAME_US = 1e6 / fps;

const lastAtLeast = (boundUs, threshold) => {
  for (let i = idxBefore(boundUs); i >= 0; i -= 1) {
    if (timeUs(i) < boundUs && rmsAt(i) >= threshold) return timeUs(i) + windowMs * 1000;
  }
  return null;
};
const firstAtLeast = (boundUs, threshold) => {
  for (let i = idxBefore(boundUs); i < rows.length; i += 1) {
    if (timeUs(i) >= boundUs && rmsAt(i) >= threshold) return timeUs(i);
  }
  return null;
};
const hasRun = (fromUs, toUs, threshold) => {
  let run = 0;
  for (let i = idxBefore(fromUs); i < rows.length && timeUs(i) < toUs; i += 1) {
    run = rmsAt(i) >= threshold ? run + 1 : 0;
    if (run >= RUN) return true;
  }
  return false;
};

const fallbacks = [];
const trims = windows.map(() => ({ head: 0, tail: 0 }));

// Outgoing edge of every clip but the last, and the timeline tail.
const outs = [];
for (let i = 0; i < windows.length; i += 1) {
  const bound = windows[i].srcEndUs;
  const speechEnd = lastAtLeast(bound, SPEECH);
  if (speechEnd === null) {
    fallbacks.push({ seam: i, side: "out", reason: "no speech found inside the clip" });
    continue;
  }
  let cand = speechEnd + leaveFrames * FRAME_US;
  if (hasRun(cand, bound, CONTENT)) {
    const contentEnd = lastAtLeast(bound, CONTENT) ?? speechEnd;
    cand = Math.max(cand, contentEnd + leaveFrames * FRAME_US);
    fallbacks.push({ seam: i, side: "out", reason: "content survived the speech cut; moved to the content threshold" });
  }
  if (cand >= bound) continue;
  const trim = Math.floor((bound - cand) / FRAME_US);
  if (trim <= 0) continue;
  trims[i].tail = trim;
  outs.push({
    seam: i,
    sourceEndSec: +(bound / 1e6).toFixed(3),
    speechEndSec: +(speechEnd / 1e6).toFixed(3),
    newEndSec: +((bound - trim * FRAME_US) / 1e6).toFixed(3),
    tailMs: +((bound - speechEnd) / 1000).toFixed(1),
    trimFrames: trim,
  });
}

// Incoming edge of every clip but the first, and the timeline head.
const ins = [];
for (let i = 0; i < windows.length; i += 1) {
  const bound = windows[i].srcStartUs;
  const speechStart = firstAtLeast(bound, SPEECH);
  if (speechStart === null) {
    fallbacks.push({ seam: i, side: "in", reason: "no speech found inside the clip" });
    continue;
  }
  let cand = speechStart - leaveFrames * FRAME_US;
  if (hasRun(bound, cand, CONTENT)) {
    const contentStart = firstAtLeast(bound, CONTENT) ?? speechStart;
    cand = Math.min(cand, contentStart - leaveFrames * FRAME_US);
    fallbacks.push({ seam: i, side: "in", reason: "content precedes the speech start; moved to the content threshold" });
  }
  if (cand <= bound) continue;
  const trim = Math.floor((cand - bound) / FRAME_US);
  if (trim <= 0) continue;
  trims[i].head = trim;
  ins.push({
    seam: i,
    sourceStartSec: +(bound / 1e6).toFixed(3),
    speechStartSec: +(speechStart / 1e6).toFixed(3),
    newStartSec: +((bound + trim * FRAME_US) / 1e6).toFixed(3),
    headMs: +((speechStart - bound) / 1000).toFixed(1),
    trimFrames: trim,
  });
}

const clips = windows.map((w, i) => {
  const startUs = Math.round(w.srcStartUs + trims[i].head * FRAME_US);
  const endUs = Math.round(w.srcEndUs - trims[i].tail * FRAME_US);
  const frames = Math.max(0, Math.round((endUs - startUs) / FRAME_US));
  return {
    index: i,
    srcStartUs: startUs,
    srcEndUs: endUs,
    srcStartSec: +(startUs / 1e6).toFixed(4),
    srcEndSec: +(endUs / 1e6).toFixed(4),
    durationFrames: frames,
  };
});

const currentFrames = windows.reduce(
  (sum, w) => sum + Math.round((w.srcEndUs - w.srcStartUs) / FRAME_US),
  0
);
const newFrames = clips.reduce((sum, c) => sum + c.durationFrames, 0);
const trimFramesOut = outs.reduce((s, x) => s + x.trimFrames, 0);
const trimFramesIn = ins.reduce((s, x) => s + x.trimFrames, 0);
const headTail = clips[0].srcStartUs > windows[0].srcStartUs || clips.at(-1).srcEndUs < windows.at(-1).srcEndUs;

const plan = {
  rule:
    "waveform evidence decides the cut frame (standard step 3 and boundary refinement); ASR and dB sweeps only locate candidates",
  thresholds: { speech: SPEECH, content: CONTENT, runWindows: RUN, leaveFrames },
  timelineFps: fps,
  windowMs,
  clipCount: windows.length,
  seamCount: windows.length - 1,
  out: outs,
  in: ins,
  fallbacks,
  clips,
  trimFramesOut,
  trimFramesIn,
  includesHeadTail: headTail,
  currentFrames,
  newFrames,
  durationSec: +(newFrames / fps).toFixed(2),
};

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const outMs = outs.map((x) => x.tailMs);
const inMs = ins.map((x) => x.headMs);

console.log("Seam tightening from waveform evidence");
console.log(`  clips ${windows.length}  seams ${windows.length - 1}  fps ${fps}`);
console.log(`  out edges trimmed ${outs.length}/${windows.length}  median ${median(outMs)}ms  total ${(outMs.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
console.log(`  in  edges trimmed ${ins.length}/${windows.length}  median ${median(inMs)}ms  total ${(inMs.reduce((a, b) => a + b, 0) / 1000).toFixed(2)}s`);
console.log(`  frames ${currentFrames} -> ${newFrames}  (${(currentFrames / fps).toFixed(2)}s -> ${plan.durationSec}s)`);
console.log(`  content-threshold fallbacks: ${fallbacks.length}`);
for (const f of fallbacks.slice(0, 5)) console.log(`    seam ${f.seam} ${f.side}: ${f.reason}`);

if (out) {
  writeFileSync(out, `${JSON.stringify(plan, null, 1)}\n`);
  console.log(`\nWrote ${out}`);
} else {
  console.log("\nDry run — pass --out <path> to write the plan.");
}
