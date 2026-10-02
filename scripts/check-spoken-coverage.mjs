#!/usr/bin/env node
// Verify that the tightened ChatCut timeline still plays every retained word.
//
// Usage:
//   node scripts/check-spoken-coverage.mjs <job-directory> --script <edited-script.md> [--json] [--tolerance <seconds>]
//
// Step 7 of docs/talking-head-trim-standard.md: the default edge calculator keeps
// one full frame at each proposed edge but measures signal level rather than sound
// category, so a tightened boundary can still cut into a quiet word. This command
// is the check that sees it.
//
// `--script` is the script text submitted to ChatCut Script, in the shape ChatCut
// returns it: one retained row per line, each row prefixed with the source row it
// came from (`[s7] …`), an inline `~~…~~` strike for wording removed inside a row,
// and a whole row wrapped in `~~…~~` when the row itself was dropped.
//
//   [s3] ~~你刚才看到你刚才看到这~~你刚才看到这条视频中所有的东西。
//   ~~[s4] 包括文案、画面、音频、配音，~~
//
// The row prefix is what makes the match unambiguous. A phrase a speaker retried
// appears more than once in the recording, so searching the whole transcript for a
// line's wording can settle on the take that was struck out; matching inside the
// row's own source segment cannot. A struck-out fragment is still consumed, so the
// words it covers cannot be claimed by the retained wording that follows it.
//
// Coverage is decided against the immutable word timings in
// state/source-transcript.json rather than against a transcript read back from the
// timeline: a read-back already reflects the current clip boundaries, so a word a
// boundary truncated looks exactly like a whole one and the defect cannot be seen.

import fs from "node:fs";
import path from "node:path";
import { readJson } from "./workflow-utils.mjs";

const DEFAULT_TOLERANCE_SECONDS = 0.001;
const MICROSECONDS_PER_SECOND = 1_000_000;
// Punctuation, separators and whitespace carry no spoken content and differ
// between ASR output and authored script text, so both sides are compared without them.
const normalize = (value) => String(value).replace(/[\p{P}\p{Z}\s]/gu, "");

const rawArguments = process.argv.slice(2);
const valuedOptions = new Set(["--script", "--tolerance"]);
const positionalArguments = [];
const optionValues = new Map();
for (let index = 0; index < rawArguments.length; index += 1) {
  const token = rawArguments[index];
  if (valuedOptions.has(token)) {
    optionValues.set(token, rawArguments[index + 1] ?? null);
    index += 1;
    continue;
  }
  if (token.startsWith("--")) continue;
  positionalArguments.push(token);
}
const jobArgument = positionalArguments[0];
const scriptArgument = optionValues.get("--script");
const asJson = rawArguments.includes("--json");
const usage = "Usage: node scripts/check-spoken-coverage.mjs <job-directory> --script <edited-script.md> [--json] [--tolerance <seconds>]";

if (!jobArgument || !scriptArgument) {
  console.error(usage);
  process.exit(64);
}
const tolerance = Number(optionValues.get("--tolerance") ?? DEFAULT_TOLERANCE_SECONDS);
if (!Number.isFinite(tolerance) || tolerance < 0) {
  console.error(`Invalid --tolerance ${optionValues.get("--tolerance")}: expected a non-negative number of seconds.`);
  process.exit(64);
}

const jobRoot = path.resolve(jobArgument);
const sourceTranscriptPath = path.join(jobRoot, "state", "source-transcript.json");
const timelineWindowsPath = path.join(jobRoot, "state", "timeline-source-windows.json");
const editedScriptPath = path.resolve(scriptArgument);
for (const required of [sourceTranscriptPath, timelineWindowsPath, editedScriptPath]) {
  if (!fs.existsSync(required)) {
    console.error(`Error: missing ${path.relative(process.cwd(), required) || required}`);
    process.exit(1);
  }
}

const sourceTranscript = readJson(sourceTranscriptPath);
const timelineWindows = readJson(timelineWindowsPath);

// --- the words the recording contains, in source order -----------------------
const sourceWords = [];
const segmentRanges = [];
for (const segment of sourceTranscript.segments ?? []) {
  const start = sourceWords.length;
  for (const word of segment.words ?? []) {
    if (!Number.isFinite(Number(word.start)) || !Number.isFinite(Number(word.end))) continue;
    sourceWords.push({ id: word.id ?? null, text: word.text ?? "", start: Number(word.start), end: Number(word.end) });
  }
  segmentRanges.push({ start, end: sourceWords.length });
}

