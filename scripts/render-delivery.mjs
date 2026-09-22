import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderChunksPath = path.join(repoRoot, "scripts", "render-chunks.mjs");

const usage = () => {
  console.error("Usage: node render-delivery.mjs <job-directory> <standard|high> <output.mp4> [--mode auto|chunked]");
};

const isExecutableFile = (candidate) => {
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
};

const isMacArm = process.platform === "darwin" && process.arch === "arm64";

const findCachedHeadlessShell = () => {
  const cacheRoot = path.join(os.homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  const preferredVersion = process.env.HYPERFRAMES_BROWSER_VERSION ?? "152.0.7928.2";
  if (fs.existsSync(cacheRoot)) {
    const candidate = path.join(
      cacheRoot,
      `mac_arm-${preferredVersion}`,
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell"
    );
    if (isExecutableFile(candidate)) return candidate;
  }
  const puppeteerRoot = path.join(os.homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  try {
    const preferredCandidate = path.join(
      puppeteerRoot,
      preferredVersion,
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell"
    );
    if (isExecutableFile(preferredCandidate)) return preferredCandidate;
    const versions = fs.readdirSync(puppeteerRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
    for (const entry of versions) {
      const puppeteerCandidate = path.join(
        puppeteerRoot,
        entry.name,
        "chrome-headless-shell-mac-arm64",
        "chrome-headless-shell"
      );
      if (isExecutableFile(puppeteerCandidate)) return puppeteerCandidate;
    }
  } catch {
    // The pinned HyperFrames cache remains the only required browser source.
  }
  return null;
};

const resolveBrowserPath = (mode) => {
  if (!isMacArm || mode !== "chunked") return null;
  const configuredPath = process.env.HYPERFRAMES_BROWSER_PATH ?? process.env.PRODUCER_HEADLESS_SHELL_PATH;
  if (configuredPath) {
    if (!isExecutableFile(configuredPath)) {
      throw new Error(`Configured HyperFrames browser is not an executable file: ${configuredPath}`);
    }
    return configuredPath;
  }
  const cached = findCachedHeadlessShell();
  if (cached) return cached;
  throw new Error(
    "No cached macOS arm64 HyperFrames HeadlessChrome was found. "
    + "Install the browser for the pinned HyperFrames version first, then rerun this command."
  );
};

const [jobRootInput, quality, outputInput, ...options] = process.argv.slice(2);
const mode = options.length === 0 ? "auto" : options[1];
const validOptions = options.length === 0
  || (options.length === 2 && options[0] === "--mode" && ["auto", "chunked"].includes(options[1]));
if (!jobRootInput || !["standard", "high"].includes(quality) || !outputInput
  || !["auto", "chunked"].includes(mode)
  || !validOptions) {
  usage();
  process.exit(64);
}

const jobRoot = path.resolve(jobRootInput);
const outputPath = path.resolve(process.cwd(), outputInput);
const browserPath = resolveBrowserPath(mode);
const environment = {
  ...process.env,
  ...(browserPath
    ? {
        HYPERFRAMES_BROWSER_PATH: browserPath,
        PRODUCER_HEADLESS_SHELL_PATH: browserPath,
        PRODUCER_BROWSER_GPU_MODE: process.env.PRODUCER_BROWSER_GPU_MODE ?? "hardware",
        PRODUCER_EXPERIMENTAL_FAST_CAPTURE: process.env.PRODUCER_EXPERIMENTAL_FAST_CAPTURE ?? "false",
        PRODUCER_MAX_WORKERS: process.env.PRODUCER_MAX_WORKERS ?? "1",
        PRODUCER_ENABLE_BROWSER_POOL: process.env.PRODUCER_ENABLE_BROWSER_POOL ?? "false"
      }
    : {})
};

console.log(`Stable HyperFrames delivery route: ${quality}, ${mode}, browser=${browserPath ?? "platform-default"}`);
const result = spawnSync(
  process.execPath,
  [renderChunksPath, jobRoot, quality, outputPath, "--mode", mode],
  {
    cwd: path.join(jobRoot, "hyperframes"),
    env: environment,
    stdio: "inherit"
  }
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
