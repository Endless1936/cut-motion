import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import {
  buildDeltaCompositions,
  compareMotionIndexes,
  createPreviewBaseline,
  verifyDeltaBindings
} from "./delta-preview.mjs";
import { deriveMotionIndex } from "./motion-index.mjs";
import {
  deriveRenderManifest,
  planStableChunkBoundaries,
  quantizeRenderInterval,
  unsafeRenderIntervals
} from "./render-manifest.mjs";
import {
  assembleChunks,
  probeVideoArtifact,
  pruneChunkCache,
  renderChunkedOutput,
  singlePassAudioSupported,
  validateCacheReceipt,
  verifyAssemblyReceipt
} from "./render-chunks.mjs";
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
  fs.copyFileSync(path.join(repositoryRoot, "assets", "design-system.default.json"), path.join(jobRoot, "state", "design-system.json"));
  writeJsonAtomic(path.join(jobRoot, "state", "workflow.json"), {
    captionMode: "subtitles",
    authoritativeMediaPath: "hyperframes/assets/input-video.mp4",
    authoritativeMediaSha256: sha256File(path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"))
  });
  writeJsonAtomic(path.join(jobRoot, "state", "creative-confirmation.json"), { visualAxisMode: "a-axis-overlay" });
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
  assert.equal(Math.ceil(197.597 * 30), 5928);
  assert.deepEqual(quantizeRenderInterval(1.001, 1.999, 30, 300), { startFrame: 30, endFrame: 60 });
  assert.deepEqual(
    unsafeRenderIntervals({
      fps: 30,
      duration: 30,
      beats: [
        { id: "b1", sceneId: "s1", axis: "B", start: 0, end: 10 },
        { id: "b2", sceneId: "s2", axis: "B", start: 10, end: 20 }
      ]
    }, { beats: [], captions: [] }),
    [{ startFrame: 0, endFrame: 600 }],
    "a continuous B-axis passage must remain atomic even when scene IDs change"
  );
  assert.deepEqual(
    planStableChunkBoundaries({
      totalFrames: 1440,
      fps: 30,
      unsafeIntervals: [{ startFrame: 350, endFrame: 380 }],
      baselineBoundaries: [360, 720, 1080]
    }),
    [0, 350, 720, 1080, 1440],
    "an unsafe local baseline boundary must move without cascading later boundaries"
  );
  const renderManifest = deriveRenderManifest(jobRoot);
  assert.equal(renderManifest.totalFrames, Math.ceil(readJson(path.join(jobRoot, "state", "beat-map.json")).duration * 30));
  assert.notEqual(renderManifest.chunks[0].standardKey, renderManifest.chunks[0].highKey);
  const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
  const passThroughTemplate = fs.readFileSync(templatePath, "utf8");
  const passThroughAudioTag = /<audio\b[^>]*>/i.exec(passThroughTemplate)?.[0];
  assert.ok(passThroughAudioTag);
  assert.equal(singlePassAudioSupported(jobRoot, renderManifest), true);
  for (const [needle, replacement] of [
    ['data-volume="1"', 'data-volume="0.5"'],
    ['data-start="0"', 'data-start="0.25"'],
    ['data-media-start="__CUT_MOTION_MEDIA_START__"', 'data-media-start="0.25"'],
    ['src="./assets/input-video.mp4"', 'src="./assets/test.png"']
  ]) {
    fs.writeFileSync(
      templatePath,
      passThroughTemplate.replace(passThroughAudioTag, passThroughAudioTag.replace(needle, replacement))
    );
    assert.equal(singlePassAudioSupported(jobRoot, renderManifest), false, `${replacement} must disable audio pass-through`);
  }
  fs.writeFileSync(
    templatePath,
    passThroughTemplate.replace(
      passThroughAudioTag,
      passThroughAudioTag.replace('data-volume="1"', 'data-volume="1" data-playback-rate="1.25"')
    )
  );
  assert.equal(singlePassAudioSupported(jobRoot, renderManifest), false);
  fs.writeFileSync(templatePath, passThroughTemplate.replace("</script>", 'document.getElementById("source-audio").volume = 0.5;</script>'));
  assert.equal(singlePassAudioSupported(jobRoot, renderManifest), false);
  const captionWindowTemplate = passThroughTemplate.replace(
    "<!-- CUT_MOTION_CAPTIONS_START -->",
    `<!-- CUT_MOTION_CAPTIONS_START -->
      <section id="caption-inside" class="clip motion-caption-layer" data-caption-id="caption-inside" data-start="1.2" data-duration="0.4" data-track-index="80"><p class="motion-caption-line">窗口内</p></section>
      <section id="caption-outside" class="clip motion-caption-layer" data-caption-id="caption-outside" data-start="2.5" data-duration="0.4" data-track-index="80"><p class="motion-caption-line">窗口外</p></section>`
  );
  fs.writeFileSync(templatePath, captionWindowTemplate);

  const frameWindowBuild = buildComposition(path.join(jobRoot, "hyperframes"), {
    startFrame: 30,
    endFrame: 60,
    videoOnly: true,
    outputPath: path.join(jobRoot, "hyperframes", "chunks", "frame-window.html")
  });
  const frameWindowHtml = fs.readFileSync(frameWindowBuild.outputPath, "utf8");
  assert.match(frameWindowHtml, /data-duration="1"/);
  assert.match(frameWindowHtml, /data-media-start="1"/);
  assert.doesNotMatch(frameWindowHtml, /<audio\b/);
  assert.match(frameWindowHtml, /data-caption-id="caption-inside"/);
  assert.doesNotMatch(frameWindowHtml, /caption-outside/);
  assert.doesNotMatch(frameWindowHtml, /<section hidden/);
  fs.writeFileSync(templatePath, passThroughTemplate);
  const twoFrameBuild = buildComposition(path.join(jobRoot, "hyperframes"), {
    startFrame: 0,
    endFrame: 2,
    videoOnly: true,
    outputPath: path.join(jobRoot, "hyperframes", "chunks", "two-frames.html")
  });
  const twoFrameDuration = Number(/data-composition-id="main"[^>]+data-duration="([^"]+)"/.exec(
    fs.readFileSync(twoFrameBuild.outputPath, "utf8")
  )?.[1]);
  assert.equal(Math.ceil(twoFrameDuration * 30), 2, "frame-window duration must not round up to an extra frame");

  const cacheKey = "a".repeat(64);
  const cacheDirectory = path.join(jobRoot, "hyperframes", "cache", "standard");
  const cacheArtifact = path.join(cacheDirectory, `${cacheKey}.mp4`);
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const synthetic = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=0.4",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    cacheArtifact
  ], { encoding: "utf8" });
  assert.equal(synthetic.status, 0, synthetic.stderr);
  const syntheticProbe = probeVideoArtifact(cacheArtifact);
  const receiptChunk = { startFrame: 0, endFrame: 12, standardKey: cacheKey, highKey: "b".repeat(64) };
  writeJsonAtomic(path.join(cacheDirectory, `${cacheKey}.receipt.json`), {
    renderKey: cacheKey,
    quality: "standard",
    expectedFrames: 12,
    artifactSha256: sha256File(cacheArtifact),
    actualFrames: syntheticProbe.actualFrames,
    width: syntheticProbe.width,
    height: syntheticProbe.height,
    streamSignature: syntheticProbe.streamSignature
  });
  assert.ok(validateCacheReceipt(jobRoot, "standard", receiptChunk));

  const secondChunk = path.join(cacheDirectory, `${"c".repeat(64)}.mp4`);
  const secondSynthetic = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=1080x1920:r=30:d=0.4",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    secondChunk
  ], { encoding: "utf8" });
  assert.equal(secondSynthetic.status, 0, secondSynthetic.stderr);
  const audioSource = path.join(jobRoot, "roughcut", "a-roll.mp4");
  fs.mkdirSync(path.dirname(audioSource), { recursive: true });
  const audioSynthetic = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=0.8",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    audioSource
  ], { encoding: "utf8" });
  assert.equal(audioSynthetic.status, 0, audioSynthetic.stderr);
  const secondProbe = probeVideoArtifact(secondChunk);
  const assemblyJob = path.join(temporaryRoot, "assembly-job");
  fs.cpSync(jobRoot, assemblyJob, { recursive: true });
  fs.rmSync(path.join(assemblyJob, "hyperframes", "mg"), { recursive: true, force: true });
  writeJsonAtomic(path.join(assemblyJob, "state", "beat-map.json"), {
    schemaVersion: "1.0.0",
    fps: 30,
    duration: 0.8,
    beats: []
  });
  writeJsonAtomic(path.join(assemblyJob, "state", "transcript.json"), { segments: [] });
  writeJsonAtomic(path.join(assemblyJob, "captions", "captions.json"), { cues: [] });
  const assemblyWorkflow = readJson(path.join(assemblyJob, "state", "workflow.json"));
  assemblyWorkflow.authoritativeMediaPath = "roughcut/a-roll.mp4";
  assemblyWorkflow.authoritativeMediaSha256 = sha256File(path.join(assemblyJob, "roughcut", "a-roll.mp4"));
  writeJsonAtomic(path.join(assemblyJob, "state", "workflow.json"), assemblyWorkflow);
  const assemblyManifest = deriveRenderManifest(assemblyJob);
  writeJsonAtomic(path.join(assemblyJob, "state", "render-manifest.json"), assemblyManifest);
  fs.mkdirSync(path.join(assemblyJob, "previews"), { recursive: true });
  const assembledPath = path.join(assemblyJob, "previews", "assembled.mp4");
  assembleChunks(assemblyJob, assemblyManifest, "standard", [
    { artifactPath: cacheArtifact, probe: syntheticProbe },
    { artifactPath: secondChunk, probe: secondProbe }
  ], assembledPath);
  const assembledProbe = probeVideoArtifact(assembledPath);
  assert.equal(assembledProbe.actualFrames, 24);
  assert.equal(assembledProbe.audioStreamCount, 1);
  assert.equal(
    verifyAssemblyReceipt(assemblyJob, "previews/assembled.mp4", assemblyManifest.contentManifestSha256).quality,
    "standard"
  );
  assert.throws(
    () => verifyAssemblyReceipt(assemblyJob, "previews/assembled.mp4", "0".repeat(64)),
    /differs from the approved standard preview/
  );
  const assemblyRaceJob = path.join(temporaryRoot, "assembly-race-job");
  fs.cpSync(assemblyJob, assemblyRaceJob, { recursive: true });
  const assemblyRaceManifest = deriveRenderManifest(assemblyRaceJob);
  writeJsonAtomic(path.join(assemblyRaceJob, "state", "render-manifest.json"), assemblyRaceManifest);
  const assemblyRaceOutput = path.join(assemblyRaceJob, "previews", "race-assembled.mp4");
  const mutatorPath = path.join(assemblyRaceJob, "assembly-mutator.cjs");
  const mutatorReadyPath = path.join(assemblyRaceJob, "assembly-mutator.ready");
  fs.writeFileSync(mutatorPath, `const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const ready = process.argv[3];
const previews = path.join(root, "previews");
fs.writeFileSync(ready, "ready");
const deadline = Date.now() + 10000;
const timer = setInterval(() => {
  const candidate = fs.readdirSync(previews).find((name) => /^race-assembled\\.mp4\\.\\d+\\.tmp\\.mp4$/.test(name));
  if (candidate) {
    fs.appendFileSync(path.join(root, "hyperframes", "caption.css"), "\\n/* changed during assembly */\\n");
    clearInterval(timer);
    process.exit(0);
  }
  if (Date.now() > deadline) process.exit(2);
}, 2);
`);
  const mutator = spawn(process.execPath, [mutatorPath, assemblyRaceJob, mutatorReadyPath], { stdio: "ignore" });
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  const readyDeadline = Date.now() + 2000;
  while (!fs.existsSync(mutatorReadyPath) && Date.now() < readyDeadline) Atomics.wait(waitBuffer, 0, 0, 5);
  assert.equal(fs.existsSync(mutatorReadyPath), true, "assembly mutator did not become ready");
  try {
    assert.throws(
      () => assembleChunks(assemblyRaceJob, assemblyRaceManifest, "standard", [
        { artifactPath: cacheArtifact, probe: syntheticProbe },
        { artifactPath: secondChunk, probe: secondProbe }
      ], assemblyRaceOutput),
      /Render inputs changed/
    );
    assert.equal(fs.existsSync(assemblyRaceOutput), false, "stale assembly candidate must not be promoted");
  } finally {
    mutator.kill();
  }
  const orphanKey = "9".repeat(64);
  fs.writeFileSync(path.join(cacheDirectory, `${orphanKey}.mp4`), "orphan");
  writeJsonAtomic(path.join(cacheDirectory, `${orphanKey}.receipt.json`), {});
  pruneChunkCache(jobRoot, [{ chunks: [receiptChunk] }]);
  assert.equal(fs.existsSync(path.join(cacheDirectory, `${orphanKey}.mp4`)), false);
  assert.equal(fs.existsSync(path.join(cacheDirectory, `${orphanKey}.receipt.json`)), false);
  assert.equal(fs.existsSync(cacheArtifact), true);
  fs.appendFileSync(cacheArtifact, "corrupt");
  assert.equal(validateCacheReceipt(jobRoot, "standard", receiptChunk), null);

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
  const assetRenderBaseline = deriveRenderManifest(jobRoot, { baselineManifest: renderManifest });
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "replacement asset");
  const assetPlan = compareMotionIndexes(assetBaseline, deriveMotionIndex(jobRoot));
  const assetRenderCurrent = deriveRenderManifest(jobRoot, { baselineManifest: renderManifest });
  assert.equal(assetPlan.kind, "delta");
  assert.deepEqual(assetPlan.changedBeatIds, ["beat-001"]);
  assert.notEqual(assetRenderCurrent.contentManifestSha256, assetRenderBaseline.contentManifestSha256);
  assert.notEqual(assetRenderCurrent.chunks[0].dependencySha256, assetRenderBaseline.chunks[0].dependencySha256);
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "test.png"), "test asset");
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"), "replaced media");
  assert.throws(
    () => deriveRenderManifest(jobRoot, { baselineManifest: renderManifest }),
    /authoritative media binding is stale/
  );
  const staleStandardMarker = path.join(jobRoot, "stale-standard-rendered");
  const localBinary = path.join(jobRoot, "hyperframes", "node_modules", ".bin", "hyperframes");
  fs.mkdirSync(path.dirname(localBinary), { recursive: true });
  fs.writeFileSync(localBinary, `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(staleStandardMarker)}, "rendered");
`);
  fs.chmodSync(localBinary, 0o755);
  const staleStandardOutput = path.join(jobRoot, "previews", "stale-standard.mp4");
  assert.throws(
    () => renderChunkedOutput(jobRoot, "standard", staleStandardOutput),
    /authoritative media binding is stale/
  );
  assert.equal(fs.existsSync(staleStandardOutput), false);
  assert.equal(fs.existsSync(staleStandardMarker), false, "Manifest integrity failure must stop before HyperFrames runs");
  fs.rmSync(path.join(jobRoot, "hyperframes", "node_modules"), { recursive: true, force: true });
  fs.writeFileSync(path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"), "media");

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
  assert.match(highRenderCommand, /render-chunks\.mjs \.\. high/);
  assert.equal(packageTemplate.scripts["render:delta"], packageTemplate.scripts["render:preview"]);

  const cacheRaceJob = path.join(temporaryRoot, "cache-race-job");
  fs.cpSync(jobRoot, cacheRaceJob, { recursive: true });
  fs.rmSync(path.join(cacheRaceJob, "hyperframes", "mg"), { recursive: true, force: true });
  writeJsonAtomic(path.join(cacheRaceJob, "state", "beat-map.json"), {
    schemaVersion: "1.0.0",
    fps: 1,
    duration: 24,
    beats: []
  });
  writeJsonAtomic(path.join(cacheRaceJob, "state", "transcript.json"), { segments: [] });
  writeJsonAtomic(path.join(cacheRaceJob, "captions", "captions.json"), { cues: [] });
  const raceMediaPath = path.join(cacheRaceJob, "hyperframes", "assets", "input-video.mp4");
  const raceWorkflow = readJson(path.join(cacheRaceJob, "state", "workflow.json"));
  raceWorkflow.authoritativeMediaSha256 = sha256File(raceMediaPath);
  writeJsonAtomic(path.join(cacheRaceJob, "state", "workflow.json"), raceWorkflow);
  const raceManifest = deriveRenderManifest(cacheRaceJob);
  assert.equal(raceManifest.chunks.length, 2);
  const fakeFrameSource = path.join(cacheRaceJob, "hyperframes", "fake-chunk.mp4");
  const fakeFrames = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=1:d=12",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    fakeFrameSource
  ], { encoding: "utf8" });
  assert.equal(fakeFrames.status, 0, fakeFrames.stderr);
  const fakeBinary = path.join(cacheRaceJob, "hyperframes", "node_modules", ".bin", "hyperframes");
  fs.mkdirSync(path.dirname(fakeBinary), { recursive: true });
  fs.writeFileSync(fakeBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argumentsList = process.argv.slice(2);
const output = argumentsList[argumentsList.indexOf("--output") + 1];
const root = path.resolve(__dirname, "..", "..");
const counterPath = path.join(root, "fake-render-count");
const count = fs.existsSync(counterPath) ? Number(fs.readFileSync(counterPath, "utf8")) : 0;
fs.copyFileSync(path.join(root, "fake-chunk.mp4"), output);
fs.writeFileSync(counterPath, String(count + 1));
if (count === 1) fs.appendFileSync(path.join(root, "caption.css"), "\\n/* changed during render */\\n");
`);
  fs.chmodSync(fakeBinary, 0o755);
  assert.throws(
    () => renderChunkedOutput(cacheRaceJob, "standard", path.join(cacheRaceJob, "previews", "race.mp4")),
    /Render inputs changed/
  );
  for (const chunk of raceManifest.chunks) {
    const key = chunk.standardKey;
    assert.equal(fs.existsSync(path.join(cacheRaceJob, "hyperframes", "cache", "standard", `${key}.mp4`)), false);
    assert.equal(fs.existsSync(path.join(cacheRaceJob, "hyperframes", "cache", "standard", `${key}.receipt.json`)), false);
  }

  const cacheRecoveryJob = path.join(temporaryRoot, "cache-recovery-job");
  fs.cpSync(assemblyJob, cacheRecoveryJob, { recursive: true });
  writeJsonAtomic(path.join(cacheRecoveryJob, "state", "beat-map.json"), {
    schemaVersion: "1.0.0",
    fps: 1,
    duration: 24,
    beats: []
  });
  const recoveryMediaPath = path.join(cacheRecoveryJob, "roughcut", "a-roll.mp4");
  const recoveryMedia = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=1:d=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=24",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    recoveryMediaPath
  ], { encoding: "utf8" });
  assert.equal(recoveryMedia.status, 0, recoveryMedia.stderr);
  fs.copyFileSync(recoveryMediaPath, path.join(cacheRecoveryJob, "hyperframes", "assets", "input-video.mp4"));
  const recoveryWorkflow = readJson(path.join(cacheRecoveryJob, "state", "workflow.json"));
  recoveryWorkflow.authoritativeMediaPath = "roughcut/a-roll.mp4";
  recoveryWorkflow.authoritativeMediaSha256 = sha256File(recoveryMediaPath);
  writeJsonAtomic(path.join(cacheRecoveryJob, "state", "workflow.json"), recoveryWorkflow);
  writeJsonAtomic(path.join(cacheRecoveryJob, "captions", "captions.json"), {
    cues: [
      { id: "recovery-caption-1", text: "第一条", lines: ["第一条"], start: 2, end: 4 },
      { id: "recovery-caption-2", text: "第二条", lines: ["第二条"], start: 14, end: 16 }
    ]
  });
  const recoveryTemplatePath = path.join(cacheRecoveryJob, "hyperframes", "index.template.html");
  const recoveryTemplate = fs.readFileSync(recoveryTemplatePath, "utf8").replace(
    "<!-- CUT_MOTION_CAPTIONS_START -->",
    `<!-- CUT_MOTION_CAPTIONS_START -->
      <section class="clip motion-caption-layer" data-caption-id="recovery-caption-1" data-start="2" data-duration="2"><p class="motion-caption-line">第一条</p></section>
      <section class="clip motion-caption-layer" data-caption-id="recovery-caption-2" data-start="14" data-duration="2"><p class="motion-caption-line">第二条</p></section>`
  );
  fs.writeFileSync(recoveryTemplatePath, recoveryTemplate);
  const captionCacheBaseline = deriveRenderManifest(cacheRecoveryJob);
  const changedRecoveryCaptions = readJson(path.join(cacheRecoveryJob, "captions", "captions.json"));
  changedRecoveryCaptions.cues[0].text = "第一条已修改";
  changedRecoveryCaptions.cues[0].lines = ["第一条已修改"];
  writeJsonAtomic(path.join(cacheRecoveryJob, "captions", "captions.json"), changedRecoveryCaptions);
  fs.writeFileSync(recoveryTemplatePath, recoveryTemplate.replaceAll("第一条", "第一条已修改"));
  const captionCacheCurrent = deriveRenderManifest(cacheRecoveryJob, { baselineManifest: captionCacheBaseline });
  assert.notEqual(captionCacheCurrent.chunks[0].standardKey, captionCacheBaseline.chunks[0].standardKey);
  assert.equal(
    captionCacheCurrent.chunks[1].standardKey,
    captionCacheBaseline.chunks[1].standardKey,
    "editing one caption cue must not invalidate an unrelated Chunk"
  );
  const recoveryManifest = deriveRenderManifest(cacheRecoveryJob);
  assert.equal(recoveryManifest.chunks.length, 2);
  writeJsonAtomic(path.join(cacheRecoveryJob, "state", "render-manifest.json"), recoveryManifest);
  const recoveryGoodChunk = path.join(cacheRecoveryJob, "hyperframes", "recovery-good-chunk.mp4");
  const recoveryBadChunk = path.join(cacheRecoveryJob, "hyperframes", "recovery-bad-chunk.mp4");
  for (const [target, profile] of [[recoveryGoodChunk, "high"], [recoveryBadChunk, "baseline"]]) {
    const generated = spawnSync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "color=c=blue:s=1080x1920:r=1:d=12",
      "-an", "-c:v", "libx264", "-profile:v", profile, "-pix_fmt", "yuv420p",
      target
    ], { encoding: "utf8" });
    assert.equal(generated.status, 0, generated.stderr);
  }
  const recoveryGoodProbe = probeVideoArtifact(recoveryGoodChunk);
  const recoveryBadProbe = probeVideoArtifact(recoveryBadChunk);
  assert.notDeepEqual(recoveryBadProbe.streamSignature, recoveryGoodProbe.streamSignature);
  const conflictingChunk = recoveryManifest.chunks[0];
  const conflictingPaths = {
    artifactPath: path.join(cacheRecoveryJob, "hyperframes", "cache", "standard", `${conflictingChunk.standardKey}.mp4`),
    receiptPath: path.join(cacheRecoveryJob, "hyperframes", "cache", "standard", `${conflictingChunk.standardKey}.receipt.json`)
  };
  fs.mkdirSync(path.dirname(conflictingPaths.artifactPath), { recursive: true });
  fs.copyFileSync(recoveryBadChunk, conflictingPaths.artifactPath);
  writeJsonAtomic(conflictingPaths.receiptPath, {
    schemaVersion: "1.0.0",
    renderKey: conflictingChunk.standardKey,
    quality: "standard",
    startFrame: conflictingChunk.startFrame,
    endFrame: conflictingChunk.endFrame,
    expectedFrames: conflictingChunk.endFrame - conflictingChunk.startFrame,
    artifactSha256: sha256File(conflictingPaths.artifactPath),
    actualFrames: recoveryBadProbe.actualFrames,
    width: recoveryBadProbe.width,
    height: recoveryBadProbe.height,
    streamSignature: recoveryBadProbe.streamSignature
  });
  const recoveryBinary = path.join(cacheRecoveryJob, "hyperframes", "node_modules", ".bin", "hyperframes");
  fs.mkdirSync(path.dirname(recoveryBinary), { recursive: true });
  fs.writeFileSync(recoveryBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argumentsList = process.argv.slice(2);
const output = argumentsList[argumentsList.indexOf("--output") + 1];
const composition = argumentsList[argumentsList.indexOf("--composition") + 1];
const root = path.resolve(__dirname, "..", "..");
fs.copyFileSync(
  composition === "index.html" ? path.join(root, "..", "roughcut", "a-roll.mp4") : path.join(root, "recovery-good-chunk.mp4"),
  output
);
`);
  fs.chmodSync(recoveryBinary, 0o755);
  const firstRecovery = renderChunkedOutput(
    cacheRecoveryJob,
    "standard",
    path.join(cacheRecoveryJob, "previews", "recovery-first.mp4")
  );
  assert.equal(firstRecovery.fallback, true);
  for (const chunk of recoveryManifest.chunks) {
    assert.equal(
      fs.existsSync(path.join(cacheRecoveryJob, "hyperframes", "cache", "standard", `${chunk.standardKey}.mp4`)),
      false,
      "signature-conflicting round must evict every participating cache entry"
    );
  }
  const secondRecovery = renderChunkedOutput(
    cacheRecoveryJob,
    "standard",
    path.join(cacheRecoveryJob, "previews", "recovery-second.mp4")
  );
  assert.equal(secondRecovery.fallback, false, "the next run must recover through fresh compatible Chunk renders");
  assert.equal(secondRecovery.renderedChunks, 2);

  const fallbackContractJob = path.join(temporaryRoot, "fallback-contract-job");
  fs.cpSync(cacheRecoveryJob, fallbackContractJob, { recursive: true });
  const fallbackTemplatePath = path.join(fallbackContractJob, "hyperframes", "index.template.html");
  fs.writeFileSync(
    fallbackTemplatePath,
    fs.readFileSync(fallbackTemplatePath, "utf8").replace('data-volume="1"', 'data-volume="0.5"')
  );
  const wrongFallbackPath = path.join(fallbackContractJob, "hyperframes", "wrong-fallback.mp4");
  const wrongFallback = spawnSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=black:s=720x1280:r=1:d=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=24",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    wrongFallbackPath
  ], { encoding: "utf8" });
  assert.equal(wrongFallback.status, 0, wrongFallback.stderr);
  const fallbackBinary = path.join(fallbackContractJob, "hyperframes", "node_modules", ".bin", "hyperframes");
  fs.writeFileSync(fallbackBinary, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argumentsList = process.argv.slice(2);
const output = argumentsList[argumentsList.indexOf("--output") + 1];
const root = path.resolve(__dirname, "..", "..");
fs.copyFileSync(path.join(root, "wrong-fallback.mp4"), output);
`);
  fs.chmodSync(fallbackBinary, 0o755);
  const wrongFallbackOutput = path.join(fallbackContractJob, "previews", "wrong-fallback-output.mp4");
  assert.throws(
    () => renderChunkedOutput(fallbackContractJob, "standard", wrongFallbackOutput),
    /dimensions differ from Render Manifest/
  );
  assert.equal(fs.existsSync(wrongFallbackOutput), false);

  console.log("Incremental revision tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
