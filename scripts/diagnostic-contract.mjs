import path from "node:path";
import {
  assertRegularContainedFile,
  isPathInside,
  readJson,
  sha256File
} from "./workflow-utils.mjs";

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

export const validateMediaDiagnostic = (
  jobRootInput,
  relativePath,
  { mediaRelativePath, mediaSha256, time }
) => {
  const jobRoot = path.resolve(jobRootInput);
  const diagnosticsRoot = path.join(jobRoot, "checkpoints", "diagnostics");
  const manifestPath = path.resolve(jobRoot, relativePath ?? "");
  if (!isPathInside(diagnosticsRoot, manifestPath)) {
    throw new Error("diagnostic manifest escapes checkpoints/diagnostics");
  }
  assertRegularContainedFile(diagnosticsRoot, manifestPath, "Diagnostic manifest");
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION
    || manifest.kind !== "filmstrip-waveform"
    || manifest.generator !== "inspect-media-window.mjs") {
    throw new Error("diagnostic manifest has an unsupported contract");
  }
  if (manifest.media?.path !== mediaRelativePath || manifest.media?.sha256 !== mediaSha256) {
    throw new Error("diagnostic manifest is not bound to the current media");
  }
  if (!Number.isFinite(manifest.window?.start) || !Number.isFinite(manifest.window?.end)
    || manifest.window.start < 0 || manifest.window.end <= manifest.window.start
    || !Number.isFinite(time) || time < manifest.window.start || time > manifest.window.end) {
    throw new Error("diagnostic window does not cover the audited seam");
  }
  const imagePath = path.resolve(jobRoot, manifest.image?.path ?? "");
  if (!isPathInside(diagnosticsRoot, imagePath)) throw new Error("diagnostic image escapes checkpoints/diagnostics");
  assertRegularContainedFile(diagnosticsRoot, imagePath, "Diagnostic image");
  if (manifest.image?.sha256 !== sha256File(imagePath)) throw new Error("diagnostic image hash is stale");
  if (!Array.isArray(manifest.frameTimes)
    || manifest.frameTimes.length < 4
    || !manifest.frameTimes.every((frameTime) => Number.isFinite(frameTime)
      && frameTime >= manifest.window.start
      && frameTime <= manifest.window.end)) {
    throw new Error("diagnostic frame times are invalid");
  }
  return {
    manifest,
    manifestPath,
    manifestSha256: sha256File(manifestPath)
  };
};
