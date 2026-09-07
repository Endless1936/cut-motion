import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, sha256File } from "./workflow-utils.mjs";

// Tiny synthetic media only; never inspect or modify repository jobs.
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-media-promotion-")));
const promotionScript = fileURLToPath(new URL("./promote-job-media.mjs", import.meta.url));
const run = (command, args) => spawnSync(command, args, { encoding: "utf8" });
const succeeded = (result) => assert.equal(result.status, 0, result.error?.message ?? result.stderr);

try {
  const media = {};
  for (const color of ["red", "blue"]) {
    const output = path.join(temporaryRoot, `${color}.mp4`);
    succeeded(run("ffmpeg", [
      "-v", "error", "-nostdin", "-f", "lavfi", "-i", `color=c=${color}:s=64x96:r=30`,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output
    ]));
    media[color] = output;
  }
  const currentHash = sha256File(media.red);
  const oldHash = sha256File(media.blue);
  assert.notEqual(currentHash, oldHash);

  const fixture = (name, assetMode) => {
    const root = path.join(temporaryRoot, name);
    for (const directory of ["input", "state", "roughcut", "hyperframes/assets"]) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    const canonical = path.join(root, "roughcut/a-roll.mp4");
    const asset = path.join(root, "hyperframes/assets/input-video.mp4");
    const projectPath = path.join(root, "state/project.json");
    fs.copyFileSync(media.red, path.join(root, "input/source.mp4"));
    fs.copyFileSync(media.red, canonical);
    if (assetMode === "old") fs.copyFileSync(media.blue, asset);
    if (assetMode === "linked") fs.linkSync(canonical, asset);
    const originalProject = JSON.stringify({
      sourceVideo: "input/source.mp4", preservedSetting: "unchanged",
      mediaArtifacts: { roughcut: { path: "roughcut/a-roll.mp4", sha256: oldHash } }
    });
    fs.writeFileSync(projectPath, originalProject);
    return { root, canonical, asset, projectPath, originalProject };
  };
  const promote = (job, { consume = false, source = job.canonical, preload } = {}) => run(process.execPath, [
    ...(preload ? ["--import", `data:text/javascript,${encodeURIComponent(preload)}`] : []),
    promotionScript, job.root, "roughcut", source, ...(consume ? ["--consume-source"] : [])
  ]);
  const assertMediaClean = (job) => {
    assert.deepEqual(fs.readdirSync(path.dirname(job.canonical)), ["a-roll.mp4"]);
    assert.deepEqual(fs.readdirSync(path.dirname(job.asset)), ["input-video.mp4"]);
    assert.equal(sha256File(path.join(job.root, "input/source.mp4")), currentHash);
  };
  const assertPromoted = (job) => {
    assert.equal(sha256File(job.canonical), currentHash);
    assert.equal(sha256File(job.asset), currentHash);
    const project = readJson(job.projectPath);
    assert.equal(project.preservedSetting, "unchanged");
    assert.equal(project.mediaArtifacts.roughcut.sha256, currentHash);
    assert.equal(project.mediaArtifacts.roughcut.path, "roughcut/a-roll.mp4");
    assertMediaClean(job);
  };

  for (const assetMode of ["missing", "old", "linked"]) {
    for (const consume of [false, true]) {
      const job = fixture(`${assetMode}-${consume}`, assetMode);
      const canonicalInode = fs.statSync(job.canonical).ino;
      const result = promote(job, { consume });
      succeeded(result);
      assert.doesNotMatch(result.stdout, /consumed source/);
      assertPromoted(job);
      assert.equal(fs.statSync(job.canonical).ino, canonicalInode, "canonical media must not be replaced");
      succeeded(promote(job, { consume }));
      assertPromoted(job);
    }
  }

  // A deterministic filesystem failure before asset replacement must not stamp success.
  const blocked = fixture("blocked-sync", "missing");
  fs.rmdirSync(path.dirname(blocked.asset));
  fs.writeFileSync(path.dirname(blocked.asset), "not a directory");
  const blockedResult = promote(blocked, { consume: true });
  assert.notEqual(blockedResult.status, 0);
  assert.doesNotMatch(blockedResult.stdout, /Media already canonical|Promoted/);
  assert.equal(fs.readFileSync(blocked.projectPath, "utf8"), blocked.originalProject);
  assert.equal(sha256File(blocked.canonical), currentHash);
  assert.deepEqual(fs.readdirSync(path.dirname(blocked.canonical)), ["a-roll.mp4"]);

  // Fail after asset replacement, during the existing atomic project-record write.
  const lateFailure = fixture("record-failure", "old");
  const preload = `import fs from "node:fs";
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === ${JSON.stringify(lateFailure.projectPath)}) throw new Error("injected record failure");
      return rename(from, to);
    };`;
  const lateResult = promote(lateFailure, { consume: true, preload });
  assert.notEqual(lateResult.status, 0);
  assert.match(lateResult.stderr, /injected record failure/);
  assert.doesNotMatch(lateResult.stdout, /Media already canonical|Promoted/);
  assert.equal(fs.readFileSync(lateFailure.projectPath, "utf8"), lateFailure.originalProject);
  assert.equal(sha256File(lateFailure.canonical), currentHash);
  assert.equal(sha256File(lateFailure.asset), oldHash, "failed record write must restore the previous asset");
  assertMediaClean(lateFailure);

  // Preserve the external-export path and its consume-source behavior.
  const external = fixture("external-export", "old");
  fs.copyFileSync(media.blue, external.canonical);
  const exportPath = path.join(external.root, "export.mp4");
  fs.copyFileSync(media.red, exportPath);
  succeeded(promote(external, { source: exportPath, consume: true }));
  assertPromoted(external);
  assert.equal(fs.existsSync(exportPath), false);
  console.log("Media promotion tests passed: missing, stale, same-inode, repeat, consume, rollback and external export.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
