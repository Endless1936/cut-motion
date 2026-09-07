import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReferenceScript } from "./reference-script-annotations.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-planning-"));
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList], {
    encoding: "utf8"
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${name} unexpectedly passed`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`${name} failed for the wrong reason:\n${output}`);
  return result;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

try {
  const parsed = parseReferenceScript("第一句[保留]【MG：关键词】；第二句【从前面的分号到此使用B轴】");
  assert.equal(parsed.speechText, "第一句[保留]；第二句");
  assert.equal(parsed.annotations[0].scopeMode, "preceding-clause");
  assert.equal(parsed.annotations[1].scopeMode, "explicit-range");
  assert.equal(parseReferenceScript("这是第一句。\n【MG：关键词】").annotations[0].defaultScope.text, "这是第一句");
  for (const malformed of ["【MG】正文", "正文【】", "正文【外层【内层】】", "正文【未闭合", "正文】"]) {
    assert.throws(() => parseReferenceScript(malformed));
  }

  const transcript = path.join(repositoryRoot, "examples", "transcript.example.json");
  const design = path.join(repositoryRoot, "assets", "design-system.default.json");
  const validMotion = path.join(repositoryRoot, "examples", "beat-map.example.json");
  const validSubtitles = path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json");
  script("check-visual-plan.mjs", [validMotion, transcript, design]);
  script("check-visual-plan.mjs", [validSubtitles, transcript, design]);

  const faceCoverage = readJson(validSubtitles);
  faceCoverage.beats = [faceCoverage.beats[0]];
  Object.assign(faceCoverage.beats[0], { axis: "A", end: 3.2, sourceSegmentIds: ["seg-001", "seg-002"], exitAnchorWordId: "seg-002:word-003", staticHoldReason: "Read the source evidence" });
  const facePath = path.join(temporaryRoot, "face-coverage.json");
  writeJson(facePath, faceCoverage);
  script("check-visual-plan.mjs", [facePath, transcript, design], false, /without recorded user approval/);
  faceCoverage.beats[0].layout.faceCoverApproval = "user";
  writeJson(facePath, faceCoverage);
  script("check-visual-plan.mjs", [facePath, transcript, design], false, /without recorded user approval/);
  faceCoverage.beats[0].layout.faceSafetyNote = "User explicitly permits covering eyes and nose to keep evidence legible";
  writeJson(facePath, faceCoverage);
  script("check-visual-plan.mjs", [facePath, transcript, design]);

  const mutationCases = [
    {
      name: "duplicate-caption-copy",
      source: validSubtitles,
      mutate: (map) => { map.beats[0].text = "看看这些特效"; },
      error: /duplicating caption copy/
    },
    {
      name: "global-subtitle-mg",
      source: validSubtitles,
      mutate: (map) => { map.beats[0].mgScope = "global"; },
      error: /mgScope/
    },
    {
      name: "missing-cognition-gap",
      source: validSubtitles,
      mutate: (map) => { delete map.beats[0].viewerQuestion; },
      error: /viewerQuestion/
    },
    {
      name: "missing-copy",
      source: validSubtitles,
      mutate: (map) => { delete map.beats[0].onScreenCopy; },
      error: /onScreenCopy/
    },
    {
      name: "late-entry",
      source: validMotion,
      mutate: (map) => { map.beats[0].microEvents[0].time = 0.8; },
      error: /first meaningful event/
    },
    {
      name: "bad-topology",
      source: validMotion,
      mutate: (map) => { map.beats[0].semanticTopology = "convergence"; },
      error: /convergence/
    }
  ];
  for (const testCase of mutationCases) {
    const fixture = readJson(testCase.source);
    testCase.mutate(fixture);
    const target = path.join(temporaryRoot, `${testCase.name}.json`);
    writeJson(target, fixture);
    script("check-visual-plan.mjs", [target, transcript, design], false, testCase.error);
  }

  const captionOnly = readJson(validSubtitles);
  for (const beat of captionOnly.beats) {
    Object.assign(beat, { mgScope: "none", recipe: "caption-only", axis: "A", components: [], microEvents: [] });
    beat.text = beat.sourceSegmentIds.map((id) => readJson(transcript).segments.find((segment) => segment.id === id).text).join("");
  }
  const captionOnlyPath = path.join(temporaryRoot, "caption-only.json");
  writeJson(captionOnlyPath, captionOnly);
  script("check-visual-plan.mjs", [captionOnlyPath, transcript, design]);
  const reviewTimes = script("review-times.mjs", [captionOnlyPath]).stdout.trim().split(",");
  assert.equal(reviewTimes.length, 3);

  const job = path.join(temporaryRoot, "caption-job");
  fs.mkdirSync(path.join(job, "captions"), { recursive: true });
  fs.mkdirSync(path.join(job, "state"), { recursive: true });
  const captions = path.join(job, "captions", "captions.json");
  const pages = path.join(job, "captions", "chatcut-pages.json");
  const reviewPlan = path.join(job, "captions", "caption-review-plan.json");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "captions.approved-semantic.example.json"), captions);
  fs.copyFileSync(path.join(repositoryRoot, "examples", "chatcut-caption-pages.example.json"), pages);
  fs.copyFileSync(transcript, path.join(job, "state", "transcript.json"));
  const approvedPlan = readJson(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"));
  approvedPlan.status = "approved";
  writeJson(reviewPlan, approvedPlan);
  script("check-captions.mjs", [captions, pages, design]);

  const composition = path.join(job, "caption-fixture.html");
  fs.writeFileSync(
    composition,
    "<!doctype html><html><body><!-- CUT_MOTION_CAPTIONS_START --><!-- CUT_MOTION_CAPTIONS_END --></body></html>\n"
  );
  script("install-captions.mjs", [captions, composition, design]);
  script("install-captions.mjs", [captions, composition, design]);
  script("check-captions.mjs", [captions, pages, design, composition]);

  const installed = fs.readFileSync(composition, "utf8");
  const overlapCaptions = readJson(captions);
  overlapCaptions.cues[1].startFrame = overlapCaptions.cues[0].endFrame - 1;
  const overlapPath = path.join(job, "captions", "overlap.json");
  writeJson(overlapPath, overlapCaptions);
  script("install-captions.mjs", [overlapPath, composition, design], false, /overlaps/);
  assert.equal(fs.readFileSync(composition, "utf8"), installed, "invalid caption installation must not replace the current composition");

  const boldCaptions = readJson(captions);
  boldCaptions.style.fontWeight = 700;
  const boldPath = path.join(job, "captions", "bold.json");
  writeJson(boldPath, boldCaptions);
  script("check-captions.mjs", [boldPath, pages, design], false, /normal weight 400/);

  const legacyCaptions = readJson(captions);
  legacyCaptions.source.kind = "chatcut-viewer-pages";
  const legacyPath = path.join(job, "captions", "legacy.json");
  writeJson(legacyPath, legacyCaptions);
  script("check-captions.mjs", [legacyPath, pages, design], false, /approved semantic plan/);

  console.log("Planning contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
