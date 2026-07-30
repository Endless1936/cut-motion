import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginWorkflowRevision,
  ensureWorkflowDefaults,
  readJson,
  sha256File,
  writeJsonAtomic
} from "./workflow-utils.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-workflow-"));
const run = (command, argumentsList, expectSuccess = true, failurePattern = null) => {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectSuccess && result.status !== 0) throw new Error(output);
  if (!expectSuccess && result.status === 0) throw new Error(`${command} unexpectedly passed`);
  if (failurePattern && !failurePattern.test(output)) throw new Error(`Unexpected failure:\n${output}`);
  return result;
};
const script = (name, argumentsList, expectSuccess = true, failurePattern = null) => run(
  process.execPath,
  [path.join(repositoryRoot, "scripts", name), ...argumentsList],
  expectSuccess,
  failurePattern
);
const scaffold = (name, ...options) => {
  const source = path.join(temporaryRoot, `${name}.mov`);
  const job = path.join(temporaryRoot, name);
  fs.writeFileSync(source, "media");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [job, source, ...options]);
  return job;
};

try {
  const simple = ensureWorkflowDefaults({
    captionMode: "subtitles",
    visualAxisMode: "a-axis-overlay",
    currentState: "motion-plan",
    revisionId: 1,
    gates: { "visual-sample-review": { status: "approved", revisionId: 1 } },
    history: []
  });
  beginWorkflowRevision(simple, "2026-07-25T00:00:00.000Z", "replan");
  assert.equal(simple.revisionId, 2);
  assert.equal(simple.gates["visual-sample-review"].status, "superseded");

  const scaffolded = scaffold("scaffold", "review", "subtitles");
  assert.equal(fs.existsSync(path.join(scaffolded, "hyperframes", "index.html")), true);
  assert.equal(readJson(path.join(scaffolded, "state", "workflow.json")).captionMode, "subtitles");
  assert.equal(fs.existsSync(path.join(scaffolded, "docs", "caption-plan.md")), true);
  const status = script("workflow-state.mjs", [
    path.join(scaffolded, "state", "workflow.json"),
    "status"
  ]);
  assert.equal(JSON.parse(status.stdout).currentState, "intake");
  run(
    path.join(repositoryRoot, "scripts", "scaffold-project.sh"),
    [scaffolded, path.join(temporaryRoot, "scaffold.mov"), "review", "subtitles"],
    false,
    /not empty/
  );

  const extensionless = path.join(temporaryRoot, "source-without-extension");
  fs.writeFileSync(extensionless, "media");
  const extensionlessJob = path.join(temporaryRoot, "extensionless");
  run(path.join(repositoryRoot, "scripts", "scaffold-project.sh"), [extensionlessJob, extensionless, "review"]);
  assert.equal(fs.existsSync(path.join(extensionlessJob, "input", "source.media")), true);

  const modeJob = scaffold("mode", "review");
  const modeWorkflow = path.join(modeJob, "state", "workflow.json");
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "motion-copy", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), false);
  assert.equal(readJson(path.join(modeJob, "state", "creative-confirmation.json")).storyboard.captionPlan, undefined);
  script("workflow-state.mjs", [modeWorkflow, "set-axis-mode", "b-axis-stage", "--actor", "user"]);
  assert.deepEqual(readJson(path.join(modeJob, "state", "creative-confirmation.json")).visualSample.requiredAxes, ["B"]);
  script("workflow-state.mjs", [modeWorkflow, "set-caption-mode", "subtitles", "--actor", "user"]);
  assert.equal(fs.existsSync(path.join(modeJob, "docs", "caption-plan.md")), true);

  const intakeJob = scaffold("intake", "review");
  const intakeWorkflow = path.join(intakeJob, "state", "workflow.json");
  script("workflow-state.mjs", [intakeWorkflow, "advance"]);
  assert.equal(readJson(intakeWorkflow).currentState, "transcription");
  script(
    "workflow-state.mjs",
    [intakeWorkflow, "set-caption-mode", "subtitles", "--actor", "agent"],
    false,
    /require --note/
  );
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-caption-mode",
    "subtitles",
    "--actor",
    "agent",
    "--note",
    "Readable captions fit this talking-head release"
  ]);
  script("workflow-state.mjs", [
    intakeWorkflow,
    "set-axis-mode",
    "a-axis-overlay",
    "--actor",
    "agent",
    "--note",
    "No B-axis evidence was supplied"
  ]);
  assert.equal(readJson(intakeWorkflow).captionModeSource, "auto");

  const referenceJob = scaffold("reference", "review", "subtitles");
  const referenceWorkflow = path.join(referenceJob, "state", "workflow.json");
  const reference = path.join(temporaryRoot, "reference.md");
  fs.writeFileSync(reference, "参考稿【MG：关键词】\n");
  script("register-reference-script.mjs", [referenceWorkflow, "provided", reference, "--actor", "user"]);
  const registered = readJson(referenceWorkflow);
  assert.match(registered.referenceScriptPath, /^input\/reference-scripts\/[a-f0-9]{64}\.txt$/);
  fs.appendFileSync(path.join(referenceJob, registered.referenceScriptPath), "tampered");
  script("workflow-state.mjs", [referenceWorkflow, "advance"], false, /changed|hash|reference/i);

  for (const [scope, expectedState, superseded] of [
    ["rough-cut", "rough-cut", ["rough-cut-review", "motion-plan-review", "visual-sample-review", "final-preview"]],
    ["motion-plan", "motion-plan", ["motion-plan-review", "visual-sample-review", "final-preview"]],
    ["composition", "composition", ["final-preview"]],
    ["delivery", "render", []]
  ]) {
    const job = scaffold(`reopen-${scope}`, "review", "subtitles");
    const workflowPath = path.join(job, "state", "workflow.json");
    const workflow = readJson(workflowPath);
    workflow.currentState = "complete";
    workflow.completed = true;
    workflow.gates = {
      "rough-cut-review": { status: "approved", revisionId: 1 },
      "motion-plan-review": { status: "approved", revisionId: 1 },
      "visual-sample-review": { status: "approved", revisionId: 1 },
      "final-preview": { status: "approved", revisionId: 1 }
    };
    workflow.visualPlanSha256 = "a".repeat(64);
    workflow.compositionArtifactPath = "hyperframes/index.html";
    workflow.compositionArtifactSha256 = "b".repeat(64);
    writeJsonAtomic(workflowPath, workflow);
    script("workflow-state.mjs", [workflowPath, "reopen", scope, "--actor", "user", "--note", `revise ${scope}`]);
    const reopened = readJson(workflowPath);
    assert.equal(reopened.currentState, expectedState);
    assert.equal(reopened.completed, false);
    assert.equal(reopened.revisionId, 2);
    for (const gate of Object.keys(workflow.gates)) {
      assert.equal(reopened.gates[gate].status, superseded.includes(gate) ? "superseded" : "approved");
    }
  }

  const transactionJob = scaffold("transaction", "review", "subtitles");
  const prepared = path.join(transactionJob, "state", "workflow.json.bad.prepared");
  fs.writeFileSync(prepared, "{}\n");
  writeJsonAtomic(path.join(transactionJob, "state", "transcript-resolution.transaction.json"), {
    id: "bad",
    files: [{
      target: "../escaped.json",
      prepared: "state/workflow.json.bad.prepared",
      sha256: sha256File(prepared)
    }]
  });
  script("workflow-state.mjs", [path.join(transactionJob, "state", "workflow.json"), "status"], false);
  assert.equal(fs.existsSync(path.join(temporaryRoot, "escaped.json")), false);

  console.log("Workflow contract tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
