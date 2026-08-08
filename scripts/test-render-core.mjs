import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { deriveMotionIndex } from "./motion-index.mjs";
import { deriveRenderManifest, resolveRenderMode, unsafeRenderIntervals } from "./render-manifest.mjs";
import {
  assertPinnedArtifacts,
  pinRenderedArtifacts,
  probeVideoArtifact,
  promoteRenderedCandidate,
  renderOutput,
  renderChunkedOutput,
  validateCacheReceipt,
  verifyAssemblyReceipt
} from "./render-chunks.mjs";
import { readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-render-core-"));
const jobRoot = path.join(temporaryRoot, "job");
const write = (relativePath, content) => {
  const target = path.join(jobRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
};
const writeJson = (relativePath, value) => write(relativePath, `${JSON.stringify(value, null, 2)}\n`);

try {
  const mediaPath = write("hyperframes/assets/a-roll.mp4", "authoritative-media");
  const captionSection = '<section class="clip motion-caption-layer" data-caption-id="cue-1" data-caption-start-frame="60" data-caption-end-frame="90" data-start="2" data-duration="1"><p>测试</p></section>';
  const template = (section = captionSection) => `<!doctype html>
<link rel="stylesheet" href="./extra.css">
<style>.poster{background-image:image-set("./assets/background.png" 1x)}</style>
<audio id="source-audio" src="./assets/a-roll.mp4"></audio>
<video poster="./assets/poster.png" srcset="./assets/one.png 1x, ./assets/two.png 2x"></video>
<!-- CUT_MOTION_CAPTIONS_START -->${section}<!-- CUT_MOTION_CAPTIONS_END -->`;
  write("hyperframes/assets/poster.png", "poster");
  write("hyperframes/assets/one.png", "one");
  write("hyperframes/assets/two.png", "two");
  write("hyperframes/assets/background.png", "background");
  write("hyperframes/assets/nested.png", "nested");
  write("hyperframes/extra.css", '@import "./nested.css";\n');
  write("hyperframes/nested.css", '.nested{background-image:url("./assets/nested.png")}\n');
  write("hyperframes/index.template.html", template());
  writeJson("hyperframes/package.json", {
    private: true,
    devDependencies: { gsap: "3.13.0", hyperframes: "0.7.60" }
  });
  writeJson("hyperframes/node_modules/hyperframes/package.json", {
    version: "0.7.60",
    bin: { hyperframes: "dist/cli.js" }
  });
  const cliPath = write("hyperframes/node_modules/hyperframes/dist/cli.js", "#!/usr/bin/env node\n");
  fs.chmodSync(cliPath, 0o755);
  const binDirectory = path.join(jobRoot, "hyperframes/node_modules/.bin");
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.symlinkSync(path.relative(binDirectory, cliPath), path.join(binDirectory, "hyperframes"));
  writeJson("state/transcript.json", { segments: [] });
  writeJson("state/beat-map.json", {
    fps: 30,
    duration: 30,
    beats: [
      { id: "beat-a", start: 0, end: 3, axis: "A", reuseGroup: "shared" },
      { id: "beat-b", start: 3, end: 6, axis: "A", reuseGroup: "shared" }
    ]
  });
  writeJson("captions/captions.json", {
    cues: [{ id: "cue-1", start: 2, end: 3, startFrame: 60, endFrame: 90, text: "测试", lines: ["测试"] }]
  });
  writeJson("state/workflow.json", {
    authoritativeMediaPath: "hyperframes/assets/a-roll.mp4",
    authoritativeMediaSha256: sha256File(mediaPath),
    captionMode: "subtitles"
  });
  writeJson("state/design-system.json", { canvas: { width: 1080, height: 1920 } });
  writeJson("state/creative-confirmation.json", { visualAxisMode: "a-axis-overlay" });

  const manifest = deriveRenderManifest(jobRoot, { designLanguageFingerprint: "design-v1" });
  assert.equal(manifest.schemaVersion, "2.0.0");
  assert.ok(manifest.beats.every((beat) => beat.window && beat.fingerprint));
  assert.ok(manifest.captions.every((cue) => cue.window && cue.fingerprint));
  assert.ok(manifest.chunks.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.cacheKey)));
  assert.ok(manifest.chunks.every((chunk) => !("standardKey" in chunk) && !("highKey" in chunk)));
  writeJson("captions/captions.json", {
    cues: [{ id: "cue-1", start: 2, end: 3, text: "测试", lines: ["测试"] }]
  });
  assert.throws(() => deriveRenderManifest(jobRoot), /half-open integer frame window/);
  writeJson("captions/captions.json", {
    cues: [{ id: "cue-1", start: 2, end: 3, startFrame: 60, endFrame: 90, text: "测试", lines: ["测试"] }]
  });
  write("hyperframes/index.template.html", template(`${captionSection}<div>untracked caption content</div>`));
  assert.throws(() => deriveRenderManifest(jobRoot), /content outside caption sections/);
  write("hyperframes/index.template.html", template());
  write("hyperframes/index.template.html", template(captionSection.replace("测试", "篡改")));
  const installedCaptionRevision = deriveRenderManifest(jobRoot, {
    baselineManifest: manifest,
    designLanguageFingerprint: "design-v1"
  });
  assert.deepEqual(
    installedCaptionRevision.chunks.map((chunk, index) => chunk.cacheKey !== manifest.chunks[index].cacheKey),
    manifest.chunks.map((chunk) => chunk.captionCueIds.includes("cue-1"))
  );
  write("hyperframes/index.template.html", template(""));
  assert.throws(() => deriveRenderManifest(jobRoot), /caption section count/);
  write("hyperframes/index.template.html", template(`${captionSection}${captionSection}`));
  assert.throws(() => deriveRenderManifest(jobRoot), /Duplicate installed caption section/);
  write("hyperframes/index.template.html", template());
  write("hyperframes/index.template.html", template(captionSection.replace('data-caption-start-frame="60"', 'data-caption-start-frame="59"')));
  assert.throws(() => deriveRenderManifest(jobRoot), /timing differs from captions\.json/);
  write("hyperframes/index.template.html", template(captionSection.replace('data-start="2"', 'data-start="2.1"')));
  assert.throws(() => deriveRenderManifest(jobRoot), /timing differs from captions\.json/);
  write("hyperframes/index.template.html", template());
  for (const [filename, original] of [
    ["poster.png", "poster"],
    ["one.png", "one"],
    ["two.png", "two"],
    ["background.png", "background"],
    ["nested.png", "nested"]
  ]) {
    fs.writeFileSync(path.join(jobRoot, "hyperframes/assets", filename), `${original}-replaced`);
    assert.ok(deriveRenderManifest(jobRoot, {
      baselineManifest: manifest,
      designLanguageFingerprint: "design-v1"
    }).chunks.every((chunk, index) => chunk.cacheKey !== manifest.chunks[index].cacheKey));
    fs.writeFileSync(path.join(jobRoot, "hyperframes/assets", filename), original);
  }
  write("hyperframes/index.template.html", `${template()}<script>fetch("./assets/one.png")</script>`);
  assert.throws(() => deriveRenderManifest(jobRoot), /Dynamic media references are unsupported/);
  write("hyperframes/index.template.html", template().replace("./assets/poster.png", "https://example.invalid/poster.png"));
  assert.throws(() => deriveRenderManifest(jobRoot), /Remote render resources must be localized/);
  write("hyperframes/index.template.html", template());
  const raceManifest = deriveRenderManifest(jobRoot);
  const raceCandidate = write("previews/race.tmp.mp4", "candidate");
  const raceOutput = path.join(jobRoot, "previews/race.mp4");
  fs.writeFileSync(path.join(jobRoot, "hyperframes/assets/poster.png"), "changed-during-promotion");
  assert.throws(
    () => promoteRenderedCandidate(jobRoot, raceManifest, raceCandidate, raceOutput),
    /Render inputs changed/
  );
  assert.ok(fs.existsSync(raceCandidate) && !fs.existsSync(raceOutput));
  fs.unlinkSync(raceCandidate);
  fs.writeFileSync(path.join(jobRoot, "hyperframes/assets/poster.png"), "poster");
  writeJson("captions/captions.json", {
    cues: [{ id: "cue-1", start: 2, end: 3, startFrame: 60, endFrame: 90, text: "已修改", lines: ["已修改"] }]
  });
  const captionRevision = deriveRenderManifest(jobRoot, {
    baselineManifest: manifest,
    designLanguageFingerprint: "design-v1"
  });
  assert.deepEqual(
    captionRevision.chunks.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    manifest.chunks.map(({ startFrame, endFrame }) => [startFrame, endFrame])
  );
  assert.deepEqual(
    captionRevision.chunks.map((chunk, index) => chunk.cacheKey !== manifest.chunks[index].cacheKey),
    manifest.chunks.map((chunk) => chunk.captionCueIds.includes("cue-1"))
  );
  writeJson("captions/captions.json", {
    cues: [{ id: "cue-1", start: 2, end: 3, startFrame: 60, endFrame: 90, text: "测试", lines: ["测试"] }]
  });
  const anchoredBeatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
  Object.assign(anchoredBeatMap.beats[0], {
    mgScope: "local",
    entryAnchorWordId: "segment-001:word-001",
    exitAnchorWordId: "segment-001:word-002",
    exitAnchorOffsetFrames: 0,
    exitFrames: 3
  });
  writeJson("state/beat-map.json", anchoredBeatMap);
  writeJson("state/transcript.json", {
    segments: [{
      id: "segment-001",
      words: [
        { text: "一", start: 0.1, end: 0.2 },
        { text: "二", start: 2.4, end: 2.5 }
      ]
    }]
  });
  write("hyperframes/assets/module.png", "module-asset");
  write("hyperframes/mg/beat-a/fragment.html", '<div data-beat-id="beat-a"><img src="./assets/module.png"></div>');
  write("hyperframes/mg/beat-a/style.css", '.image { background: url("./assets/module.png"); }');
  write("hyperframes/mg/beat-a/timeline.mjs", "timeline.set(root, { autoAlpha: 1 }, beat.entryAnchorTime);");
  const anchoredManifest = deriveRenderManifest(jobRoot, { designLanguageFingerprint: "design-v1" });
  const shiftedTranscript = readJson(path.join(jobRoot, "state", "transcript.json"));
  shiftedTranscript.segments[0].words[0].start = 0.105;
  writeJson("state/transcript.json", shiftedTranscript);
  const shiftedAnchorManifest = deriveRenderManifest(jobRoot, {
    baselineManifest: anchoredManifest,
    designLanguageFingerprint: "design-v1"
  });
  assert.deepEqual(
    shiftedAnchorManifest.chunks.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    anchoredManifest.chunks.map(({ startFrame, endFrame }) => [startFrame, endFrame])
  );
  assert.notEqual(
    shiftedAnchorManifest.beats.find((beat) => beat.beatId === "beat-a").fingerprint,
    anchoredManifest.beats.find((beat) => beat.beatId === "beat-a").fingerprint,
    "same-frame word-anchor changes must invalidate the rendered Beat"
  );
  assert.deepEqual(
    unsafeRenderIntervals(
      { fps: 30, duration: 30, beats: [
        { id: "a", start: 0, end: 2, axis: "A", reuseGroup: "same" },
        { id: "b", start: 2, end: 4, axis: "A", reuseGroup: "same" }
      ] },
      { fps: 30, totalFrames: 900, beats: [], captions: [] }
    ),
    [],
    "reuseGroup must not create a continuous no-cut interval"
  );
  const locator = deriveMotionIndex(jobRoot);
  assert.equal(locator.schemaVersion, "2.0.0");
  assert.ok(!("sourceHashes" in locator) && !("sharedDependencySha256" in locator));

  fs.appendFileSync(cliPath, "// runtime changed\n");
  const changedRuntime = deriveRenderManifest(jobRoot, {
    baselineManifest: manifest,
    designLanguageFingerprint: "design-v1"
  });
  assert.notEqual(changedRuntime.chunks[0].cacheKey, manifest.chunks[0].cacheKey);

  const chunk = manifest.chunks[0];
  const cacheDirectory = path.join(jobRoot, "hyperframes/cache/standard");
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const cacheArtifact = write(`hyperframes/cache/standard/${chunk.cacheKey}.mp4`, "cache-artifact");
  writeJson(`hyperframes/cache/standard/${chunk.cacheKey}.receipt.json`, {
    schemaVersion: "2.0.0",
    cacheKey: chunk.cacheKey,
    quality: "standard",
    chunkDependencySha256: chunk.dependencySha256,
    artifactSha256: sha256File(cacheArtifact),
    frameCount: chunk.endFrame - chunk.startFrame,
    streamSignature: { codec: "h264", width: 1080, height: 1920 }
  });
  const cachedChunk = validateCacheReceipt(jobRoot, "standard", chunk);
  assert.ok(cachedChunk);
  assert.equal(validateCacheReceipt(jobRoot, "high", chunk), null);
  const pinnedDirectory = path.join(jobRoot, "hyperframes", "chunks", "pin-test");
  fs.mkdirSync(pinnedDirectory, { recursive: true });
  const pinned = pinRenderedArtifacts(pinnedDirectory, [cachedChunk]);
  fs.renameSync(cacheArtifact, `${cacheArtifact}.original`);
  fs.writeFileSync(cacheArtifact, "replacement-at-original-path");
  assert.doesNotThrow(() => assertPinnedArtifacts(pinned), "atomic path replacement must not alter the pinned inode");
  fs.appendFileSync(pinned[0].pinnedPath, "in-place-tamper");
  assert.throws(() => assertPinnedArtifacts(pinned), /changed during assembly/);

  assert.throws(
    () => renderChunkedOutput(jobRoot, "standard", path.join(jobRoot, "state", "preview.mp4")),
    /standard render output must be a direct MP4 child of previews/
  );
  assert.throws(
    () => renderChunkedOutput(jobRoot, "high", path.join(jobRoot, "previews", "delivery.mp4")),
    /high render output must be a direct MP4 child of output/
  );

  const outputPath = path.join(jobRoot, "previews/standard-output.mp4");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const receiptRender = spawnSync("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "color=black:s=160x284:r=30:d=1",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    outputPath
  ], { encoding: "utf8" });
  assert.equal(receiptRender.status, 0, receiptRender.stderr);
  const receiptProbe = probeVideoArtifact(outputPath);
  writeJson("state/render-manifest.json", {
    contentManifestSha256: manifest.contentManifestSha256,
    totalFrames: receiptProbe.actualFrames,
    fps: 30,
    width: receiptProbe.width,
    height: receiptProbe.height
  });
  writeJsonAtomic(`${outputPath}.render.json`, {
    schemaVersion: "2.0.0",
    quality: "standard",
    mode: "chunked",
    artifactSha256: sha256File(outputPath),
    contentManifestSha256: manifest.contentManifestSha256,
    totalFrames: receiptProbe.actualFrames,
    streamSignature: receiptProbe.streamSignature
  });
  assert.equal(verifyAssemblyReceipt(jobRoot, "previews/standard-output.mp4", {
    quality: "standard",
    contentManifestSha256: manifest.contentManifestSha256
  }).mode, "chunked");
  assert.throws(
    () => verifyAssemblyReceipt(jobRoot, "previews/standard-output.mp4", { quality: "high" }),
    /Expected high/
  );
  const staleReceipt = readJson(`${outputPath}.render.json`);
  staleReceipt.streamSignature.pixelFormat = "yuv444p";
  writeJsonAtomic(`${outputPath}.render.json`, staleReceipt);
  assert.throws(
    () => verifyAssemblyReceipt(jobRoot, "previews/standard-output.mp4"),
    /stream signature is stale/
  );

  assert.equal(resolveRenderMode("auto", 30), "monolithic");
  assert.equal(resolveRenderMode("chunked", 30), "chunked");
  writeJson("state/beat-map.json", { fps: 30, duration: 30, beats: [] });
  writeJson("captions/captions.json", { cues: [] });
  fs.rmSync(path.join(jobRoot, "hyperframes/mg"), { recursive: true, force: true });
  write("hyperframes/index.template.html", `${template("")}
<style>/* CUT_MOTION_MG_STYLES */</style>
<main><!-- CUT_MOTION_MG_FRAGMENTS --></main>
<script>/* CUT_MOTION_MG_TIMELINES */
/* CUT_MOTION_CONTENT_COLLISION */</script>`);
  writeJson("state/design-system.json", { canvas: { width: 160, height: 284 } });
  const renderLogPath = path.join(jobRoot, "render-invocations.log");
  writeJson("state/workflow.json", {
    authoritativeMediaPath: "hyperframes/assets/a-roll.mp4",
    authoritativeMediaSha256: sha256File(mediaPath),
    captionMode: "subtitles",
    mode: "review",
    roughCutReviewDecision: "manual-approved"
  });
  fs.writeFileSync(cliPath, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const output = process.argv[process.argv.indexOf("--output") + 1];
fs.appendFileSync(${JSON.stringify(renderLogPath)}, "render\\n");
const result = spawnSync("ffmpeg", [
  "-v", "error", "-f", "lavfi", "-i", "color=black:s=160x284:r=30:d=30",
  "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=30", "-t", "30", "-shortest",
  "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", output
], { stdio: "inherit" });
process.exit(result.status ?? 1);
`);
  fs.chmodSync(cliPath, 0o755);
  const defaultOutput = path.join(jobRoot, "previews", "default.mp4");
  const defaultRender = renderOutput(jobRoot, "standard", defaultOutput);
  assert.equal(defaultRender.mode, "monolithic");
  assert.deepEqual(defaultRender.manifest.chunks.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 900]]);
  assert.equal(fs.readFileSync(renderLogPath, "utf8").trim().split("\n").length, 1);
  assert.equal(defaultRender.receipt, null);
  assert.equal(fs.existsSync(`${defaultOutput}.render.json`), false);

  const reviewHighOutput = path.join(jobRoot, "output/review-high.mp4");
  const reviewHighRender = renderOutput(jobRoot, "high", reviewHighOutput);
  assert.equal(reviewHighRender.receipt, null);
  assert.equal(fs.existsSync(`${reviewHighOutput}.render.json`), false);

  const auditWorkflow = readJson(path.join(jobRoot, "state/workflow.json"));
  auditWorkflow.mode = "auto";
  writeJson("state/workflow.json", auditWorkflow);
  const auditOutput = path.join(jobRoot, "previews/audit.mp4");
  const auditRender = renderOutput(jobRoot, "standard", auditOutput);
  assert.equal(auditRender.receipt.mode, "monolithic");
  assert.equal(verifyAssemblyReceipt(jobRoot, "previews/audit.mp4", { quality: "standard" }).mode, "monolithic");

  console.log("Render core tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
