import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const assets = fileURLToPath(new URL("../assets/", import.meta.url));
const required = JSON.parse(fs.readFileSync(path.join(assets, "package.json"), "utf8"));
const versions = required.devDependencies ?? required.dependencies;
const usable = directory => {
  try {
    return ["hyperframes", "gsap"].every(name => JSON.parse(fs.readFileSync(path.join(directory, name, "package.json"), "utf8")).version === versions[name])
      && fs.existsSync(path.join(directory, "hyperframes/dist/cli.js"))
      && fs.existsSync(path.join(directory, "gsap/dist/gsap.min.js"));
  } catch { return false; }
};

export function setup(compositionInput) {
  const composition = path.resolve(compositionInput);
  fs.mkdirSync(path.join(composition, "assets"), { recursive: true });
  fs.copyFileSync(path.join(assets, "package.json"), path.join(composition, "package.json"));
  const local = path.join(composition, "node_modules");
  let modules = usable(local) ? local : null;
  const candidates = [process.env.CUT_MOTION_NODE_MODULES];
  for (const start of [composition, assets]) {
    for (let directory = start; ; directory = path.dirname(directory)) {
      candidates.push(path.join(directory, ".cache/cut-motion/node_modules"), path.join(directory, "node_modules"));
      if (directory === path.dirname(directory)) break;
    }
  }
  if (!modules) {
    modules = candidates.find(directory => directory && usable(directory));
  }
  if (!modules) {
    const npm = spawnSync("npm", ["config", "get", "cache"], { encoding: "utf8" });
    const cache = path.join(npm.status === 0 ? npm.stdout.trim() : "", "_npx");
    if (fs.existsSync(cache)) candidates.push(...fs.readdirSync(cache).map(name => path.join(cache, name, "node_modules")));
    modules = candidates.find(directory => directory && usable(directory));
  }
  if (!modules) {
    if (fs.existsSync(local) && fs.lstatSync(local).isSymbolicLink()) fs.unlinkSync(local);
    const log = path.join(composition, "setup.log"), logFd = fs.openSync(log, "w");
    let install;
    try { install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: composition, stdio: ["ignore", logFd, logFd] }); }
    finally { fs.closeSync(logFd); }
    if (install.error || install.status !== 0 || !usable(local)) throw new Error(install.error?.message ?? `Project-local HyperFrames installation failed; details: ${log}`);
    modules = local;
  } else if (modules !== local && !fs.existsSync(local)) fs.symlinkSync(modules, local, "dir");
  fs.copyFileSync(path.join(modules, "gsap/dist/gsap.min.js"), path.join(composition, "assets/gsap.min.js"));
  return { composition, modules, cli: path.join(modules, "hyperframes/dist/cli.js") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: setup.mjs <job-directory>");
  const runtime = setup(path.join(path.resolve(process.argv[2]), "composition"));
  console.log(`Runtime ready: ${runtime.composition}`);
}
