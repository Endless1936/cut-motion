#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A local accidental-publication check, not a general secret detector.
export function secretKind(text) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(text)) return "private key";
  if (/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(text)) return "credential token";
  const assignments = text.matchAll(/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b["']?\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi);
  for (const [, value] of assignments) {
    if (!/[${}\s<>]/.test(value) && !/example|placeholder|your[_-]|process\.env|test|dummy/i.test(value)) return "credential assignment";
  }
  return null;
}

export function checkRepositoryPrivacy(root, { stagedOnly = false } = {}) {
  const git = (args, options = {}) => execFileSync("git", args, { cwd: root, stdio: "pipe", maxBuffer: 32 * 1024 * 1024, ...options });
  const split = (bytes) => bytes.toString("utf8").split("\0").filter(Boolean);
  const tracked = split(git(["ls-files", "-z", "--cached"]));
  const issues = [];
  const report = (file, reason) => issues.push({ file, reason });
  // --no-index is essential: adding an ignore rule does not untrack a file.
  let ignored = [];
  if (tracked.length) {
    try {
      ignored = split(git(["check-ignore", "--no-index", "-z", "--stdin"], { input: `${tracked.join("\0")}\0` }));
    } catch (error) {
      if (error.status !== 1) throw error;
    }
  }
  for (const file of ignored) report(file, "tracked file matches .gitignore");
  const privatePaths = new Set(ignored);
  for (const file of tracked) {
    if (/(^|\/)jobs\//i.test(file)) {
      report(file, "private job is tracked");
      privatePaths.add(file);
    }
    if (privatePaths.has(file)) continue;
    const kind = secretKind(git(["show", `:${file}`]).toString("utf8"));
    if (kind) report(file, `staged ${kind}`);
  }
  if (!stagedOnly) {
    const candidates = new Set([...tracked, ...split(git(["ls-files", "-z", "--others", "--exclude-standard"]))]);
    for (const file of candidates) {
      if (privatePaths.has(file)) continue;
      const target = path.join(root, file);
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue;
      const kind = secretKind(fs.readFileSync(target, "utf8"));
      if (kind) report(file, `working-tree ${kind}`);
    }
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--staged")) {
    console.error("Usage: node scripts/check-repository-privacy.mjs [--staged]");
    process.exit(64);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const issues = checkRepositoryPrivacy(root, { stagedOnly: process.argv[2] === "--staged" });
    for (const { file, reason } of issues) console.error(`${JSON.stringify(file)}: ${reason}`);
    if (issues.length) process.exitCode = 1;
    else console.log("Repository privacy check passed (paths and common credential patterns; no secret values printed).");
  } catch {
    // child-process errors can contain file contents in stdout/stderr.
    console.error("Repository privacy check could not complete. Inspect the Git index locally; no contents were printed.");
    process.exitCode = 1;
  }
}
