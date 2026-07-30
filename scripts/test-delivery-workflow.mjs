import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComposition } from "./build-composition.mjs";
import { renderChunkedOutput } from "./render-chunks.mjs";
import {
  computeCreativeAuthorities,
  computeCreativeDocumentFingerprints,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const [fontPath] = process.argv.slice(2);
if (!fontPath || !path.isAbsolute(fontPath) || !fs.existsSync(fontPath)) {
  console.error("Usage: node scripts/test-delivery-workflow.mjs <absolute-font.woff2>");
  process.exit(64);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-delivery-"));
const jobRoot = path.join(temporaryRoot, "job");
const run = (command, argumentsList, options = {}) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};
const script = (name, argumentsList) => run(process.execPath, [path.join(repositoryRoot, "scripts", name), ...argumentsList]);
const workflowPath = path.join(jobRoot, "state", "workflow.json");

try {
  const source = path.join(temporaryRoot, "source.mp4");
  run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=s=270x480:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "3.2", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    source
  ]);
  execFileSync(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [
    jobRoot,
    source,
    "review",
    "subtitles"
  ], { stdio: "pipe" });
  const reusableJob = path.resolve(path.dirname(fontPath), "../../..");
  const reusableModules = path.join(reusableJob, "hyperframes", "node_modules");
  if (fs.existsSync(path.join(reusableModules, "hyperframes"))
    && fs.existsSync(path.join(reusableModules, "gsap"))) {
    const targetModules = path.join(jobRoot, "hyperframes", "node_modules");
    fs.mkdirSync(targetModules, { recursive: true });
    for (const packageName of ["hyperframes", "gsap"]) {
      fs.symlinkSync(path.join(reusableModules, packageName), path.join(targetModules, packageName), "dir");
    }
    fs.mkdirSync(path.join(targetModules, ".bin"), { recursive: true });
    fs.symlinkSync("../hyperframes/dist/cli.js", path.join(targetModules, ".bin", "hyperframes"));
    fs.copyFileSync(
      path.join(reusableJob, "hyperframes", "assets", "gsap.min.js"),
      path.join(jobRoot, "hyperframes", "assets", "gsap.min.js")
    );
  } else {
    execFileSync("bash", [path.join(repositoryRoot, "scripts", "check-environment.sh"), "install-job", jobRoot, "--yes"], {
      stdio: "pipe"
    });
  }
  fs.mkdirSync(path.join(jobRoot, "hyperframes", "assets", "fonts"), { recursive: true });
  fs.copyFileSync(fontPath, path.join(jobRoot, "hyperframes", "assets", "fonts", "smiley-sans-oblique.woff2"));
  fs.copyFileSync(path.join(jobRoot, "input", "source.mp4"), path.join(jobRoot, "hyperframes", "assets", "input-video.mp4"));

  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "transcript.example.json"),
    path.join(jobRoot, "state", "transcript.json")
  );
  const beatMap = readJson(path.join(repositoryRoot, "examples", "beat-map.subtitles.example.json"));
  for (const beat of beatMap.beats) {
    Object.assign(beat, { mgScope: "none", recipe: "caption-only", axis: "A", components: [], microEvents: [] });
  }
  writeJsonAtomic(path.join(jobRoot, "state", "beat-map.json"), beatMap);
  const captionPlan = readJson(path.join(repositoryRoot, "examples", "caption-review-plan.example.json"));
  captionPlan.status = "approved";
  captionPlan.approvedAt = new Date().toISOString();
  writeJsonAtomic(path.join(jobRoot, "captions", "caption-review-plan.json"), captionPlan);
  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "chatcut-caption-pages.example.json"),
    path.join(jobRoot, "captions", "chatcut-pages.json")
  );
  fs.copyFileSync(
    path.join(repositoryRoot, "examples", "captions.approved-semantic.example.json"),
    path.join(jobRoot, "captions", "captions.json")
  );
  script("install-captions.mjs", [
    path.join(jobRoot, "captions", "captions.json"),
    path.join(jobRoot, "hyperframes", "index.html"),
    path.join(jobRoot, "state", "design-system.json")
  ]);

  const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
  const reconciliationItemsPath = path.join(jobRoot, "state", "reconciliation-items.fixture.json");
  writeJsonAtomic(reconciliationItemsPath, transcript.segments.map((segment, index) => ({
    id: `speech-${index + 1}`,
    type: "speech-only",
    segmentId: segment.id,
    start: segment.start,
    end: segment.end,
    referenceText: null,
    heardText: segment.text,
    resolution: "accepted-speech",
    releaseImpact: true,
    confidence: segment.confidence ?? 1,
    evidence: { audioChecked: true, supportsReference: false, note: "Runtime fixture" }
  })));
  script("create-transcript-reconciliation.mjs", [jobRoot, "input/source.mp4", reconciliationItemsPath]);

  const confirmationPath = path.join(jobRoot, "state", "creative-confirmation.json");
  const confirmation = readJson(confirmationPath);
  confirmation.visualAxisMode = "a-axis-overlay";
  confirmation.storyboard.beatCount = beatMap.beats.length;
  confirmation.review = {
    status: "approved",
    actor: "user",
    decidedAt: new Date().toISOString(),
    note: "runtime fixture"
  };
  confirmation.authorities = computeCreativeAuthorities(jobRoot, "subtitles");
  writeJsonAtomic(confirmationPath, confirmation);

  const composition = buildComposition(path.join(jobRoot, "hyperframes"));
  const workflow = readJson(workflowPath);
  workflow.currentState = "qa";
  workflow.pendingGate = null;
  workflow.referenceScriptStatus = "none";
  workflow.referenceScriptAcknowledged = true;
  workflow.visualAxisMode = "a-axis-overlay";
  workflow.visualAxisModeSource = "user";
  workflow.visualAxisModeAcknowledged = true;
  workflow.authoritativeMediaPath = "input/source.mp4";
  workflow.authoritativeMediaSha256 = sha256File(path.join(jobRoot, "input", "source.mp4"));
  workflow.trimPlanSha256 = sha256File(path.join(jobRoot, "state", "trim-plan.json"));
  workflow.visualPlanSha256 = sha256File(path.join(jobRoot, "state", "beat-map.json"));
  workflow.compositionArtifactPath = "hyperframes/index.html";
  workflow.compositionArtifactSha256 = sha256File(composition.outputPath);
  workflow.creativeConfirmationSha256 = sha256File(confirmationPath);
  workflow.creativeDocumentFingerprints = computeCreativeDocumentFingerprints(jobRoot, "subtitles");
  writeJsonAtomic(workflowPath, workflow);

  const revisionWorkflow = structuredClone(workflow);
  revisionWorkflow.currentState = "final-preview";
  revisionWorkflow.pendingGate = "final-preview";
  revisionWorkflow.gates["final-preview"] = {
    status: "pending",
    artifact: "previews/final-preview.mp4",
    revisionId: revisionWorkflow.revisionId
  };
  writeJsonAtomic(workflowPath, revisionWorkflow);
  const revisionFixturePaths = [
    workflowPath,
    path.join(jobRoot, "state", "beat-map.json"),
    path.join(jobRoot, "state", "creative-confirmation.json"),
    path.join(jobRoot, "captions", "caption-review-plan.json"),
    path.join(jobRoot, "hyperframes", "index.template.html")
  ];
  const revisionFixture = new Map(revisionFixturePaths.map((filePath) => [filePath, fs.readFileSync(filePath)]));
  const resetRevisionFixture = () => {
    for (const [filePath, contents] of revisionFixture) fs.writeFileSync(filePath, contents);
    buildComposition(path.join(jobRoot, "hyperframes"));
  };
  const runCompositionRevision = (mutate, expectedState, reasonPattern) => {
    resetRevisionFixture();
    script("workflow-state.mjs", [
      workflowPath,
      "revise",
      "--actor",
      "user",
      "--note",
      "targeted revision"
    ]);
    mutate();
    buildComposition(path.join(jobRoot, "hyperframes"));
    script("workflow-state.mjs", [
      workflowPath,
      "advance",
      "--artifact",
      "hyperframes/index.html"
    ]);
    const revised = readJson(workflowPath);
    assert.equal(revised.currentState, expectedState);
    assert.match(revised.history.findLast((entry) => entry.action === "classify-revision").note, reasonPattern);
  };

  runCompositionRevision(() => {
    const templatePath = path.join(jobRoot, "hyperframes", "index.template.html");
    fs.writeFileSync(
      templatePath,
      fs.readFileSync(templatePath, "utf8").replace(
        ".clip { position: absolute; inset: 0; }",
        ".clip { position: absolute; inset: 0; will-change: transform; }"
      )
    );
  }, "qa", /parameter-only-revision/);
  runCompositionRevision(() => {
    const revisedBeatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
    revisedBeatMap.beats[0].intent = "Changed creative intent";
    writeJsonAtomic(path.join(jobRoot, "state", "beat-map.json"), revisedBeatMap);
  }, "motion-plan", /creative-authority-changed:beatMap/);
  runCompositionRevision(() => {
    const revisedCaptionPlan = readJson(path.join(jobRoot, "captions", "caption-review-plan.json"));
    revisedCaptionPlan.cues[0].text = "修改后的字幕";
    writeJsonAtomic(path.join(jobRoot, "captions", "caption-review-plan.json"), revisedCaptionPlan);
  }, "motion-plan", /creative-authority-changed:captionPlan/);
  resetRevisionFixture();
  const firstCompositionWorkflow = readJson(workflowPath);
  firstCompositionWorkflow.currentState = "composition";
  firstCompositionWorkflow.pendingGate = null;
  writeJsonAtomic(workflowPath, firstCompositionWorkflow);
  const changedBeforeFirstBuild = readJson(path.join(jobRoot, "state", "beat-map.json"));
  changedBeforeFirstBuild.beats[0].intent = "Unapproved pre-composition change";
  writeJsonAtomic(path.join(jobRoot, "state", "beat-map.json"), changedBeforeFirstBuild);
  buildComposition(path.join(jobRoot, "hyperframes"));
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", "hyperframes/index.html"]);
  assert.equal(readJson(workflowPath).currentState, "motion-plan", "initial composition must not bypass creative authority");
  for (const [filePath, contents] of revisionFixture) fs.writeFileSync(filePath, contents);
  writeJsonAtomic(workflowPath, workflow);
  buildComposition(path.join(jobRoot, "hyperframes"));

  const previewRelativePath = "previews/final-preview.mp4";
  renderChunkedOutput(jobRoot, "standard", path.join(jobRoot, previewRelativePath));
  const checks = [];
  const contracts = readJson(path.join(repositoryRoot, "config", "validation-evidence-contracts.json"));
  for (const checkId of Object.keys(contracts.final)) {
    checks.push({
      id: checkId,
      status: "pass",
      evidence: [JSON.parse(script("run-validation-check.mjs", [jobRoot, "final", checkId]))]
    });
  }
  writeJsonAtomic(path.join(jobRoot, "state", "qa-report.json"), {
    passed: true,
    checkedAt: new Date().toISOString(),
    artifacts: {
      composition: { path: "hyperframes/index.html", sha256: sha256File(composition.outputPath) },
      preview: { path: previewRelativePath, sha256: sha256File(path.join(jobRoot, previewRelativePath)) }
    },
    checks
  });

  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", previewRelativePath]);
  assert.equal(readJson(workflowPath).currentState, "final-preview");
  script("workflow-state.mjs", [workflowPath, "approve", "--actor", "user", "--note", "approve standard"]);
  assert.equal(readJson(workflowPath).currentState, "render");
  assert.equal(readJson(workflowPath).previewBaseline.previewPath, previewRelativePath);

  const standardCandidate = path.join(jobRoot, "output", "standard-candidate.mp4");
  fs.copyFileSync(path.join(jobRoot, previewRelativePath), standardCandidate);
  fs.copyFileSync(`${path.join(jobRoot, previewRelativePath)}.render.json`, `${standardCandidate}.render.json`);
  const standardAdvance = spawnSync(process.execPath, [
    path.join(repositoryRoot, "scripts", "workflow-state.mjs"),
    workflowPath,
    "advance",
    "--artifact",
    "output/standard-candidate.mp4"
  ], { encoding: "utf8" });
  assert.notEqual(standardAdvance.status, 0);
  assert.match(`${standardAdvance.stdout}\n${standardAdvance.stderr}`, /Expected high/);

  const assetPath = path.join(jobRoot, "hyperframes", "assets", "input-video.mp4");
  const asset = fs.readFileSync(assetPath);
  fs.appendFileSync(assetPath, "same-path tamper");
  assert.throws(
    () => renderChunkedOutput(jobRoot, "high", path.join(jobRoot, "output", "tampered.mp4")),
    /differs from the approved standard Render Manifest/
  );
  fs.writeFileSync(assetPath, asset);

  const candidateRelativePath = "output/final.candidate.mp4";
  renderChunkedOutput(jobRoot, "high", path.join(jobRoot, candidateRelativePath));
  script("workflow-state.mjs", [workflowPath, "advance", "--artifact", candidateRelativePath]);
  const completed = readJson(workflowPath);
  assert.equal(completed.currentState, "complete");
  assert.equal(completed.lastKnownGoodDelivery.path, "output/final.mp4");
  assert.equal(fs.existsSync(path.join(jobRoot, candidateRelativePath)), false);

  console.log("Delivery workflow runtime test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
