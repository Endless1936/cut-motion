import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  resolveValidationInvocation,
  resolveCanonicalSubject,
  validateCanonicalReceipt,
  validateReceipt,
  validateSnapshotReviews
} from "./validation-receipt.mjs";
import { readJson, sha256File } from "./workflow-utils.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const jobRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-validation-"));
const write = (relativePath, contents) => {
  const absolutePath = path.join(jobRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
};

try {
  write("state/workflow.json", JSON.stringify({
    captionMode: "subtitles",
    compositionArtifactPath: "hyperframes/index.html",
    gates: { "rough-cut-review": { status: "approved", artifact: "state/chatcut-roughcut.json" } }
  }));
  write("state/design-system.json", JSON.stringify({
    typography: {
      displayFamily: "Fixture",
      fontAsset: "assets/fonts/fixture.woff2",
      secondarySizePx: [42]
    },
    density: {
      minimumVisibleTextPx: 42,
      forbiddenSelfEvidentLabels: []
    }
  }));
  write("hyperframes/index.html", `<!doctype html>
<html><head>
<link rel="stylesheet" href="caption.css">
<style>@font-face { font-family: "Fixture"; src: url("assets/fonts/fixture.woff2"); }
.poster { background: image-set("assets/image-set.png" 1x); } p { font-size: 42px; }</style>
</head><body><img src="assets/evidence.png" poster="assets/poster.png"
srcset="assets/srcset-1.png 1x, assets/srcset-2.png 2x"><p>evidence</p></body></html>`);
  write("hyperframes/caption.css", "@import \"nested.css\";\n.caption { background: url('assets/evidence.png'); }\n");
  write("hyperframes/nested.css", "@import url(\"deeper.css\");\n.nested { background: url('assets/nested.png'); }\n");
  write("hyperframes/deeper.css", ".deeper { color: white; }\n");
  write("hyperframes/assets/fonts/fixture.woff2", "fixture-font");
  write("hyperframes/assets/evidence.png", "fixture-image");
  write("hyperframes/assets/nested.png", "nested-image");
  write("hyperframes/assets/poster.png", "poster-image");
  write("hyperframes/assets/srcset-1.png", "srcset-image-1");
  write("hyperframes/assets/srcset-2.png", "srcset-image-2");
  write("hyperframes/assets/image-set.png", "image-set-image");
  write("hyperframes/unreferenced.txt", "irrelevant");

  const runner = path.join(repositoryRoot, "scripts", "run-validation-check.mjs");
  const run = () => spawnSync(process.execPath, [
    runner,
    jobRoot,
    "final",
    "information-value",
    "hyperframes/index.html"
  ], { encoding: "utf8" });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const evidence = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(evidence).sort(), ["path", "sha256"]);
  const receiptPath = path.join(jobRoot, evidence.path);
  const receipt = readJson(receiptPath);
  assert.equal(receipt.command, undefined);
  assert.equal(receipt.exitCode, undefined);
  assert.equal(receipt.runnerSha256, undefined);
  assert.equal(receipt.bundleSha256, undefined);
  assert.match(receipt.implementationSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    receipt.inputs.some((input) => input.path === "job:hyperframes/index.html"),
    false,
    "the subject must not be duplicated in inputs"
  );
  assert.ok(receipt.inputs.some((input) => input.path === "job:hyperframes/assets/evidence.png"));
  assert.ok(receipt.inputs.some((input) => input.path === "job:hyperframes/assets/fonts/fixture.woff2"));
  assert.ok(receipt.inputs.some((input) => input.path === "job:hyperframes/nested.css"));
  assert.ok(receipt.inputs.some((input) => input.path === "job:hyperframes/deeper.css"));
  assert.ok(receipt.inputs.some((input) => input.path === "job:hyperframes/assets/nested.png"));
  for (const asset of ["poster.png", "srcset-1.png", "srcset-2.png", "image-set.png"]) {
    assert.ok(receipt.inputs.some((input) => input.path === `job:hyperframes/assets/${asset}`));
  }

  const invocation = resolveValidationInvocation(
    jobRoot,
    "final",
    "information-value",
    "hyperframes/index.html"
  );
  assert.equal(resolveCanonicalSubject(jobRoot, "final", { subject: "composition" }), "hyperframes/index.html");
  assert.equal(resolveCanonicalSubject(jobRoot, "final", { subject: "preview" }), "output/final.mp4");
  assert.equal(validateReceipt(jobRoot, receipt, invocation), true);
  assert.equal(
    validateCanonicalReceipt(jobRoot, "final", "information-value", evidence).validator,
    "check-information-value"
  );

  const checkedAt = receipt.checkedAt;
  write("hyperframes/unreferenced.txt", "changed but irrelevant");
  const cached = run();
  assert.equal(cached.status, 0, cached.stderr);
  assert.equal(readJson(receiptPath).checkedAt, checkedAt, "unreferenced files must not invalidate validation");

  write("hyperframes/assets/evidence.png", "same path, changed content");
  assert.equal(validateReceipt(jobRoot, receipt, resolveValidationInvocation(
    jobRoot,
    "final",
    "information-value",
    "hyperframes/index.html"
  )), false, "same-path asset replacement must invalidate the receipt");
  const refreshed = run();
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.notEqual(readJson(receiptPath).checkedAt, checkedAt);

  const validSource = fs.readFileSync(path.join(jobRoot, "hyperframes/index.html"), "utf8");
  write("hyperframes/index.html", `${validSource}<script>fetch("assets/evidence.png")</script>`);
  assert.throws(
    () => resolveValidationInvocation(jobRoot, "final", "information-value", "hyperframes/index.html"),
    /Dynamic validation media references/
  );
  write("hyperframes/index.html", validSource);

  write("logs/final-information-value.log", "tampered output");
  const refreshedReceipt = readJson(receiptPath);
  assert.equal(validateReceipt(jobRoot, refreshedReceipt, resolveValidationInvocation(
    jobRoot,
    "final",
    "information-value",
    "hyperframes/index.html"
  )), false, "tampered output must invalidate the receipt");

  write("logs/final-information-value.log", "restored output");
  const outputSha = sha256File(path.join(jobRoot, "logs", "final-information-value.log"));
  const snapshotInvocation = {
    ...resolveValidationInvocation(jobRoot, "final", "information-value", "hyperframes/index.html"),
    contract: { kind: "snapshot-manifest", validator: "check-information-value" }
  };
  for (let index = 0; index < 3; index += 1) {
    write(`checkpoints/final-information-value-${String(index + 1).padStart(3, "0")}.png`, `snapshot-${index}`);
  }
  const snapshots = [0, 1, 2].map((time, index) => ({
    time,
    path: `checkpoints/final-information-value-${String(index + 1).padStart(3, "0")}.png`,
    sha256: sha256File(path.join(
      jobRoot,
      `checkpoints/final-information-value-${String(index + 1).padStart(3, "0")}.png`
    ))
  }));
  const snapshotReceipt = {
    ...readJson(receiptPath),
    kind: "snapshot-manifest",
    output: { path: "logs/final-information-value.log", sha256: outputSha },
    snapshots
  };
  assert.equal(validateReceipt(jobRoot, snapshotReceipt, snapshotInvocation), true);
  const snapshotReviews = snapshots.map(({ path: snapshotPath, sha256 }) => ({
    path: snapshotPath,
    sha256,
    status: "pass",
    findings: []
  }));
  assert.equal(validateSnapshotReviews(snapshotReviews, snapshotReceipt), true);
  assert.equal(validateSnapshotReviews(undefined, snapshotReceipt), false, "capture-only evidence is not a visual review");
  assert.equal(validateSnapshotReviews(snapshotReviews.map((review, index) => (
    index === 1 ? { ...review, sha256: "0".repeat(64) } : review
  )), snapshotReceipt), false, "visual review must bind each snapshot SHA");
  assert.equal(validateSnapshotReviews(snapshotReviews.map((review, index) => (
    index === 1 ? { ...review, status: "fail", findings: ["content collision"] } : review
  )), snapshotReceipt), false, "a failed snapshot cannot pass visual review");
  assert.equal(validateReceipt(jobRoot, {
    ...snapshotReceipt,
    output: { path: "hyperframes/index.html", sha256: sha256File(path.join(jobRoot, "hyperframes/index.html")) }
  }, snapshotInvocation), false, "the validation subject cannot serve as its own evidence");
  assert.equal(validateReceipt(jobRoot, {
    ...snapshotReceipt,
    snapshots: snapshots.map((snapshot, index) => (
      index === 2 ? { ...snapshot, time: 2, path: snapshots[1].path, sha256: snapshots[1].sha256 } : snapshot
    ))
  }, snapshotInvocation), false, "one snapshot file cannot prove multiple review times");
  write("checkpoints/uncanonical.png", "uncanonical");
  assert.equal(validateReceipt(jobRoot, {
    ...snapshotReceipt,
    snapshots: snapshots.map((snapshot, index) => (
      index === 2
        ? { ...snapshot, path: "checkpoints/uncanonical.png", sha256: sha256File(path.join(jobRoot, "checkpoints/uncanonical.png")) }
        : snapshot
    ))
  }, snapshotInvocation), false, "snapshot evidence must use its canonical checkpoint path");
  assert.equal(
    validateReceipt(jobRoot, {
      ...snapshotReceipt,
      snapshots: snapshots.map((snapshot, index) => ({ ...snapshot, time: index === 2 ? 1 : snapshot.time }))
    }, snapshotInvocation),
    false,
    "snapshot times must be unique"
  );
  fs.renameSync(
    path.join(jobRoot, "checkpoints", "final-information-value-003.png"),
    path.join(jobRoot, "checkpoints", "final-information-value-003.target.png")
  );
  fs.symlinkSync(
    "final-information-value-003.target.png",
    path.join(jobRoot, "checkpoints", "final-information-value-003.png")
  );
  assert.equal(validateReceipt(jobRoot, snapshotReceipt, snapshotInvocation), false, "snapshot symlinks must be rejected");

  fs.unlinkSync(path.join(jobRoot, "checkpoints", "final-information-value-003.png"));
  fs.renameSync(
    path.join(jobRoot, "checkpoints", "final-information-value-003.target.png"),
    path.join(jobRoot, "checkpoints", "final-information-value-003.png")
  );
  fs.renameSync(
    path.join(jobRoot, "logs", "final-information-value.log"),
    path.join(jobRoot, "logs", "final-information-value.target.log")
  );
  fs.symlinkSync("final-information-value.target.log", path.join(jobRoot, "logs", "final-information-value.log"));
  assert.equal(validateReceipt(jobRoot, snapshotReceipt, snapshotInvocation), false, "output symlinks must be rejected");
  assert.throws(
    () => validateCanonicalReceipt(jobRoot, "final", "information-value", {
      path: evidence.path,
      sha256: sha256File(receiptPath),
      validator: "forged"
    }, { subjectRelativePath: "hyperframes/index.html" }),
    /canonical validation receipt/
  );
  fs.renameSync(receiptPath, `${receiptPath}.target`);
  fs.symlinkSync(path.basename(`${receiptPath}.target`), receiptPath);
  assert.throws(
    () => validateCanonicalReceipt(jobRoot, "final", "information-value", {
      path: evidence.path,
      sha256: sha256File(receiptPath)
    }),
    /unsafe receipt path/,
    "receipt symlinks must be rejected"
  );
  fs.unlinkSync(receiptPath);
  fs.renameSync(`${receiptPath}.target`, receiptPath);

  console.log("Validation receipt tests passed");
} finally {
  fs.rmSync(jobRoot, { recursive: true, force: true });
}
