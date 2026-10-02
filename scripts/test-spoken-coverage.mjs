import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coverageScript = path.join(repositoryRoot, "scripts", "check-spoken-coverage.mjs");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-coverage-"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const MICROSECONDS = 1_000_000;
const clip = (itemId, srcStart, srcEnd, timelineStartFrame) => ({
  itemId,
  assetId: "asset-1",
  timelineStartFrame,
  durationFrames: Math.round((srcEnd - srcStart) * 30),
  srcStartUs: Math.round(srcStart * MICROSECONDS),
  srcEndUs: Math.round(srcEnd * MICROSECONDS),
  playbackRateNumerator: 1,
  playbackRateDenominator: 1
});
const word = (id, text, start, end) => ({ id, text, start, end, confidence: null });

const run = (argumentsList, { expectSuccess = true, pattern = null } = {}) => {
  const result = spawnSync(process.execPath, [coverageScript, ...argumentsList], { encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(`unexpected failure:\n${output}`);
  if (!expectSuccess && result.status === 0) throw new Error(`unexpectedly passed:\n${output}`);
  if (pattern && !pattern.test(output)) throw new Error(`failed for the wrong reason:\n${output}`);
  return { output, result };
};

try {
  const job = path.join(temporaryRoot, "job");
  fs.mkdirSync(path.join(job, "state"), { recursive: true });
  writeJson(path.join(job, "state", "source-transcript.json"), {
    revision: 1,
    language: "zh-CN",
    duration: 10,
    source: "chatcut",
    segments: [
      { id: "s1", text: "甲乙丙丁", start: 1, end: 3, confidence: null,
        words: [word("w0", "甲", 1, 1.5), word("w1", "乙", 1.5, 2), word("w2", "丙", 2, 2.5), word("w3", "丁。", 2.5, 3)] },
      { id: "s2", text: "戊己", start: 5, end: 6, confidence: null,
        words: [word("w4", "戊", 5, 5.5), word("w5", "己。", 5.5, 6)] },
      // A retried phrase: the speaker said 庚 twice and the edit keeps only the second.
      { id: "s3", text: "庚庚辛", start: 7, end: 8.5, confidence: null,
        words: [word("w6", "庚", 7, 7.5), word("w7", "庚", 7.5, 8), word("w8", "辛。", 8, 8.5)] },
      { id: "s4", text: "壬癸", start: 9, end: 10, confidence: null,
        words: [word("w9", "壬", 9, 9.5), word("w10", "癸。", 9.5, 10)] }
    ]
  });
  const timelinePath = path.join(job, "state", "timeline-source-windows.json");
  const fullTimeline = {
    schemaVersion: 1,
    sourceSha256: "a".repeat(64),
    sourceDurationUs: 10 * MICROSECONDS,
    sourceAssetId: "asset-1",
    timelineFps: { numerator: 30, denominator: 1 },
    clips: [clip("item-1", 1, 3, 0), clip("item-2", 5, 6, 60), clip("item-3", 7.5, 8.5, 90)]
  };
  writeJson(timelinePath, fullTimeline);

  // The script looks like ChatCut's own export: a metadata comment, a heading, a
  // per-row source prefix, an inline strike and a struck-out whole row.
  const scriptPath = path.join(job, "edited-script.md");
  const script = [
    "# Timeline",
    "",
    "<!-- script-stamp: bff358d10654e6ef -->",
    "<!-- script-timeline: f3031a0e-ce22-44f0-86af-28ff92167ca1 -->",
    "",
    "### source.mp4 <!-- 0–10400f -->",
    "[s1] 甲乙丙丁",
    "[s2] 戊己",
    "[s3] ~~庚~~庚辛",
    "~~[s4] 壬癸~~"
  ].join("\n");
  fs.writeFileSync(scriptPath, script);

  // The second 庚 and the retained rows all play in full; the struck-out wording
  // and the struck-out row are consumed rather than reported as dropped.
  const passedRun = run([job, "--script", scriptPath]);
  assert.match(passedRun.output, /Spoken coverage passed: all 8 retained words/);
  const report = JSON.parse(run([job, "--script", scriptPath, "--json"]).result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.scriptRows, 4, "the struck-out row is still a script row");
  assert.equal(report.retainedWords, 8, "struck-out wording is not counted as retained");
  assert.deepEqual(report.dropped, []);
  assert.deepEqual(report.truncated, []);
  assert.deepEqual(report.unmatched, []);
  // Clip 3 starts at 7.5s, so a match that claimed the struck-out first 庚 at
  // 7.000s would surface here as a dropped word. An empty list proves the retry
  // was resolved against the row's own segment rather than by first occurrence.

  // A boundary that cuts into a retained word is reported with the words involved.
  writeJson(timelinePath, {
    ...fullTimeline,
    clips: [clip("item-1", 1, 3, 0), clip("item-2", 5, 6, 60), clip("item-3", 7.5, 8.4, 90)]
  });
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /Cut by a clip boundary \(1\)/ });
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /"辛。" 8\.000-8\.500s/ });

  // A retained word missing from the timeline entirely is dropped.
  writeJson(timelinePath, {
    ...fullTimeline,
    clips: [clip("item-1", 1, 3, 0), clip("item-2", 5, 6, 60)]
  });
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /Dropped \(2\)/ });

  // The tolerance separates a rounding artefact from a real truncation.
  writeJson(timelinePath, {
    ...fullTimeline,
    clips: [clip("item-1", 1, 3, 0), clip("item-2", 5, 6, 60), clip("item-3", 7.5, 8.495, 90)]
  });
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /Cut by a clip boundary/ });
  run([job, "--script", scriptPath, "--tolerance", "0.01"]);

  // A script that does not belong to this job fails loudly instead of returning a
  // verdict built on the wrong rows.
  writeJson(timelinePath, fullTimeline);
  fs.writeFileSync(scriptPath, "[s1] 戊己\n[s2] 甲乙丙丁");
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /does not match the locked source \(2\)/ });
  fs.writeFileSync(scriptPath, "[s99] 甲乙丙丁");
  run([job, "--script", scriptPath], { expectSuccess: false, pattern: /no source segment with that row number/ });

  // Without a row prefix the whole transcript is searched, which is the documented
  // fallback for a script that carries no row numbers.
  fs.writeFileSync(scriptPath, "甲乙丙丁\n戊己\n庚辛");
  const unprefixed = JSON.parse(run([job, "--script", scriptPath, "--json"]).result.stdout);
  assert.equal(unprefixed.passed, true);
  assert.equal(unprefixed.retainedWords, 8);

  // Argument handling: the job directory, the script and a sane tolerance are required.
  assert.notEqual(spawnSync(process.execPath, [coverageScript, job], { encoding: "utf8" }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [coverageScript, "--script", scriptPath], { encoding: "utf8" }).status, 0);
  assert.notEqual(spawnSync(process.execPath, [coverageScript, job, "--script", scriptPath, "--tolerance", "-1"], { encoding: "utf8" }).status, 0);

  console.log("Spoken coverage contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
