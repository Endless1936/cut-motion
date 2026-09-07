#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkRepositoryPrivacy, secretKind } from "./check-repository-privacy.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-privacy-"));
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
try {
  git("init", "-q");
  write(".gitignore", fs.readFileSync(new URL("../.gitignore", import.meta.url)));
  write("README.md", "Public workflow documentation");
  git("add", ".gitignore", "README.md");
  for (const file of ["jobs/a/state/transcript.json", "Jobs/B/input.MOV", "nested/JOBS/x.json", ".env.local", "credentials.json", "private.key", "capture.mp4", "examples/unapproved.png"]) {
    write(file, "private fixture");
    git("check-ignore", "--quiet", file);
  }
  const example = "examples/gold-standard/reference-frames/01-incremental-stack.jpg";
  write(example, "approved reference fixture");
  git("add", example);
  assert.deepEqual(checkRepositoryPrivacy(root), []);
  write("Jobs/B/input.MOV", "sk-" + "pQ7rS8".repeat(8));
  git("add", "-f", "Jobs/B/input.MOV");
  fs.chmodSync(path.join(root, "Jobs/B/input.MOV"), 0o000);
  const privateIssues = checkRepositoryPrivacy(root);
  assert(privateIssues.some((issue) => issue.reason === "private job is tracked"));
  assert(!privateIssues.some((issue) => issue.reason.includes("credential")), "private files should fail by path without inspecting contents");
  fs.chmodSync(path.join(root, "Jobs/B/input.MOV"), 0o600);
  git("rm", "--cached", "Jobs/B/input.MOV");

  const token = "sk-" + "aB3cD4".repeat(8);
  write("config.js", `export const apiKey = "${token}";`);
  assert(checkRepositoryPrivacy(root).some((issue) => issue.reason === "working-tree credential token"));
  git("add", "config.js");
  write("config.js", "// Working copy cleaned, staged copy still contains token");
  const staged = checkRepositoryPrivacy(root, { stagedOnly: true });
  assert(staged.some((issue) => issue.reason === "staged credential token"));
  assert(!JSON.stringify(staged).includes(token), "diagnostics must not leak the credential");
  git("add", "config.js");
  assert.deepEqual(checkRepositoryPrivacy(root), []);
  assert.equal(secretKind('apiKey: "YOUR_API_KEY_PLACEHOLDER"'), null);
  assert.equal(secretKind('apiKey: "' + "z9".repeat(12) + '"'), "credential assignment");
  assert.equal(secretKind("-----BEGIN " + "PRIVATE KEY-----"), "private key");
  write("bin/git", `#!/bin/sh\nprintf '%s' '${token}' >&2\nexit 2\n`);
  fs.chmodSync(path.join(root, "bin/git"), 0o700);
  const failed = spawnSync(process.execPath, [fileURLToPath(new URL("./check-repository-privacy.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /could not complete/);
  assert(!(failed.stdout + failed.stderr).includes(token), "subprocess failures must not print captured contents");
  console.log("Repository privacy tests passed: ignores, approved example, forced tracking, staged secrets, redacted diagnostics.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
