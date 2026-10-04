#!/usr/bin/env node
// Convert saved ChatCut responses; never edit ChatCut or ask the Agent to copy fields.
// `transcript` is a legacy source-word import for explicit FFmpeg fallback or existing source-word jobs; standard ChatCut plans use the approved main-timeline preview.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeSeamTighteningPlan } from "./compute-seam-tightening.mjs";
import { assertRegularContainedFile, readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [job, command, ...files] = process.argv.slice(2);
if (!job || !["tighten", "windows", "transcript"].includes(command) || !files.length) {
  console.error("Usage: node scripts/prepare-rough-cut.mjs <job> tighten|windows <saved-preview-pages.json>...\n       node scripts/prepare-rough-cut.mjs <job> transcript <saved-inspect-asset-pages.json>...\nwindows refreshes source placement without audio analysis or another tightening pass. The transcript command imports legacy source-word timing for explicit FFmpeg fallback or existing source-word jobs; standard ChatCut plans use the approved main-timeline preview.");
  process.exit(64);
}
const root = path.resolve(job);
const state = (name) => path.join(root, "state", name);
const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = readJson(state("project.json"));
const source = path.resolve(root, project.sourceVideo);
assertRegularContainedFile(path.join(root, "input"), source, "Source media");
const unwrap = (value) => Array.isArray(value) ? value.flatMap(unwrap) : [value.structuredContent ?? value];
const pages = files.flatMap((file) => unwrap(readJson(path.resolve(file))));
const run = (name, args) => {
  const result = spawnSync(process.execPath, [path.join(scripts, name), ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `${name} failed`);
};

if (command === "transcript") {
  const workflow = readJson(state("workflow.json"));
  if (workflow.sourceTranscriptSha256) {
    if (sha256File(state("source-transcript.json")) !== workflow.sourceTranscriptSha256) throw new Error("Locked source transcript changed");
    console.log("Reusing locked source transcript.");
    process.exit(0);
  }
  if (!["rough-cut-export", "motion-plan", "transcription", "rough-cut"].includes(workflow.currentState)) throw new Error("Import source words after the rough-cut decision");
  const assetIds = new Set(pages.map((p) => p.asset?.id));
  if (assetIds.size !== 1 || !pages[0]?.asset?.id) throw new Error("Transcript pages must identify one source asset");
  const durationMs = pages[0].asset.durationMs;
  const ranges = pages.flatMap((p) => p.transcript?.ranges ?? []);
  let covered = 0;
  for (const { range } of [...ranges].sort((a, b) => a.range.startMs - b.range.startMs)) {
    if (!Number.isFinite(range?.startMs) || !Number.isFinite(range?.endMs) || range.startMs > covered || range.endMs <= range.startMs) throw new Error("Source transcript pages have missing/invalid ranges");
    covered = Math.max(covered, range.endMs);
  }
  if (!(durationMs > 0) || covered < durationMs) throw new Error("Fetch the remaining source transcript pages before planning");
  const unique = new Map();
  for (const word of ranges.flatMap((r) => r.segments ?? [])) {
    if (/^\[\d+(?:\.\d+)? seconds? silent\]$/i.test(word.text?.trim() ?? "")) continue;
    if (typeof word.text !== "string" || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)
      || word.startMs < 0 || word.endMs <= word.startMs || word.endMs > durationMs) throw new Error("Invalid source word timing");
    unique.set(JSON.stringify([word.startMs, word.endMs, word.text]), word);
  }
  const words = [...unique.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((w, i) => ({ id: `source.w${i}`, text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 }));
  if (!words.length) throw new Error("No source words returned");
  const transcript = { revision: 1, language: project.language ?? "zh-CN", source: "chatcut", duration: durationMs / 1000,
    segments: [{ id: "source", text: words.map((w) => w.text).join(""), start: words[0].start, end: words.at(-1).end, words }] };
  // Preserve authored transcriptions; import only once or explicitly remove an obsolete draft.
  if (fs.existsSync(state("transcript.json"))) throw new Error("transcript.json already exists; use workflow-state lock-transcript to preserve it");
  if (fs.existsSync(state("source-transcript.json"))) throw new Error("Unbound source transcript exists; preserve it before importing");
  writeJsonAtomic(state("transcript.json"), transcript);
  run("workflow-state.mjs", [state("workflow.json"), "lock-transcript"]);
  console.log(`Imported ${words.length} source words for planning.`);
} else {
  const first = pages[0];
  const fps = first?.state?.fps;
  if (!Number.isFinite(fps) || fps <= 0 || (command === "tighten" && !Number.isSafeInteger(fps))) throw new Error("Tightening requires an integer timeline fps; source windows require a positive timeline fps");
  const total = first?.timeline?.totalEntries;
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("Save the structured preview_timeline response, including totalEntries");
  const entries = new Map();
  for (const p of pages) {
    if (p.state?.id !== first.state.id || p.state.fps !== fps || p.state.durationFrames !== first.state.durationFrames || p.timeline?.totalEntries !== total) throw new Error("Timeline pages describe different snapshots");
    for (const e of p.timeline.entries) {
      if (entries.has(e.id) && JSON.stringify(entries.get(e.id)) !== JSON.stringify(e)) throw new Error("Conflicting timeline pages");
      entries.set(e.id, e);
    }
  }
  if (entries.size !== total) throw new Error(`Missing timeline pages: received ${entries.size}/${total} entries`);
  const clips = [...entries.values()].sort((a, b) => a.timelineRange?.fromFrame - b.timelineRange?.fromFrame);
  if (new Set(clips.map((e) => e.asset?.id)).size !== 1 || new Set(clips.map((e) => e.trackId)).size !== 1) throw new Error("Use one source video track for this adapter");
  const indexPath = state("source-audio-waveform-index.json");
  const sourceHash = sha256File(source);
  let index = fs.existsSync(indexPath) ? readJson(indexPath) : null;
  if (command === "tighten" && (index?.schemaVersion !== 4 || index?.source?.sha256 !== sourceHash)) {
    run("index-source-silence.mjs", [source, "--output", indexPath]);
    index = readJson(indexPath);
  }
  let sourceDurationUs = index?.source?.sha256 === sourceHash ? index.source.durationUs : null;
  if (command === "windows" && !(sourceDurationUs > 0)) {
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source], { encoding: "utf8" });
    sourceDurationUs = Math.round(Number(probe.stdout?.trim()) * 1e6);
    if (probe.error || probe.status !== 0 || !(sourceDurationUs > 0)) throw new Error("Cannot read source duration for the approved timeline mapping");
  }
  const manifest = { schemaVersion: 1, sourceSha256: sourceHash, sourceDurationUs,
    sourceAssetId: clips[0].asset.id, timelineFps: { numerator: fps, denominator: 1 },
    clips: clips.map((e) => {
      if (e.itemType !== "video" || !e.id || !e.asset?.id) throw new Error("Unsupported timeline entry");
      const rate = e.playbackRate ?? 1;
      if (command === "tighten" && rate !== 1) throw new Error("Retimed footage needs an explicit source mapping");
      const start = e.timelineRange?.fromFrame;
      const duration = e.timelineRange?.toFrame - start;
      if (command === "windows" && (!Number.isFinite(rate) || rate <= 0
        || !Number.isSafeInteger(start) || !Number.isSafeInteger(duration) || start < 0 || duration <= 0
        || !Number.isSafeInteger(e.sourceRange?.start) || !Number.isSafeInteger(e.sourceRange?.end)
        || e.sourceRange.start < 0 || e.sourceRange.end <= e.sourceRange.start
        || e.sourceRange.end > sourceDurationUs
        || Math.abs((e.sourceRange.end - e.sourceRange.start) / 1e6 / rate * fps - duration) > 1 + 1e-6)) throw new Error("Source span, playback rate and timeline duration must describe the same clip");
      // Tightening keeps its linear 1x mapping; windows also accepts an explicit playback rate.
      return { itemId: e.id, assetId: e.asset.id, timelineStartFrame: start, durationFrames: duration,
        srcStartUs: e.sourceRange?.start, srcEndUs: e.sourceRange?.end,
        playbackRateNumerator: rate === 1 ? 1 : Math.round(rate * 1e6), playbackRateDenominator: rate === 1 ? 1 : 1e6 };
    }) };
  if (manifest.clips[0].timelineStartFrame !== 0 || manifest.clips.at(-1).timelineStartFrame + manifest.clips.at(-1).durationFrames !== first.state.durationFrames) throw new Error("Timeline coverage differs from the snapshot duration");
  if (command === "windows") {
    project.fps = fps;
    writeJsonAtomic(state("project.json"), project);
    writeJsonAtomic(state("timeline-source-windows.json"), manifest);
    console.log(`Refreshed ${manifest.clips.length} source windows from the approved timeline; no audio scan or tightening plan generated.`);
    process.exit(0);
  }
  const plan = computeSeamTighteningPlan(index, manifest);
  project.fps = fps;
  writeJsonAtomic(state("project.json"), project);
  writeJsonAtomic(state("timeline-source-windows.json"), manifest);
  writeJsonAtomic(state("seam-tightening-plan.json"), plan);
  const updated = { ...manifest, clips: manifest.clips.map((c, i) => {
    const p = plan.clips[i];
    return { ...c, timelineStartFrame: p.timelineStartFrameAfterShift, durationFrames: p.durationFramesAfterTrim,
        srcStartUs: p.sourceStartUsAfterTrim, srcEndUs: p.sourceEndUsAfterTrim };
  }) };
  writeJsonAtomic(state("timeline-source-windows.proposed.json"), updated);
  console.log(`Prepared ${plan.clipCount} clips; trim ${plan.proposedTotalTrimFrames} frames. Apply seam-tightening-plan.json once, then adopt timeline-source-windows.proposed.json only after ChatCut confirms all edits. No ASR overlap audit is needed.`);
}