// --- the wording the edit kept ----------------------------------------------
// HTML comments carry export metadata rather than speech, and heading lines are
// structural, so both are removed before a line is read as script text.
const scriptText = fs.readFileSync(editedScriptPath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
const rows = [];
for (const rawLine of scriptText.split("\n")) {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  let wholeRowStruck = false;
  const outer = /^~~([\s\S]+)~~$/.exec(line);
  if (outer) {
    line = outer[1];
    wholeRowStruck = true;
  }
  const rowMatch = /^\[s(\d+)\]\s*([\s\S]*)$/.exec(line);
  const bodyText = (rowMatch ? rowMatch[2] : line).trim();
  const tokens = [];
  const tokenPattern = /~~([^~]*)~~|([^~]+)/g;
  let tokenMatch;
  while ((tokenMatch = tokenPattern.exec(bodyText)) !== null) {
    tokens.push(tokenMatch[1] === undefined
      ? { text: tokenMatch[2], removed: false }
      : { text: tokenMatch[1], removed: true });
  }
  if (wholeRowStruck) for (const token of tokens) token.removed = true;
  if (tokens.length) rows.push({ rowNumber: rowMatch ? Number(rowMatch[1]) : null, tokens });
}

// Match one row's token as a contiguous run of source words, searching only the
// segment the row names. A token that cannot be placed is reported instead of
// being silently ignored, so a script that does not belong to this job fails
// loudly rather than producing a meaningless verdict.
const matchToken = (text, from, limit) => {
  for (let start = from; start < limit; start += 1) {
    if (!normalize(sourceWords[start].text)) continue;
    let accumulated = "";
    for (let index = start; index < limit; index += 1) {
      const piece = normalize(sourceWords[index].text);
      if (!piece) continue;
      accumulated += piece;
      if (accumulated === text) return { start, end: index + 1 };
      if (!text.startsWith(accumulated)) break;
    }
  }
  return null;
};

let cursor = 0;
const retained = [];
const unmatched = [];
for (const row of rows) {
  const range = row.rowNumber !== null ? segmentRanges[row.rowNumber - 1] : { start: 0, end: sourceWords.length };
  if (!range) {
    unmatched.push({ row: row.rowNumber, text: row.tokens.map((token) => token.text).join(" "), reason: "no source segment with that row number" });
    continue;
  }
  let local = Math.max(cursor, range.start);
  for (const token of row.tokens) {
    const text = normalize(token.text);
    if (!text) continue;
    const found = matchToken(text, local, range.end);
    if (!found) {
      unmatched.push({ row: row.rowNumber, text: token.text, reason: "not present in the row's source segment" });
      continue;
    }
    if (!token.removed) {
      for (let index = found.start; index < found.end; index += 1) {
        if (normalize(sourceWords[index].text)) retained.push(sourceWords[index]);
      }
    }
    local = found.end;
    cursor = Math.max(cursor, found.end);
  }
}

// --- what the locked timeline plays ------------------------------------------
const spans = (timelineWindows.clips ?? []).map((clip) => ({
  itemId: clip.itemId,
  start: Number(clip.srcStartUs) / MICROSECONDS_PER_SECOND,
  end: Number(clip.srcEndUs) / MICROSECONDS_PER_SECOND
}));

const dropped = [];
const truncated = [];
for (const word of retained) {
  const length = word.end - word.start;
  let best = null;
  for (const span of spans) {
    const overlap = Math.min(span.end, word.end) - Math.max(span.start, word.start);
    if (!best || overlap > best.overlap) best = { span, overlap };
  }
  const overlap = Math.max(0, best?.overlap ?? 0);
  if (overlap <= 0) dropped.push({ ...word, itemId: best?.span?.itemId ?? null });
  else if (overlap < length - tolerance) {
    truncated.push({ ...word, itemId: best.span.itemId, coveredSeconds: overlap, lengthSeconds: length });
  }
}

const report = {
  job: path.relative(process.cwd(), jobRoot) || ".",
  editedScript: path.relative(process.cwd(), editedScriptPath),
  timelineItems: spans.length,
  sourceWords: sourceWords.length,
  scriptRows: rows.length,
  retainedWords: retained.length,
  unmatched,
  dropped,
  truncated,
  passed: unmatched.length === 0 && dropped.length === 0 && truncated.length === 0
};

const describe = (word) => `"${word.text}" ${word.start.toFixed(3)}-${word.end.toFixed(3)}s`;

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`Job: ${report.job}`);
  console.log(`Edited script: ${report.editedScript} (${report.scriptRows} script rows, ${report.retainedWords} retained words)`);
  console.log(`Locked source: ${report.sourceWords} words; timeline: ${report.timelineItems} items`);
  if (unmatched.length) {
    console.log(`\nScript wording that does not match the locked source (${unmatched.length}):`);
    for (const entry of unmatched) console.log(`  [s${entry.row ?? "?"}] "${entry.text}" — ${entry.reason}`);
  }
  if (dropped.length) {
    console.log(`\nDropped (${dropped.length}) — retained wording absent from the timeline:`);
    for (const word of dropped) console.log(`  ${describe(word)}`);
  }
  if (truncated.length) {
    console.log(`\nCut by a clip boundary (${truncated.length}):`);
    for (const word of truncated) {
      console.log(`  ${describe(word)}  only ${(word.coveredSeconds * 1000).toFixed(0)}ms of ${(word.lengthSeconds * 1000).toFixed(0)}ms is inside item ${String(word.itemId).slice(0, 8)}`);
    }
  }
}

if (!report.passed) {
  console.error(`\nSpoken coverage failed: ${unmatched.length} unmatched, ${dropped.length} dropped, ${truncated.length} cut by a boundary.`);
  console.error("Restore the affected edge outward by the frames the word needs, recompute the plan with --force, and re-run this check.");
  process.exit(1);
}
if (!asJson) console.log(`Spoken coverage passed: all ${report.retainedWords} retained words play in full on the locked timeline.`);
