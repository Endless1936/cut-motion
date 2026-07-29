import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import {
  buildDeltaCompositions,
  compareMotionIndexes,
  createPreviewBaseline,
  verifyDeltaBindings
} from "./delta-preview.mjs";
import { deriveMotionIndex } from "./motion-index.mjs";
import { readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-incremental-"));
const jobRoot = path.join(temporaryRoot, "job");

const writeModule = (beatId, options = {}) => {
  const directory = path.join(jobRoot, "hyperframes", "mg", beatId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "fragment.html"), `<div data-beat-id="${beatId}"><p class="copy">测试</p></div>\n`);
  fs.writeFileSync(
    path.join(directory, "style.css"),
    options.style ?? `[data-beat-id="${beatId}"] .copy { color: var(--paper); background-image: url("./assets/test.png"); }\n`
  );
  fs.writeFileSync(
    path.join(directory, "timeline.mjs"),
    options.timeline ?? `timeline.from('[data-beat-id="${beatId}"] .copy', { opacity: 0, duration: 0.2 }, beat.start);\n`
  );
};

try {
  fs.mkdirSync(path.join(jobRoot, "state"), { recursive: true });
  fs.mkdirSync(path.join(jobRoot, "captions"), { recursive: true });
  fs.cpSync(path.join(repositoryRoot, "templates", "hyperframes"), path.join(jobRoot, "hyperframes"), { recursive: true });
  fs.mkdirSync(path.join(jobRoot, "hyperframes", "assets", "fonts"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"), "media");
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "gsap.min.js"), "gsap");
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "fonts", "smiley-sans-oblique.woff2"), "font");
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "test asset");
  fs.copyFileSync(path.join(repositoryRoot, "examples", "beat-map.example.json"), path.join(jobRoot, "state", "beat-map.json"));
  fs.copyFileSync(path.join(repositoryRoot, "examples", "transcript.example.json"), path.join(jobRoot, "state", "transcript.json"));
  writeJsonAtomic(path.join(jobRoot, "captions", "captions.json"), {
    cues: [{ id: "caption-0001", text: "看看这些特效", lines: ["看看这些特效"], start: 0, end: 1.5 }]
  });
  writeModule("beat-001");

  const firstBuild = buildComposition(path.join(jobRoot, "hyperframes"));
  const firstSha = sha256File(firstBuild.outputPath);
  const secondBuild = buildComposition(path.join(jobRoot, "hyperframes"));
  assert.equal(sha256File(secondBuild.outputPath), firstSha, "composition builds must be deterministic");
  const productionHtml = fs.readFileSync(firstBuild.outputPath, "utf8");
  assert.equal((productionHtml.match(/gsap\.timeline\(/g) ?? []).length, 1);
  assert.equal((productionHtml.match(/window\.__timelines\.main\s*=/g) ?? []).length, 1);
  assert.doesNotMatch(productionHtml, /__CUT_MOTION_DURATION__/);
  assert.match(productionHtml, /exitAnchorTime:/);
  assert.match(productionHtml, /exitAnchorTime: 1\.5, exitStartTime: 1\.5, exitDuration: 0\.266667/);
  assert.match(productionHtml, /timeline\.to\(root, \{ autoAlpha: 0/);
  assert.match(productionHtml, /url\("\.\/assets\/test\.png"\)/);
  const initialIndex = deriveMotionIndex(jobRoot);
  assert.deepEqual(initialIndex.beats[0].window, { start: 0, end: 1.766667 });
  assert.deepEqual(initialIndex.beats[0].assets, [{
    path: "hyperframes/assets/test.png",
    sha256: sha256File(path.join(jobRoot, "hyperframes", "assets", "test.png"))
  }]);

  const overlapBeatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  for (const beat of overlapBeatMap.beats) beat.axis = "A";
  const overlapBeatMapPath = path.join(jobRoot, "state", "beat-map.a-axis-overlap.json");
  writeJsonAtomic(overlapBeatMapPath, overlapBeatMap);
  const overlapCheck = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "check-visual-plan.mjs"),
    overlapBeatMapPath,
    path.join(jobRoot, "state", "transcript.json"),
    path.join(repositoryRoot, "assets", "design-system.default.json")
  ], { encoding: "utf8" });
  assert.notEqual(overlapCheck.status, 0);
  assert.match(`${overlapCheck.stderr}${overlapCheck.stdout}`, /A-axis information groups overlap instead of replacing/);

  writeModule("beat-001", {
    timeline: "timeline.to('[data-beat-id]', { opacity: 0 }, beat.start);\n"
  });
  assert.throws(
    () => buildComposition(path.join(jobRoot, "hyperframes")),
    /timeline tween target must be the Beat root/
  );
  writeModule("beat-001", {
    timeline: "gsap.to('[data-beat-id=\"beat-001\"] .copy', { opacity: 0 });\n"
  });
  assert.throws(
    () => buildComposition(path.join(jobRoot, "hyperframes")),
    /must append to the supplied timeline/
  );
  writeModule("beat-001", {
    timeline: "timeline.to('[data-beat-id=\"beat-001\"] ~ [data-beat-id]', { opacity: 0 }, beat.start);\n"
  });
  assert.throws(
    () => buildComposition(path.join(jobRoot, "hyperframes")),
    /timeline tween target must be the Beat root/
  );
  writeModule("beat-001");

  const assetBaseline = deriveMotionIndex(jobRoot);
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "replacement asset");
  const assetPlan = compareMotionIndexes(assetBaseline, deriveMotionIndex(jobRoot));
  assert.equal(assetPlan.kind, "delta");
  assert.deepEqual(assetPlan.changedBeatIds, ["beat-001"]);
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "test asset");

  const baseline = deriveMotionIndex(jobRoot);
  fs.rmSync(path.join(jobRoot, "hyperframes", "mg", "beat-001"), { recursive: true });
  const deletionPlan = compareMotionIndexes(baseline, deriveMotionIndex(jobRoot));
  assert.equal(deletionPlan.kind, "delta");
  assert.deepEqual(deletionPlan.changedBeatIds, ["beat-001"]);
  assert.deepEqual(deletionPlan.windows, [{ start: 0, end: 2.266667 }], "deleted MG must retain its full rendered exit window");

  writeModule("beat-001");
  const moveBaseline = deriveMotionIndex(jobRoot);
  const movedBeatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  movedBeatMap.beats[0].start = 0.4;
  movedBeatMap.beats[0].end = 1.9;
  writeJsonAtomic(path.join(jobRoot, "state", "beat-map.json"), movedBeatMap);
  const movedCaptions = readJson(path.join(jobRoot, "captions", "captions.json"));
  movedCaptions.cues[0].start = 0.3;
  movedCaptions.cues[0].end = 1.8;
  writeJsonAtomic(path.join(jobRoot, "captions", "captions.json"), movedCaptions);
  const movePlan = compareMotionIndexes(moveBaseline, deriveMotionIndex(jobRoot));
  assert.equal(movePlan.kind, "delta");
  assert.deepEqual(movePlan.changedBeatIds, ["beat-001"]);
  assert.deepEqual(movePlan.changedCaptionCueIds, ["caption-0001"]);
  assert.deepEqual(movePlan.windows, [{ start: 0, end: 2.3 }], "moved items must use the padded old/new window union");
  const [deltaBuild] = buildDeltaCompositions(jobRoot, movePlan);
  const deltaHtml = fs.readFileSync(deltaBuild.outputPath, "utf8");
  assert.match(deltaHtml, /data-composition-id="main"[^>]+data-duration="2\.3"/);
  assert.match(deltaHtml, /data-media-start="0"/);
  assert.doesNotMatch(deltaHtml, /__CUT_MOTION_DURATION__/);
  assert.match(deltaHtml, /url\("\.\.\/assets\/fonts\/smiley-sans-oblique\.woff2"\)/);
  assert.match(deltaHtml, /url\("\.\.\/assets\/test\.png"\)/);

  const separatedBaseline = {
    duration: 200,
    sharedDependencySha256: "shared",
    beats: [
      { beatId: "early", window: { start: 10, end: 12 }, moduleSha256: "old" },
      { beatId: "late", window: { start: 180, end: 182 }, moduleSha256: "old" }
    ],
    captions: []
  };
  const separatedCurrent = {
    ...separatedBaseline,
    beats: separatedBaseline.beats.map((beat) => ({ ...beat, moduleSha256: "new" }))
  };
  assert.deepEqual(
    compareMotionIndexes(separatedBaseline, separatedCurrent).windows,
    [{ start: 9.5, end: 12.5 }, { start: 179.5, end: 182.5 }],
    "non-adjacent changes must remain separate delta windows"
  );

  fs.mkdirSync(path.join(jobRoot, "previews"), { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "previews", "baseline.mp4"), "baseline");
  const previewBaseline = createPreviewBaseline(jobRoot, 1, "previews/baseline.mp4");
  const currentMotionIndexPath = path.join(jobRoot, "state", "motion-index.json");
  const pendingDelta = {
    baselineMotionIndexPath: previewBaseline.motionIndexPath,
    baselineMotionIndexSha256: previewBaseline.motionIndexSha256,
    baselinePreviewPath: previewBaseline.previewPath,
    baselinePreviewSha256: previewBaseline.previewSha256,
    currentMotionIndexPath: "state/motion-index.json",
    currentMotionIndexSha256: sha256File(currentMotionIndexPath),
    productionCompositionPath: "hyperframes/index.html",
    productionCompositionSha256: sha256File(path.join(jobRoot, "hyperframes", "index.html"))
  };
  assert.equal(verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline), true);
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "tampered asset");
  assert.throws(
    () => verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline),
    /Motion Index no longer matches/
  );
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "test asset");
  fs.appendFileSync(path.join(jobRoot, "previews", "baseline.mp4"), "tampered");
  assert.throws(
    () => verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline),
    /baseline preview SHA-256 is stale/
  );
  fs.writeFileSync(path.join(jobRoot, "previews", "baseline.mp4"), "baseline");
  fs.appendFileSync(path.join(jobRoot, "hyperframes", "mg", "beat-001", "style.css"), "\n[data-beat-id=\"beat-001\"] { opacity: 0.99; }\n");
  assert.throws(
    () => verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline),
    /Motion Index no longer matches/
  );
  writeModule("beat-001");
  buildComposition(path.join(jobRoot, "hyperframes"));
  const refreshedIndex = deriveMotionIndex(jobRoot);
  writeJsonAtomic(currentMotionIndexPath, refreshedIndex);
  pendingDelta.currentMotionIndexSha256 = sha256File(currentMotionIndexPath);
  pendingDelta.productionCompositionSha256 = sha256File(path.join(jobRoot, "hyperframes", "index.html"));
  assert.equal(verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline), true);
  fs.appendFileSync(path.join(jobRoot, "hyperframes", "index.html"), "\n<!-- tampered -->\n");
  assert.throws(
    () => verifyDeltaBindings(jobRoot, pendingDelta, previewBaseline),
    /production composition SHA-256 is stale/
  );

  const workflowSource = fs.readFileSync(path.join(repositoryRoot, "scripts", "workflow-state.mjs"), "utf8");
  const compositionClassification = workflowSource.indexOf("const classification = classifyCompositionRevision();");
  const laterAuthorityCheck = workflowSource.indexOf('if (["visual-sample", "composition", "qa", "render"].includes(workflow.currentState))', compositionClassification);
  assert.ok(compositionClassification > 0 && laterAuthorityCheck > compositionClassification, "local classification and authority update must run before the old authority assertion");
  const packageTemplate = readJson(path.join(repositoryRoot, "templates", "hyperframes", "package.json"));
  const highRenderCommand = packageTemplate.scripts.render;
  assert.ok(
    highRenderCommand.indexOf("build:composition") < highRenderCommand.indexOf("delta-preview.mjs verify")
      && highRenderCommand.indexOf("delta-preview.mjs verify") < highRenderCommand.indexOf("hyperframes render"),
    "high delivery must rebuild and verify delta bindings before rendering"
  );

  console.log("Incremental revision tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
