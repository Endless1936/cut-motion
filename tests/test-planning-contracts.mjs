import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReferenceScript, buildReferenceScriptAnnotations } from "../scripts/reference-script-annotations.mjs";
import { buildBeatMap, buildReleasedTranscript, buildMainTimelineTranscript, buildCaptionPlan, buildReconciliationItems, buildSourceWordEvidence } from "../scripts/plan-artifacts.mjs";
import { resolveComponent } from "../scripts/motion-template-library.mjs";
import { sha256File } from "../scripts/workflow-utils.mjs";

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
  const adjacentSnapshot = {
    state: { id: "adjacent", fps: 30, durationFrames: 90 },
    transcript: { coverage: { status: "complete" }, entries: [
      { itemId: "a", text: "第一句", timelineRange: { fromFrame: 0, toFrame: 45 } },
      { itemId: "b", text: "第二句", timelineRange: { fromFrame: 44, toFrame: 90 } }
    ] }
  };
  const adjacent = buildMainTimelineTranscript({ snapshot: adjacentSnapshot, fps: 30 });
  assert.equal(adjacent.segments[1].start, adjacent.segments[0].end);
  assert.equal(adjacentSnapshot.transcript.entries[1].timelineRange.fromFrame, 44);
  adjacentSnapshot.transcript.entries[1].timelineRange.fromFrame = 43;
  assert.throws(() => buildMainTimelineTranscript({ snapshot: adjacentSnapshot, fps: 30 }), /more than one boundary frame/);
  const source = { segments: [{ id: "split", words: [{ text: "你好", start: 0, end: 1 }] }, { id: "later", words: [{ text: "再见", start: 2, end: 3 }] }] };
  const clip = (start, end, at) => ({ srcStartUs: start * 1e6, srcEndUs: end * 1e6, timelineStartFrame: at * 30, durationFrames: (end - start) * 30 });
  const splitWindows = { clips: [clip(0, 0.4, 0), clip(0.6, 1, 0.4)] };
  const split = buildReleasedTranscript({ sourceTranscript: source, timelineWindows: splitWindows, fps: 30 });
  assert.equal(split.segments.map((segment) => segment.text).join(""), "你好");
  assert.deepEqual(split.segments[0].words.map(({ text, start, end }) => ({ text, start, end })), [{ text: "你好", start: 0, end: 0.8 }]);
  assert.equal(buildCaptionPlan({ transcript: split }).cues[0].text, "你好");
  const namedText = "使用 book-video 和 GPT Image 2。";
  const namedTranscript = { revision: 1, segments: [{ id: "names", text: namedText,
    start: 0, end: 2, words: [{ text: namedText, start: 0, end: 2 }] }] };
  const namedLexicon = { protectedTerms: ["book-video", "GPT", "GPT Image 2"] };
  assert.equal(buildCaptionPlan({ transcript: namedTranscript, lexicon: namedLexicon }).cues[0].text,
    "使用book-video和GPT Image 2");
  assert.equal(buildCaptionPlan({ transcript: namedTranscript, lexicon: namedLexicon,
    captionCues: [{ segmentId: "names", text: namedText, start: 0, end: 2 }] }).cues[0].text,
    "使用book-video和GPT Image 2");
  assert.deepEqual(buildCaptionPlan({ transcript: namedTranscript, lexicon: namedLexicon,
    captionEdits: { names: ["使用book-video", "和GPT Image 2"] } }).cues.map(cue => cue.text),
    ["使用book-video", "和GPT Image 2"], "semantic phrase input preserves punctuation and spaces inside protected product names");
  const splitEvidence = buildSourceWordEvidence({ sourceTranscript: source, timelineWindows: splitWindows, releasedTranscript: split, fps: 30 });
  assert.deepEqual(splitEvidence.entries, [{ sourceStartMs: 0, sourceEndMs: 1000, timelineStartFrame: 0, timelineEndFrame: 24 }]);
  const fragmentedWindows = { clips: [clip(0, 0.2, 0), clip(0.4, 0.6, 0.2), clip(0.8, 1, 0.4)] };
  const fragmented = buildReleasedTranscript({ sourceTranscript: source, timelineWindows: fragmentedWindows, fps: 30 });
  assert.deepEqual(fragmented.segments[0].words.map(({ text, start, end }) => ({ text, start, end })), [{ text: "你好", start: 0, end: 0.6 }]);
  const rewound = buildReleasedTranscript({ sourceTranscript: source, timelineWindows: { clips: [clip(0.6, 1, 0), clip(0, 0.4, 0.4)] }, fps: 30 });
  assert.deepEqual(rewound.segments.map((segment) => segment.text), ["你好", "你好"]);
  const shortSource = { segments: [{ id: "short", words: [{ text: "好", start: 0, end: 1 / 30 }] }] };
  const repeatedShort = buildReleasedTranscript({ sourceTranscript: shortSource, timelineWindows: { clips: [clip(0, 1 / 30, 0), clip(0, 1 / 30, 1 / 30)] }, fps: 30 });
  assert.deepEqual(repeatedShort.segments.map((segment) => segment.text), ["好", "好"], "replaying a short source word is a separate occurrence");
  const spokenRepeatSource = { segments: [{ id: "spoken-repeat", words: [{ text: "你好", start: 0, end: 0.4 }, { text: "你好", start: 0.6, end: 1 }] }] };
  const spokenRepeat = buildReleasedTranscript({ sourceTranscript: spokenRepeatSource, timelineWindows: splitWindows, fps: 30 });
  assert.equal(spokenRepeat.segments.map((segment) => segment.text).join(""), "你好你好", "different source words preserve spoken repetition");
  const reorderedWindows = { clips: [clip(2, 3, 0), clip(0, 1, 1), clip(0, 1, 2)] };
  const reordered = buildReleasedTranscript({ sourceTranscript: source, timelineWindows: reorderedWindows, fps: 30 });
  assert.deepEqual(reordered.segments.map((segment) => segment.text), ["再见", "你好", "你好"]);
  assert.equal(new Set(reordered.segments.map((segment) => segment.id)).size, 3);
  assert.equal(buildSourceWordEvidence({ sourceTranscript: source, timelineWindows: reorderedWindows, releasedTranscript: reordered, fps: 30 }).rows.length, 3);
  const subframeSource = { segments: [{ id: "fast", words: [{ text: "一", start: 0, end: 0.01 }, { text: "二", start: 0.01, end: 0.1 }] }] };
  const subframeWindows = { clips: [clip(0, 0.1, 0)] };
  const subframeTranscript = buildReleasedTranscript({ sourceTranscript: subframeSource, timelineWindows: subframeWindows, fps: 30 });
  const subframeEvidence = buildSourceWordEvidence({ sourceTranscript: subframeSource, timelineWindows: subframeWindows, releasedTranscript: subframeTranscript, fps: 30 });
  assert.equal(subframeEvidence.entries.length, 2);
  assert.deepEqual(subframeEvidence.entries.map(({ timelineStartFrame, timelineEndFrame }) => [timelineStartFrame, timelineEndFrame]), [[0, 1], [0, 1]]);
  const lines = reordered.segments.map((segment) => ({ segmentId: segment.id, fromWord: 1, toWord: 1, fitFontSizePx: 92 }));
  assert.equal(buildCaptionPlan({ transcript: reordered, cueLines: lines, lexicon: {} }).cues[0].fitFontSizePx, 92);
  const defaultCaptionPlan = buildCaptionPlan({ transcript: reordered, lexicon: {} });
  assert.equal(defaultCaptionPlan.segmentationAuthority, "ChatCut source segment boundaries");
  assert.deepEqual(defaultCaptionPlan.cues.map((cue) => cue.text), ["再见", "你好", "你好"]);
  assert.throws(() => buildCaptionPlan({ transcript: reordered, cueLines: [lines[0], lines[0], lines[2]], lexicon: {} }), /exactly once/);
  const phraseTranscript = {
    revision: 2,
    segments: [
      { id: "main-001", text: "今天我要演示", start: 0.5, end: 2.4, words: [{ text: "今天我要演示", start: 0.5, end: 2.4 }] },
      { id: "main-002", text: "这个新工具很好用", start: 3, end: 5.4, words: [{ text: "这个新工具很好用", start: 3, end: 5.4 }] }
    ]
  };
  const phraseCues = [
    { segmentId: "main-001", text: "今天我要", start: 0.5, end: 1.3 },
    { segmentId: "main-001", text: "演示", start: 1.3, end: 2.4 },
    { segmentId: "main-002", text: "这个新工具", start: 3, end: 4.2 },
    { segmentId: "main-002", text: "很好用", start: 4.2, end: 5.4 }
  ];
  const phrasePlan = buildCaptionPlan({ transcript: phraseTranscript, captionCues: phraseCues, lexicon: {} });
  assert.equal(phrasePlan.segmentationAuthority, "agent-authored phrase cues within ChatCut main timeline entries");
  assert.deepEqual(phrasePlan.cues.map(({ text, segmentId, start, end }) => ({ text, segmentId, start, end })), phraseCues);
  assert.throws(() => buildCaptionPlan({ transcript: phraseTranscript, captionCues: [
    { ...phraseCues[0], end: 2.5 }, ...phraseCues.slice(1)
  ], lexicon: {} }), /stay within main-001/);
  assert.throws(() => buildCaptionPlan({ transcript: phraseTranscript, captionCues: [
    { ...phraseCues[0], text: "今天" }, ...phraseCues.slice(1)
  ], lexicon: {} }), /do not preserve the full text/);
  const priorConflict = { id: "existing-conflict", segmentId: "split", type: "ambiguous", resolution: "unresolved", releaseImpact: true, heardText: "你好", evidence: { audioChecked: false, note: "ASR only" }, decision: { actor: "agent", at: "fixture", note: "unresolved" } };
  const preserved = buildReconciliationItems({ transcript: split, existingItems: [priorConflict] })[0];
  assert.equal(preserved.id, priorConflict.id);
  assert.equal(preserved.resolution, "unresolved");
  assert.equal(preserved.evidence.audioChecked, false);
  assert.equal(buildReconciliationItems({ transcript: split })[0].evidence.audioChecked, false);
  const removed = { ...priorConflict, id: "removed", segmentId: "discarded", type: "speech-only", resolution: "accepted-speech", releaseImpact: false, start: 2, end: 3 };
  assert.equal(buildReconciliationItems({ transcript: split, existingItems: [removed] }).length, 1, "removed accepted source speech is not released evidence");
  const trimmed = buildReconciliationItems({ transcript: split, existingItems: [{ ...removed, id: "r-split", segmentId: "split", heardText: "你好重录" }] });
  assert.equal(trimmed[0].heardText, "你好", "ordinary accepted speech follows retained words");
  const omittedReference = buildReconciliationItems({ transcript: split, existingItems: [{ ...removed, referenceText: "旧台词" }] }).find((item) => item.id === "removed");
  assert.equal(omittedReference.type, "script-only");
  assert.equal(omittedReference.resolution, "omitted-unspoken");
  assert.equal(omittedReference.heardText, null);
  assert.equal(buildReconciliationItems({ transcript: split, existingItems: [{ ...priorConflict, id: "removed-conflict", segmentId: "discarded" }] }).some((item) => item.id === "removed-conflict" && item.resolution === "unresolved"), true);
  const parsed = parseReferenceScript("第一句[保留]【MG：关键词】；第二句【从前面的分号到此使用B轴】");
  assert.equal(parsed.speechText, "第一句[保留]；第二句");
  assert.equal(parsed.annotations[0].scopeMode, "preceding-clause");
  assert.equal(parsed.annotations[1].scopeMode, "explicit-range");
  assert.equal(parseReferenceScript("这是第一句。\n【MG：关键词】").annotations[0].defaultScope.text, "这是第一句");
  for (const malformed of ["【MG】正文", "正文【】", "正文【外层【内层】】", "正文【未闭合", "正文】"]) {
    assert.throws(() => parseReferenceScript(malformed));
  }

  const transcript = path.join(repositoryRoot, "tests", "fixtures", "transcript.json");
  const design = path.join(repositoryRoot, "assets", "design-system.default.json");
  const validMotion = path.join(repositoryRoot, "tests", "fixtures", "beat-map.motion-copy.json");
  const validSubtitles = path.join(repositoryRoot, "tests", "fixtures", "beat-map.subtitles.json");
  script("check-visual-plan.mjs", [validMotion, transcript, design]);
  script("check-visual-plan.mjs", [validSubtitles, transcript, design]);

  const faceCoverage = readJson(validSubtitles);
  faceCoverage.beats = [faceCoverage.beats[0]];
  Object.assign(faceCoverage.beats[0], { axis: "A", end: 3.2, sourceSegmentIds: ["seg-001", "seg-002"], exitAnchorWordId: "seg-002:word-003", staticHoldReason: "Read the source evidence" });
  const facePath = path.join(temporaryRoot, "face-coverage.json");
  writeJson(facePath, faceCoverage);
  script("check-visual-plan.mjs", [facePath, transcript, design]);
  faceCoverage.beats[0].layout.faceCoverApproval = "user";
  writeJson(facePath, faceCoverage);
  script("check-visual-plan.mjs", [facePath, transcript, design]);
  faceCoverage.beats[0].layout.faceSafetyNote = "Legacy note, not required for face coverage";
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
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "captions.approved-semantic.json"), captions);
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "chatcut-caption-pages.json"), pages);
  fs.copyFileSync(transcript, path.join(job, "state", "transcript.json"));
  const approvedPlan = readJson(path.join(repositoryRoot, "tests", "fixtures", "caption-review-plan.json"));
  approvedPlan.status = "approved";
  writeJson(reviewPlan, approvedPlan);
  script("check-captions.mjs", [captions, pages, design]);

  const legacyPages = readJson(pages);
  legacyPages.cleanExport = true;
  legacyPages.pages = legacyPages.pages.map((page) => ({
    id: page.id,
    start: page.startFrame / legacyPages.fps,
    end: page.endFrame / legacyPages.fps,
    text: page.viewerText
  }));
  const currentCaptions = readJson(captions);
  writeJson(pages, legacyPages);
  writeJson(captions, { ...currentCaptions, source: { ...currentCaptions.source, cleanExport: true } });
  script("check-captions.mjs", [captions, pages, design]);
  const relaxedPlan = structuredClone(approvedPlan);
  const relaxedCaptions = readJson(captions);
  const baselineDesignText = fs.readFileSync(design, "utf8");
  const baselineDesign = JSON.parse(baselineDesignText);
  const relaxedDesign = structuredClone(baselineDesign);
  relaxedPlan.rules.minimumDurationSeconds = 99;
  relaxedPlan.rules.targetDurationSeconds = [99, 100];
  relaxedPlan.rules.targetDisplayUnits = [99, 100];
  relaxedPlan.rules.maximumDisplayUnits = 0.1;
  relaxedPlan.cues[0].text += "，";
  relaxedCaptions.cues[0].lines[0] += "，";
  relaxedCaptions.style.maximumDisplayUnits = 0.1;
  relaxedDesign.captions.maximumDisplayUnits = 0.1;
  writeJson(reviewPlan, relaxedPlan);
  writeJson(captions, relaxedCaptions);
  writeJson(design, relaxedDesign);
  script("check-captions.mjs", [captions, pages, design]);
  writeJson(reviewPlan, approvedPlan);
  fs.writeFileSync(design, baselineDesignText);
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "captions.approved-semantic.json"), captions);
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "chatcut-caption-pages.json"), pages);
  const cardPages = readJson(pages);
  cardPages.cleanExport = true;
  cardPages.cards = cardPages.pages.map((page) => ({
    id: page.id,
    startFrame: page.startFrame,
    endFrame: page.endFrame,
    text: page.viewerText,
    wordCount: page.viewerText.length
  }));
  delete cardPages.pages;
  writeJson(pages, cardPages);
  writeJson(captions, { ...currentCaptions, source: { ...currentCaptions.source, cleanExport: true } });
  script("check-captions.mjs", [captions, pages, design]);
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "captions.approved-semantic.json"), captions);
  fs.copyFileSync(path.join(repositoryRoot, "tests", "fixtures", "chatcut-caption-pages.json"), pages);

  const sourcePages = readJson(pages);
  sourcePages.source = "ChatCut inspect_asset original source word rows";
  delete sourcePages.pages;
  sourcePages.rows = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1000, endMs: 4000 }
  ];
  sourcePages.timelineMapping = "state/source-timeline-mapping.json";
  const mappingPath = path.join(job, "state", "source-timeline-mapping.json");
  writeJson(mappingPath, {
    schemaVersion: "1.0.0",
    fps: sourcePages.fps,
    entries: [
      { sourceStartMs: 0, sourceEndMs: 1000, timelineStartFrame: 0, timelineEndFrame: 30 },
      { sourceStartMs: 1000, sourceEndMs: 4000, timelineStartFrame: 30, timelineEndFrame: 120 }
    ]
  });
  sourcePages.timelineMappingSha256 = sha256File(mappingPath);
  const sourcePagesPath = path.join(job, "captions", "source-word-pages.json");
  writeJson(sourcePagesPath, sourcePages);
  script("check-captions.mjs", [captions, sourcePagesPath, design]);
  const validMapping = readJson(mappingPath);
  writeJson(mappingPath, { ...validMapping, entries: validMapping.entries.slice(0, 1) });
  sourcePages.timelineMappingSha256 = sha256File(mappingPath);
  writeJson(sourcePagesPath, sourcePages);
  script("check-captions.mjs", [captions, sourcePagesPath, design], false, /one entry per source word row/);
  writeJson(mappingPath, validMapping);
  sourcePages.timelineMappingSha256 = sha256File(mappingPath).toUpperCase();
  writeJson(sourcePagesPath, sourcePages);
  script("check-captions.mjs", [captions, sourcePagesPath, design]);
  fs.writeFileSync(mappingPath, "null\n");
  sourcePages.timelineMappingSha256 = sha256File(mappingPath);
  writeJson(sourcePagesPath, sourcePages);
  script("check-captions.mjs", [captions, sourcePagesPath, design], false, /must be a JSON object/);
  writeJson(mappingPath, validMapping);
  sourcePages.timelineMappingSha256 = sha256File(mappingPath);
  writeJson(sourcePagesPath, sourcePages);
  const escapedMappingPages = { ...sourcePages, timelineMapping: "../outside.json" };
  writeJson(sourcePagesPath, escapedMappingPages);
  script("check-captions.mjs", [captions, sourcePagesPath, design], false, /inside the job/);
  const approvedCaptions = readJson(captions);
  writeJson(captions, { ...approvedCaptions, source: { ...approvedCaptions.source, reviewPlan: "../outside.json" } });
  script("check-captions.mjs", [captions, pages, design], false, /review plan inside the job/);
  writeJson(captions, approvedCaptions);

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

  const planJob = path.join(temporaryRoot, "generate-plan-job");
  fs.mkdirSync(path.join(planJob, "state"), { recursive: true });
  fs.mkdirSync(path.join(planJob, "roughcut"), { recursive: true });
  fs.mkdirSync(path.join(planJob, "input"), { recursive: true });
  fs.copyFileSync(design, path.join(planJob, "state", "design-system.json"));
  fs.writeFileSync(path.join(planJob, "input", "source.mp4"), "source-media-fixture");
  fs.writeFileSync(path.join(planJob, "roughcut", "a-roll.mp4"), "not-a-real-file");
  writeJson(path.join(planJob, "state", "source-transcript.json"), {
    revision: 1,
    language: "zh-CN",
    duration: 6,
    source: "chatcut",
    segments: [
      { id: "s1", text: "今天我要演示", start: 0.5, end: 2.4, confidence: null, words: [
        { text: "今天", start: 0.5, end: 1.1, confidence: null },
        { text: "我要", start: 1.1, end: 1.7, confidence: null },
        { text: "演示", start: 1.7, end: 2.4, confidence: null }
      ] },
      { id: "s2", text: "这个新工具很好用", start: 3.0, end: 5.4, confidence: null, words: [
        { text: "这个", start: 3.0, end: 3.6, confidence: null },
        { text: "新工具", start: 3.6, end: 4.4, confidence: null },
        { text: "很好用", start: 4.4, end: 5.4, confidence: null }
      ] }
    ]
  });
  writeJson(path.join(planJob, "state", "timeline-source-windows.json"), {
    schemaVersion: 1,
    sourceDurationUs: 6000000,
    timelineFps: { numerator: 30, denominator: 1 },
    clips: [{ itemId: "item-1", assetId: "asset-1", timelineStartFrame: 0, durationFrames: 180, srcStartUs: 0, srcEndUs: 6000000, playbackRateNumerator: 1, playbackRateDenominator: 1 }]
  });
  writeJson(path.join(planJob, "state", "project.json"), {
    schemaVersion: "1.0.0",
    id: "generate-plan-fixture",
    sourceVideo: "input/source.mp4",
    language: "zh-CN",
    fps: 30,
    designSystem: "state/design-system.json",
    mediaArtifacts: { roughcut: { path: "roughcut/a-roll.mp4" } }
  });
  writeJson(path.join(planJob, "state", "workflow.json"), {
    schemaVersion: "1.0.0",
    currentState: "transcription",
    captionMode: "subtitles",
    captionModeSource: "user",
    captionModeAcknowledged: true,
    visualAxisMode: "a-axis-overlay",
    visualAxisModeSource: "user",
    visualAxisModeAcknowledged: true,
    referenceScriptStatus: "none",
    referenceScriptPath: null,
    referenceScriptSha256: null
  });
  writeJson(path.join(planJob, "state", "reference-script-annotations.json"), {
    schemaVersion: "1.0.0",
    source: { status: "none", path: null, sha256: null },
    speechText: "",
    annotations: [],
    verification: { parsed: true, annotationCount: 0 }
  });
  const planInputs = {
    schemaVersion: "1.0.0",
    fps: 30,
    captionMode: "subtitles",
    timelineId: "fixture-timeline",
    corrections: {},
    lexicon: { protectedTerms: ["新工具"], forbiddenStandaloneCues: [] },
    cueLines: [
      { segmentId: "s1", fromWord: 1, toWord: 3 },
      { segmentId: "s2", fromWord: 1, toWord: 3 }
    ],
    beats: [
      { id: "b01-claim", sceneId: "hook", sourceSegmentIds: ["s1"], text: "今天我要演示", start: 0.5, end: 2.4, intent: "给出主张" },
      {
        id: "b02-tool", sceneId: "proof", sourceSegmentIds: ["s2"], text: "这个新工具很好用", start: 3.0, end: 5.4,
        recipe: "tool-strikeout", intent: "点名工具", onScreenCopy: ["新工具"],
        visualStyle: "标签入场后被划掉", primaryFlowAxis: "horizontal", visualReference: "recipes/tool-strikeout.json",
        semanticTopology: "emphasis", entryAnchorWordId: "s2:word-001", exitAnchorWordId: "s2:word-003",
        exitAnchorOffsetFrames: 0, exitFrames: 6, viewerQuestion: "这个工具还需要吗", supportRole: "consequence",
        removalLoss: "看不出被取消的是哪一个依赖", visualEncoding: "划痕编码已取消", stillFrameValue: "暂停仍可读",
        attentionCost: "low", motionFamily: "editorial", transitionFamily: "strike-reveal",
        components: ["工具标签", "划除线"], entranceFrames: 6,
        layout: { faceSafetyNote: "旧布局说明，仅保留兼容" }
      }
    ],
    reconciliation: { defaultEvidenceNote: "Fixture evidence at {start}-{end}s." },
    documents: { globalDirection: ["Fixture only"], rhythmNotes: [], openQuestions: [] }
  };
  writeJson(path.join(planJob, "state", "planning-inputs.json"), planInputs);

  // An unchanged scaffold and the locked source-time transcript are inputs,
  // not hand-authored output conflicts on the normal first generation.
  fs.mkdirSync(path.join(planJob, "docs"), { recursive: true });
  fs.mkdirSync(path.join(planJob, "captions"), { recursive: true });
  for (const [target, template] of [["docs/motion-plan.md", "motion-plan.md"], ["docs/caption-plan.md", "caption-plan.md"], ["docs/creative-confirmation.md", "creative-confirmation.md"], ["captions/caption-lexicon.json", "caption-lexicon.json"]]) fs.copyFileSync(path.join(repositoryRoot, "templates/job", template), path.join(planJob, target));
  const scaffoldConfirmation = readJson(path.join(repositoryRoot, "templates/job/creative-confirmation.json"));
  scaffoldConfirmation.captionModeDecision = { status: "acknowledged", source: "user" };
  writeJson(path.join(planJob, "state/creative-confirmation.json"), scaffoldConfirmation);
  fs.copyFileSync(path.join(planJob, "state/source-transcript.json"), path.join(planJob, "state/transcript.json"));
  const planningWorkflow = readJson(path.join(planJob, "state/workflow.json"));
  planningWorkflow.currentState = "motion-plan";
  planningWorkflow.sourceTranscriptSha256 = sha256File(path.join(planJob, "state/source-transcript.json"));
  writeJson(path.join(planJob, "state/workflow.json"), planningWorkflow);

  // Outline IDs must use the same corrected word sequence as plan generation.
  writeJson(path.join(planJob, "state/planning-inputs.json"), { ...planInputs, corrections: { "今天我要": "今天我会" } });
  script("generate-plan.mjs", [planJob, "--outline"]);
  const correctedOutline = readJson(path.join(planJob, "state/planning-outline.json"));
  assert.deepEqual(correctedOutline.segments[0].words.map((word) => [word.text, word.index, word.id]), [
    ["今天我会", 1, "s1:word-001"], ["演示", 2, "s1:word-002"]
  ]);
  writeJson(path.join(planJob, "state/planning-inputs.json"), planInputs);

  const dryRun = script("generate-plan.mjs", [planJob, "--legacy-source-timing"]);
  assert.match(dryRun.stdout, /\(dry run/);
  assert.equal(fs.existsSync(path.join(planJob, "state", "beat-map.json")), false, "dry run must not write artifacts");

  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  const initialPages = readJson(path.join(planJob, "captions/chatcut-pages.json"));
  assert.equal(initialPages.roughCutLocked, false, "a media file alone does not prove approval or a workflow lock");
  assert.equal(initialPages.captionRenderDisabled, undefined, "the generator must leave unconfirmed caption status unknown");
  const lockedWorkflow = readJson(path.join(planJob, "state/workflow.json"));
  Object.assign(lockedWorkflow, { roughCutReviewDecision: "manual-approved", authoritativeMediaPath: "roughcut/a-roll.mp4", authoritativeMediaSha256: sha256File(path.join(planJob, "roughcut/a-roll.mp4")) });
  writeJson(path.join(planJob, "state/workflow.json"), lockedWorkflow);
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  const approvedPages = readJson(path.join(planJob, "captions/chatcut-pages.json"));
  assert.equal(approvedPages.roughCutLocked, true);
  assert.equal(approvedPages.timelineVersion, "chatcut-timeline-fixture-timeline");
  assert.equal(approvedPages.captionRenderDisabled, undefined, "approval alone must not claim that ChatCut captions were disabled");
  const cleanInputs = readJson(path.join(planJob, "state/planning-inputs.json"));
  cleanInputs.cleanExport = { captionRenderDisabled: true };
  writeJson(path.join(planJob, "state/planning-inputs.json"), cleanInputs);
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  assert.equal(readJson(path.join(planJob, "captions/chatcut-pages.json")).roughCutLocked, true);
  assert.equal(readJson(path.join(planJob, "captions/chatcut-pages.json")).captionRenderDisabled, true);
  fs.appendFileSync(path.join(planJob, "roughcut/a-roll.mp4"), "changed");
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  fs.writeFileSync(path.join(planJob, "roughcut/a-roll.mp4"), "not-a-real-file");
  fs.appendFileSync(path.join(planJob, "state/source-transcript.json"), " ");
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"], false, /Source transcript changed/);
  fs.writeFileSync(path.join(planJob, "state/source-transcript.json"), fs.readFileSync(path.join(planJob, "state/source-transcript.json"), "utf8").slice(0, -1));
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  const reconciledMedia = readJson(path.join(planJob, "state/transcript-reconciliation.json"));
  assert.equal(reconciledMedia.verification.mediaPath, "roughcut/a-roll.mp4");
  assert.equal(reconciledMedia.mediaFingerprint, sha256File(path.join(planJob, "roughcut/a-roll.mp4")));
  const derived = readJson(path.join(planJob, "state", "transcript.json"));
  assert.equal(derived.revision, 2);
  assert.equal(derived.duration, 6);
  assert.deepEqual(derived.segments.map((segment) => segment.text), ["今天我要演示", "这个新工具很好用"]);
  const derivedPlan = readJson(path.join(planJob, "captions", "caption-review-plan.json"));
  assert.deepEqual(derivedPlan.cues.map((cue) => cue.text), ["今天我要演示", "这个新工具很好用"]);
  assert.equal(derivedPlan.transcriptSha256, sha256File(path.join(planJob, "state", "transcript.json")));
  const derivedBeats = readJson(path.join(planJob, "state", "beat-map.json"));
  assert.deepEqual(derivedBeats.beats.map((beat) => beat.mgScope), ["none", "local"]);
  assert.equal(derivedBeats.beats[0].recipe, "caption-only");
  assert.equal(derivedBeats.beats[0].audioAnchorTime, 0.5);
  assert.equal(derivedBeats.beats[1].typography.fontFamily, "Smiley Sans");
  assert.deepEqual(derivedBeats.beats[1].captionCueIds, ["caption-0002"]);
  script("check-caption-review-plan.mjs", [path.join(planJob, "captions", "caption-review-plan.json")]);
  script("check-transcript-reconciliation.mjs", [path.join(planJob, "state", "transcript-reconciliation.json"), "--expected-media", "roughcut/a-roll.mp4"]);

  const manualMainJob = path.join(temporaryRoot, "manual-main-caption-job");
  fs.cpSync(planJob, manualMainJob, { recursive: true });
  writeJson(path.join(manualMainJob, "state", "chatcut-main-timeline.json"), {
    state: { id: "main-caption-fixture", fps: 30, durationFrames: 180 },
    transcript: {
      coverage: { status: "complete", candidateItemCount: 2, coveredItemCount: 2, missingItemIds: [] },
      entries: [
        { itemId: "item-1", text: "今天我要演示", timelineRange: { fromFrame: 15, toFrame: 72 } },
        { itemId: "item-2", text: "这个新工具很好用", timelineRange: { fromFrame: 90, toFrame: 162 } }
      ]
    }
  });
  const manualMainInputs = readJson(path.join(manualMainJob, "state", "planning-inputs.json"));
  delete manualMainInputs.cueLines;
  manualMainInputs.captionCues = [
    { segmentId: "main-001", text: "今天我要", start: 0.5, end: 1.3 },
    { segmentId: "main-001", text: "演示", start: 1.3, end: 2.4 },
    { segmentId: "main-002", text: "这个新工具", start: 3, end: 4.2 },
    { segmentId: "main-002", text: "很好用", start: 4.2, end: 5.4 }
  ];
  writeJson(path.join(manualMainJob, "state", "planning-inputs.json"), manualMainInputs);
  script("generate-plan.mjs", [manualMainJob, "--write", "--replace-existing"]);
  const manualPlanPath = path.join(manualMainJob, "captions", "caption-review-plan.json");
  const manualPlan = readJson(manualPlanPath);
  assert.equal(readJson(path.join(manualMainJob, "captions", "chatcut-pages.json")).timelineVersion, "chatcut-timeline-main-caption-fixture");
  assert.deepEqual(manualPlan.cues.map((cue) => cue.text), ["今天我要", "演示", "这个新工具", "很好用"]);
  assert.equal(manualPlan.cues[0].segmentId, "main-001");
  script("check-caption-review-plan.mjs", [manualPlanPath]);

  // One author input corrects the standard main-timeline route and reuses phrase
  // cards; only the deliberately changed entry supplies replacement cues.
  const sparseMainJob = path.join(temporaryRoot, "sparse-main-caption-job");
  fs.cpSync(manualMainJob, sparseMainJob, { recursive: true });
  const sparseSnapshot = readJson(path.join(sparseMainJob, "state/chatcut-main-timeline.json"));
  sparseSnapshot.transcript.entries[1].text = "这个新功具很好用";
  writeJson(path.join(sparseMainJob, "state/chatcut-main-timeline.json"), sparseSnapshot);
  const sparseInputs = { ...manualMainInputs, corrections: { "新功具": "新工具" },
    captionTimingPath: "state/caption-timing.json",
    captionEdits: { "main-001": [{ text: "今天我要", start: .5, end: 1.3 }, { text: "演示", start: 1.3, end: 2.4 }] }
  };
  delete sparseInputs.captionCues;
  writeJson(path.join(sparseMainJob, "state/planning-inputs.json"), sparseInputs);
  writeJson(path.join(sparseMainJob, "state/caption-timing.json"), { structuredContent: {
    timelineId: "main-caption-fixture", hasMore: false,
    text: '[C0] id=cue:1 frame=15-72 text="今天我要演示"\n'
      + '[C1] id=cue:2 frame=90-126 text="这个新功具"\n'
      + '[C2] id=cue:3 frame=126-162 text="很好用"\n'
  } });
  script("generate-plan.mjs", [sparseMainJob, "--write", "--replace-existing"]);
  const sparseTranscript = readJson(path.join(sparseMainJob, "state/transcript.json"));
  assert.equal(sparseTranscript.segments[1].text, "这个新工具很好用");
  assert.equal(sparseTranscript.segments[1].rawText, "这个新功具很好用");
  const sparsePlan = readJson(path.join(sparseMainJob, "captions/caption-review-plan.json"));
  assert.deepEqual(sparsePlan.cues.map(cue => cue.text), ["今天我要", "演示", "这个新工具", "很好用"]);
  assert.equal(sparsePlan.cues[2].start, 3);
  assert.equal(sparsePlan.cues[2].end, 4.2);
  script("check-caption-review-plan.mjs", [path.join(sparseMainJob, "captions/caption-review-plan.json")]);
  sparseInputs.captionEdits = { "main-001": ["今天我要", "演示"] };
  writeJson(path.join(sparseMainJob, "state/planning-inputs.json"), sparseInputs);
  script("generate-plan.mjs", [sparseMainJob, "--write", "--replace-existing"]);
  const phraseOnlyPlan = readJson(path.join(sparseMainJob, "captions/caption-review-plan.json"));
  assert.deepEqual(phraseOnlyPlan.cues.map(cue => cue.text), ["今天我要", "演示", "这个新工具", "很好用"]);
  assert.equal(phraseOnlyPlan.cues[0].start, .5);
  assert.equal(phraseOnlyPlan.cues[1].end, 2.4);
  assert.match(phraseOnlyPlan.timingAuthority, /captions only/);
  writeJson(path.join(sparseMainJob, "state/chatcut-main-timeline.json"), { structuredContent: null,
    content: [{ type: "text", text: JSON.stringify(sparseSnapshot) }] });
  script("generate-plan.mjs", [sparseMainJob, "--write", "--replace-existing"]);
  assert.equal(readJson(path.join(sparseMainJob, "captions/chatcut-pages.json")).timelineVersion,
    "chatcut-timeline-main-caption-fixture", "the shared wrapper parser preserves main-timeline identity as well as text");
  script("promote-caption-review-plan.mjs", [manualMainJob]);
  const promotedManualCaptions = readJson(path.join(manualMainJob, "captions", "captions.json"));
  assert.deepEqual(promotedManualCaptions.cues.map((cue) => cue.viewerText), ["今天我要", "演示", "这个新工具", "很好用"]);
  assert.deepEqual(promotedManualCaptions.cues.map(({ start, end }) => [start, end]), [[0.5, 1.3], [1.3, 2.4], [3, 4.2], [4.2, 5.4]]);
  const manualCaptionDoc = fs.readFileSync(path.join(manualMainJob, "docs", "caption-plan.md"), "utf8");
  assert.match(manualCaptionDoc, /按中文自然短语切分/);
  assert.match(manualCaptionDoc, /每行不超过 10 个显示单位/);
  assert.doesNotMatch(manualCaptionDoc, /4–10\.5 个显示单位/);
  assert.doesNotMatch(manualCaptionDoc, /每个条目一条/);

  const heuristicJob = path.join(temporaryRoot, "caption-heuristic-job");
  fs.mkdirSync(path.join(heuristicJob, "captions"), { recursive: true });
  fs.mkdirSync(path.join(heuristicJob, "state"), { recursive: true });
  const heuristicTranscriptPath = path.join(heuristicJob, "state", "transcript.json");
  const heuristicTranscript = {
    revision: 1,
    duration: 0.2,
    segments: [{ id: "seg-001", text: "的", start: 0, end: 0.2, words: [{ text: "的", start: 0, end: 0.2 }] }]
  };
  writeJson(heuristicTranscriptPath, heuristicTranscript);
  writeJson(path.join(heuristicJob, "captions", "caption-lexicon.json"), {
    protectedTerms: [], forbiddenStandaloneCues: ["的"]
  });
  const heuristicPlan = {
    schemaVersion: "1.0.0",
    status: "proposed",
    wordingAuthority: "state/transcript.json",
    transcriptRevision: 1,
    transcriptSha256: sha256File(heuristicTranscriptPath),
    timingAuthority: "state/transcript.json word ranges",
    segmentationAuthority: "agent-authored word ranges",
    rules: {
      exactlyOneLine: true,
      minimumDurationSeconds: 9,
      targetDurationSeconds: [99, 100],
      targetDisplayUnits: [99, 100],
      maximumDisplayUnits: 0.1,
      fitFontSizePx: [1, 2],
      protectedTerms: [],
      forbiddenStandaloneCues: ["的"]
    },
    exceptions: {},
    cues: [{
      id: "caption-0001", text: "的，",
      startWordId: "seg-001:word-001", endWordId: "seg-001:word-001"
    }]
  };
  const heuristicPlanPath = path.join(heuristicJob, "captions", "caption-review-plan.json");
  writeJson(heuristicPlanPath, heuristicPlan);
  script("check-caption-review-plan.mjs", [heuristicPlanPath]);
  const captionSchema = readJson(path.join(repositoryRoot, "schemas", "captions.schema.json"));
  assert.deepEqual(captionSchema.properties.style.properties.maximumDisplayUnits, { type: "number" });
  const reviewPlanSchema = readJson(path.join(repositoryRoot, "schemas", "caption-review-plan.schema.json"));
  assert.deepEqual(reviewPlanSchema.properties.rules, { type: "object" });

  const protectedTranscript = {
    revision: 1,
    duration: 0.4,
    segments: [{ id: "seg-001", text: "新工具", start: 0, end: 0.4, words: [
      { text: "新", start: 0, end: 0.2 }, { text: "工具", start: 0.2, end: 0.4 }
    ] }]
  };
  writeJson(heuristicTranscriptPath, protectedTranscript);
  writeJson(path.join(heuristicJob, "captions", "caption-lexicon.json"), {
    protectedTerms: ["新工具"], forbiddenStandaloneCues: []
  });
  const splitProtectedPlan = structuredClone(heuristicPlan);
  splitProtectedPlan.transcriptSha256 = sha256File(heuristicTranscriptPath);
  splitProtectedPlan.rules.protectedTerms = ["新工具"];
  splitProtectedPlan.rules.forbiddenStandaloneCues = [];
  splitProtectedPlan.cues = [
    { id: "caption-0001", text: "新", startWordId: "seg-001:word-001", endWordId: "seg-001:word-001" },
    { id: "caption-0002", text: "工具", startWordId: "seg-001:word-002", endWordId: "seg-001:word-002" }
  ];
  writeJson(heuristicPlanPath, splitProtectedPlan);
  script("check-caption-review-plan.mjs", [heuristicPlanPath], false, /protected term is split across cues/);
  splitProtectedPlan.cues[1].start = 0.1;
  writeJson(heuristicPlanPath, splitProtectedPlan);
  script("check-caption-review-plan.mjs", [heuristicPlanPath], false, /cues overlap/);

  const firstPass = fs.readFileSync(path.join(planJob, "state", "beat-map.json"), "utf8");
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  assert.equal(fs.readFileSync(path.join(planJob, "state", "beat-map.json"), "utf8"), firstPass, "generate-plan must be idempotent");
  const reconciliationPath = path.join(planJob, "state", "transcript-reconciliation.json");
  const conflict = readJson(reconciliationPath);
  conflict.items[0].type = "ambiguous";
  conflict.items[0].resolution = "unresolved";
  conflict.items[0].releaseImpact = true;
  writeJson(reconciliationPath, conflict);
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  assert.equal(readJson(reconciliationPath).items[0].resolution, "unresolved", "rerun preserves unresolved conflicts");
  const motionDocPath = path.join(planJob, "docs", "motion-plan.md");
  const generatedDoc = fs.readFileSync(motionDocPath, "utf8");
  fs.writeFileSync(motionDocPath, "manual edit\n");
  const beforeFailure = sha256File(path.join(planJob, "state", "transcript.json"));
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"], false, /existing manual content/);
  assert.equal(fs.readFileSync(motionDocPath, "utf8"), "manual edit\n");
  assert.equal(sha256File(path.join(planJob, "state", "transcript.json")), beforeFailure);
  fs.writeFileSync(motionDocPath, generatedDoc);

  const settledInputs = fs.readFileSync(path.join(planJob, "state", "planning-inputs.json"), "utf8");
  const unsafe = readJson(path.join(planJob, "state", "planning-inputs.json"));
  delete unsafe.beats[1].layout;
  writeJson(path.join(planJob, "state", "planning-inputs.json"), unsafe);
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  fs.writeFileSync(path.join(planJob, "state", "planning-inputs.json"), settledInputs);

  // A beat only names what it decides; the fields it shares with its MG
  // component come from the component metadata, so the two cannot drift.
  const beatMapFor = (beat) => buildBeatMap({
    transcript: { duration: 6 },
    captionMode: "subtitles",
    fps: 30,
    designSystem: {
      typography: { displayFamily: "Smiley Sans", outlineReservePx: 18 },
      captions: { fontSizePx: 96 }
    },
    beats: [{ id: "b01", start: 1, end: 3, text: "示例", layout: { faceSafetyNote: "Fixture" }, ...beat }]
  }).beats[0];
  const minimal = beatMapFor({ templateId: "correction", onScreenCopy: ["旧工具", "新工具"] });
  const withDelayAlias = beatMapFor({ templateId: "correction", templateData: { copy: ["旧工具", "新工具"],
    revealCues: [{ atStart: true }, { after: 0, frames: 6 }] } });
  assert.deepEqual(withDelayAlias.templateData.revealCues[1], { after: 0, delayFrames: 6 }, "author delay alias is normalized before schema/composition");
  const strikeMeta = resolveComponent("correction").meta;
  for (const field of ["semanticTopology", "primaryFlowAxis", "motionFamily", "transitionFamily"]) assert.equal(minimal[field], strikeMeta[field]);
  assert.equal(minimal.visualStyle, strikeMeta.summaryZh ?? strikeMeta.summary);
  assert.equal(minimal.layout.safeAreaPass, undefined);
  assert.equal(minimal.captionSafeZonePass, undefined);
  assert.equal(
    beatMapFor({ templateId: "correction", onScreenCopy: ["旧工具", "新工具"], transitionFamily: "strike-lock" }).transitionFamily,
    "strike-lock",
    "an explicit beat value must still win: the disagreements are editorial"
  );
  const flowMeta = resolveComponent("linear-flow").meta;
  assert.equal(beatMapFor({ templateId: "linear-flow", onScreenCopy: ["工具", "影片"] }).visualStyle, flowMeta.summaryZh ?? flowMeta.summary);
  assert.equal(beatMapFor({ recipe: "caption-only" }).semanticTopology, undefined, "caption-only beats do not consult the registry");

  // Duplicate derived lines are dropped; they must not block plan generation.
  const restated = readJson(path.join(planJob, "state", "planning-inputs.json"));
  for (const label of ["Palette", "字幕模式", "**字体**", "- **配色：**", "1. `TYPOGRAPHY`", "### caption MODE"]) {
    restated.documents.globalDirection = [`${label}：沿用设计系统`];
    writeJson(path.join(planJob, "state", "planning-inputs.json"), restated);
    script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);
  }
  restated.documents.globalDirection = ["字体随重点变化时，保持同一层级", "强调配色：只用于本拍结论"];
  writeJson(path.join(planJob, "state", "planning-inputs.json"), restated);
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing"]);

  // The public example is a complete input for this fixture, not a pseudo-schema.
  const legacyReconciliation = readJson(reconciliationPath);
  writeJson(path.join(planJob, "state", "chatcut-main-timeline.json"), {
    state: { id: "fixture-timeline", fps: 30, durationFrames: 180 },
    transcript: {
      coverage: { status: "complete", candidateItemCount: 2, coveredItemCount: 2, missingItemIds: [] },
      entries: [
        { itemId: "item-1", text: "今天我要演示", timelineRange: { fromFrame: 15, toFrame: 72 } },
        { itemId: "item-2", text: "这个新工具很好用", timelineRange: { fromFrame: 90, toFrame: 162 } }
      ]
    }
  });
  fs.copyFileSync(path.join(repositoryRoot, "templates", "planning-inputs.example.json"), path.join(planJob, "state", "planning-inputs.json"));
  script("generate-plan.mjs", [planJob, "--write"]);
  const exampleBeats = readJson(path.join(planJob, "state", "beat-map.json"));
  const generatedCaptionPlan = readJson(path.join(planJob, "captions", "caption-review-plan.json"));
  assert.equal(readJson(path.join(planJob, "captions", "chatcut-pages.json")).timelineVersion, "chatcut-timeline-fixture-timeline");
  assert.equal(generatedCaptionPlan.segmentationAuthority, "agent-authored phrase cues within ChatCut main timeline entries");
  assert.deepEqual(generatedCaptionPlan.cues.map((cue) => cue.text), ["今天我要", "演示", "这个新工具", "很好用"]);
  assert.equal(exampleBeats.beats[1].templateId, "annotation");
  assert.deepEqual(exampleBeats.beats[1].templateData.copy, ["演示见片尾"]);
  script("check-visual-plan.mjs", [path.join(planJob, "state/beat-map.json"), path.join(planJob, "state/transcript.json"), path.join(planJob, "state/design-system.json")]);
  const edgeAnnotation = structuredClone(exampleBeats);
  edgeAnnotation.beats[1].layout.primaryBoundsNormalized.y = 0;
  const edgeAnnotationPath = path.join(temporaryRoot, "edge-annotation.json");
  writeJson(edgeAnnotationPath, edgeAnnotation);
  script("check-visual-plan.mjs", [edgeAnnotationPath, path.join(planJob, "state/transcript.json"), path.join(planJob, "state/design-system.json")], false, /edge strip/);
  script("assemble-mg.mjs", [planJob, "--write"]);
  fs.copyFileSync(path.join(repositoryRoot, "templates/hyperframes/index.template.html"), path.join(planJob, "hyperframes/index.template.html"));
  script("build-composition.mjs", [path.join(planJob, "hyperframes")]);
  assert.match(fs.readFileSync(path.join(planJob, "hyperframes/index.html"), "utf8"), /演示见片尾/);

  // Reference order remains exact while the released acoustic order reverses.
  const referencePath = "input/reference-scripts/original.txt";
  fs.mkdirSync(path.join(planJob, "input/reference-scripts"), { recursive: true });
  const referenceText = "今天我要演示。这个新工具很好用。";
  fs.writeFileSync(path.join(planJob, referencePath), referenceText);
  const referenceSha = sha256File(path.join(planJob, referencePath));
  const referenceWorkflow = readJson(path.join(planJob, "state/workflow.json"));
  Object.assign(referenceWorkflow, { referenceScriptStatus: "provided", referenceScriptPath: referencePath, referenceScriptSha256: referenceSha });
  writeJson(path.join(planJob, "state/workflow.json"), referenceWorkflow);
  writeJson(path.join(planJob, "state/reference-script-annotations.json"), buildReferenceScriptAnnotations({ status: "provided", path: referencePath, sha256: referenceSha, text: referenceText }));
  const originalReconciliation = legacyReconciliation;
  originalReconciliation.items = originalReconciliation.items.map((item) => ({ ...item, type: "matched", resolution: "accepted-speech", releaseImpact: false, referenceText: item.heardText }));
  writeJson(reconciliationPath, originalReconciliation);
  writeJson(path.join(planJob, "state/timeline-source-windows.json"), { clips: [clip(3, 6, 0), clip(0, 3, 3)] });
  const reorderInputs = readJson(path.join(planJob, "state/planning-inputs.json"));
  fs.rmSync(path.join(planJob, "state", "chatcut-main-timeline.json"), { force: true });
  delete reorderInputs.captionCues;
  reorderInputs.cueLines = [
    { segmentId: "s2", fromWord: 1, toWord: 3 },
    { segmentId: "s1", fromWord: 1, toWord: 3 }
  ];
  reorderInputs.beats = [{ id: "reordered", sceneId: "one", sourceSegmentIds: ["s2", "s1"], text: "这个新工具很好用今天我要演示", start: 0, end: 6, intent: "重排" }];
  writeJson(path.join(planJob, "state/planning-inputs.json"), reorderInputs);
  // Switching this fixture back to legacy timing replaces its old source-word
  // evidence, which the main-timeline generation manifest no longer owns.
  script("generate-plan.mjs", [planJob, "--write", "--legacy-source-timing", "--replace-existing"]);
  const reorderedReconciliation = readJson(reconciliationPath);
  assert.deepEqual(reorderedReconciliation.items.map((item) => item.segmentId), ["s2", "s1"]);
  assert.deepEqual(reorderedReconciliation.referenceScript.itemOrder, ["r-s1", "r-s2"]);
  script("check-transcript-reconciliation.mjs", [reconciliationPath, "--expected-media", "roughcut/a-roll.mp4"]);
  reorderedReconciliation.referenceScript.itemOrder = ["r-s1", "r-s1"];
  writeJson(reconciliationPath, reorderedReconciliation);
  script("check-transcript-reconciliation.mjs", [reconciliationPath], false, /every reference-bearing item exactly once/);

  console.log("Planning contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
