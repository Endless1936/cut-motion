#!/usr/bin/env node
// Preserve source media and bind each ChatCut asset to its own local recording.
import fs from "node:fs";
import path from "node:path";
import { assertRegularContainedFile, readJson, sha256File, writeJsonAtomic } from "./workflow-utils.mjs";

const [job, ...pairs] = process.argv.slice(2);
if (!job || pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error("Usage: node scripts/register-source-media.mjs <job> <asset-id> <local-source> [<asset-id> <local-source> ...]");
  process.exit(64);
}
const root = path.resolve(job);
const projectPath = path.join(root, "state/project.json");
const project = readJson(projectPath);
const registrations = new Map((project.sourceVideos ?? []).map(entry => [entry.assetId, entry]));
const pending = new Set();
for (let i = 0; i < pairs.length; i += 2) {
  const [assetId, localSource] = pairs.slice(i, i + 2);
  if (!/^[a-f0-9-]{36}$/i.test(assetId) || pending.has(assetId)) throw new Error("Provide unique full ChatCut asset UUIDs");
  pending.add(assetId);
  const original = path.resolve(localSource);
  if (!fs.statSync(original).isFile()) throw new Error("Source must be a regular media file");
  const sha256 = sha256File(original);
  const extension = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".media";
  const sourceVideo = `input/sources/${sha256}${extension}`;
  const target = path.join(root, sourceVideo);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
  assertRegularContainedFile(path.join(root, "input"), target, "Source media");
  if (sha256File(target) !== sha256) throw new Error("Preserved source hash does not match the original");
  const existing = registrations.get(assetId);
  if (existing && sha256File(path.resolve(root, existing.sourceVideo)) !== sha256) throw new Error("Asset is already bound to different source media");
  registrations.set(assetId, { assetId, sourceVideo });
}
project.sourceVideos = [...registrations.values()];
writeJsonAtomic(projectPath, project);
console.log(`Registered ${pending.size} local sources; originals preserved.`);
