#!/usr/bin/env node
// Apply the waveform-derived seam-tightening plan to the ChatCut timeline.
//
// Input : jobs/<job>/state/tightened-clip-list.json  -> final source [start,end] (seconds) per clip
// Output: edit_item updates (fromFrame / durationInFrames / sourceStartFromInSeconds)
//
// Each clip is rewritten to its tightened source window and re-packed back to
// back from frame 0, so every seam closes and no gap is left behind.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialize, callTool } from './chatcut-mcp.mjs';

const JOB = process.argv[2] || '2026-09-30-dji-koubo';
const PROJECT = process.argv[3];
const APPLY = process.argv.includes('--apply');
const FPS = 30;

const ROOT = new URL('..', import.meta.url).pathname;
const clips = JSON.parse(
  readFileSync(join(ROOT, 'jobs', JOB, 'state', 'tightened-clip-list.json'), 'utf8')
);

const updates = [];
let cursor = 0;
const rows = [];
for (const [start, end] of clips) {
  const durFrames = Math.round((end - start) * FPS);
  rows.push({
    fromFrame: cursor,
    durationInFrames: durFrames,
    sourceStartFromInSeconds: Number(start.toFixed(3)),
    sourceEndSec: Number(end.toFixed(3)),
  });
  cursor += durFrames;
}

async function main() {
  await initialize();
  if (PROJECT) await callTool('target_project', { projectId: PROJECT });

  // Pull the live clip ids in timeline order.
  let all = '';
  for (const offset of [0, 50]) {
    all += (await callTool('preview_timeline', { offset })).text + '\n';
  }
  const re = /- item V1 \[([0-9a-f-]+)\] type=video startFrame=(\d+) range=\[(\d+), (\d+)\) asset="source\.mp4" \[([0-9a-f-]+)\] source=\[(\d+), (\d+)\)us/g;
  const items = [...all.matchAll(re)].map((x) => ({
    id: x[1],
    startFrame: +x[2],
    ssUs: +x[6],
  }));
  if (items.length !== rows.length) {
    throw new Error(`clip count mismatch: timeline=${items.length} plan=${rows.length}`);
  }

  const payload = rows.map((r, i) => ({
    id: items[i].id,
    fromFrame: r.fromFrame,
    durationInFrames: r.durationInFrames,
    sourceStartFromInSeconds: r.sourceStartFromInSeconds,
  }));

  writeFileSync(
    join(ROOT, 'jobs', JOB, 'state', 'chatcut-tighten-updates.json'),
    JSON.stringify({ fps: FPS, totalFrames: cursor, updates: payload }, null, 2) + '\n'
  );

  const summary = {
    planClips: rows.length,
    beforeFrames: items.length ? null : null,
    afterFrames: cursor,
    afterSec: Number((cursor / FPS).toFixed(2)),
  };
  console.log(JSON.stringify(summary, null, 2));

  const res = await callTool('edit_item', {
    updates: payload,
    validateOnly: !APPLY,
  });
  console.log(res.text.slice(0, 4000));
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
