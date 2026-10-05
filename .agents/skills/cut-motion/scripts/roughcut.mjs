#!/usr/bin/env node
// One mechanical edge-tightening pass. The Agent applies the resulting ChatCut edits.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function timelineClips(input) {
  const unwrap = value => Array.isArray(value) ? value.flatMap(unwrap) : [value.structuredContent ?? value];
  const pages = unwrap(input), first = pages[0], fps = first?.state?.fps;
  if (!(fps > 0)) throw new Error("Save preview_timeline structuredContent, including state.fps.");
  const entries = new Map();
  for (const page of pages) {
    if (page.state?.id !== first.state.id || page.state.fps !== fps || page.state.durationFrames !== first.state.durationFrames) throw new Error("Preview pages describe different timelines.");
    for (const entry of page.timeline?.entries ?? []) {
      if (entries.has(entry.id) && JSON.stringify(entries.get(entry.id)) !== JSON.stringify(entry)) throw new Error("Conflicting timeline entries.");
      entries.set(entry.id, entry);
    }
  }
  if (entries.size !== first.timeline?.totalEntries) throw new Error("Save all preview pages before tightening.");
  const clips = [...entries.values()].sort((a, b) => a.timelineRange.fromFrame - b.timelineRange.fromFrame);
  if (!clips.length || new Set(clips.map(c => c.asset?.id)).size !== 1 || new Set(clips.map(c => c.trackId)).size !== 1) throw new Error("Use one original video track for edge tightening.");
  let end = 0;
  for (const clip of clips) {
    const range = clip.sourceRange, duration = clip.timelineRange.toFrame - clip.timelineRange.fromFrame;
    if (clip.itemType !== "video" || (clip.playbackRate ?? 1) !== 1 || clip.timelineRange.fromFrame !== end || !(duration > 0) || !(range?.start >= 0 && range.end > range.start) || Math.abs((range.end - range.start) / 1e6 * fps - duration) > 1.01) throw new Error("Tightening needs contiguous 1× source clips.");
    end = clip.timelineRange.toFrame;
  }
  if (end !== first.state.durationFrames) throw new Error("Preview does not cover the complete timeline.");
  return { fps, clips };
}

export function tightenEdges({ fps, clips }, { rms, origin = 0, step = .01, duration = rms.length * step }) {
  const run = (clipStart, clipEnd, from, to, threshold, last = false) => {
    let count = 0, start, found;
    for (let i = Math.max(0, Math.floor((from - origin) / step)); i < rms.length && origin + i * step < to; i++) {
      const a = origin + i * step, b = Math.min(origin + (i + 1) * step, origin + duration);
      if (b <= from) continue;
      if (a < clipStart - 1e-9 || b > clipEnd + 1e-9) { count = 0; continue; }
      if (rms[i] >= threshold) {
        if (!count) start = a;
        if (++count >= 3) { found = { start, end: b }; if (!last) return found; }
      } else count = 0;
    }
    return found;
  };
  let totalTrimFrames = 0;
  const changes = clips.map(clip => {
    const start = clip.sourceRange.start / 1e6, end = clip.sourceRange.end / 1e6;
    if (start < origin - 1e-6 || end > origin + duration + 1e-6) throw new Error("Clip lies outside decoded original audio.");
    const first = run(start, end, start, end, 200), last = run(start, end, start, end, 200, true);
    const head = first && (run(start, end, start, first.start - 1 / fps, 100)?.start ?? first.start);
    const tail = last && (run(start, end, last.end + 1 / fps, end, 100, true)?.end ?? last.end);
    let headFrames = first ? Math.max(0, Math.floor((head - start) * fps + 1e-9) - 1) : 0;
    let tailFrames = last ? Math.max(0, Math.floor((end - tail) * fps + 1e-9) - 1) : 0;
    const durationFrames = clip.timelineRange.toFrame - clip.timelineRange.fromFrame;
    if (headFrames + tailFrames >= durationFrames) headFrames = tailFrames = 0;
    const timelineStartFrame = clip.timelineRange.fromFrame - totalTrimFrames;
    totalTrimFrames += headFrames + tailFrames;
    return { itemId: clip.id, headFrames, tailFrames, timelineStartFrame,
      durationFrames: durationFrames - headFrames - tailFrames,
      sourceStartUs: clip.sourceRange.start + Math.round(headFrames / fps * 1e6),
      sourceEndUs: clip.sourceRange.end - Math.round(tailFrames / fps * 1e6) };
  });
  return { fps, totalTrimFrames, clips: changes };
}

function decodeWaveform(source) {
  const metadata = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_streams", "-of", "json", source], { encoding: "utf8" });
  if (metadata.status !== 0) throw new Error("Cannot probe original audio.");
  const stream = JSON.parse(metadata.stdout).streams[0];
  if (!stream) throw new Error("Original recording has no audio.");
  const channels = stream.channels, rate = Number(stream.sample_rate), framesPerWindow = Math.round(rate / 100);
  const decoded = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-i", source, "-map", "0:a:0", "-vn", "-f", "f32le", "-c:a", "pcm_f32le", "pipe:1"], { maxBuffer: 512 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(decoded.error?.message ?? "Cannot decode original audio.");
  const frames = decoded.stdout.length / (4 * channels), rms = [];
  for (let from = 0; from < frames; from += framesPerWindow) {
    const count = Math.min(framesPerWindow, frames - from), sums = Array(channels).fill(0);
    for (let i = 0; i < count; i++) for (let c = 0; c < channels; c++) { const sample = decoded.stdout.readFloatLE(((from + i) * channels + c) * 4); sums[c] += sample * sample; }
    rms.push(Math.max(...sums.map(sum => Math.round(Math.sqrt(sum / count) * 32767))));
  }
  return { rms, origin: Number(stream.start_time ?? 0), step: framesPerWindow / rate, duration: frames / rate };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, snapshot, output] = process.argv.slice(2);
  if (!output) throw new Error("Usage: node roughcut.mjs <original-video> <preview-pages.json> <tightening.json>");
  if ([source, snapshot].some(input => path.resolve(input) === path.resolve(output))) throw new Error("Output must differ from input files.");
  const result = tightenEdges(timelineClips(JSON.parse(fs.readFileSync(snapshot, "utf8"))), decodeWaveform(source));
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(`Prepared ${result.clips.length} clips; trim ${result.totalTrimFrames} frames. Apply once as one ChatCut batch.`);
}
