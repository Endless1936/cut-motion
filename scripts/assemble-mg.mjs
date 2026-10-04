#!/usr/bin/env node
/** Instantiate approved templates; --beat updates one module, --force replaces edited output. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { componentFor, templateRoot } from "./motion-template-library.mjs";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";
import { loadSpeechTiming, resolveRevealTimes } from "./mg-speech-timing.mjs";

const [jobArgument, ...flags] = process.argv.slice(2);
if (!jobArgument) throw new Error("Usage: assemble-mg.mjs <job-directory> [--write] [--beat <id>] [--force]");
const write = flags.includes("--write");
const force = flags.includes("--force");
const onlyBeat = flags.includes("--beat") ? flags[flags.indexOf("--beat") + 1] : null;
if (flags.includes("--beat") && (!onlyBeat || onlyBeat.startsWith("--"))) throw new Error("--beat needs an ID");
const jobRoot = path.resolve(jobArgument);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const beatMap = readJson(path.join(jobRoot, "state/beat-map.json"));
const speechTiming = beatMap.beats.some(beat => beat.templateData?.revealCues) ? loadSpeechTiming(jobRoot, beatMap.fps) : null;
const words = transcriptWordsById(readJson(path.join(jobRoot, "state/transcript.json")));
const manifestPath = path.join(jobRoot, "state/mg-assembly.json");
const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : { files: {} };
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const outputs = new Map();
const targets = beatMap.beats.filter((beat) => beat.mgScope === "local" && (!onlyBeat || beat.id === onlyBeat));
if (onlyBeat && !targets.length) throw new Error(`No local MG beat ${onlyBeat}`);
for (const beat of targets) {
  if (!/^[\w-]+$/.test(beat.id)) throw new Error(`Unsafe BeatID ${beat.id}`);
  const { component } = componentFor(beat);
  if (!component) {
    for (const file of ["fragment.html", "style.css", "timeline.mjs"]) if (!fs.existsSync(path.join(jobRoot, "hyperframes/mg", beat.id, file))) throw new Error(`${beat.id}: custom module is missing ${file}`);
    console.log(`${beat.id}: custom module retained`);
    continue;
  }
  if (component.meta.name === "stage/axis-stage-transition") continue;
  if (component.meta.name === "evidence-focus" && !fs.existsSync(path.join(jobRoot, "hyperframes", beat.templateData?.image ?? "missing-evidence"))) throw new Error(`${beat.id}: evidence image is missing from hyperframes/assets`);
  const window = resolveBeatRenderWindow(beat, beatMap, words);
  const revealTimes = resolveRevealTimes(beat, window, speechTiming);
  const source = component.render({ beat: { ...beat, start: window.start, end: window.end,
    templateData: { ...beat.templateData, ...(revealTimes ? { revealTimes } : {}) } } });
  new Function("root", "select", "beat", "timeline", source.timeline);
  if (/<(?:script|style|video|audio)\b/i.test(source.fragment)) throw new Error(`${beat.id}: forbidden shared element`);
  for (const [file, content] of Object.entries({ "fragment.html": source.fragment, "style.css": source.style, "timeline.mjs": source.timeline })) outputs.set(`hyperframes/mg/${beat.id}/${file}`, content);
}

// A/B transitions operate on the existing speaker and shared timeline, never a second video.
const hostPath = path.join(jobRoot, "hyperframes/index.template.html");
const hasStageBlock = fs.existsSync(hostPath) && fs.readFileSync(hostPath, "utf8").includes("/* CUT_MOTION_STAGE_CSS_START */");
if (targets.some((beat) => componentFor(beat).component?.meta.name === "stage/axis-stage-transition") || (!onlyBeat && hasStageBlock)) {
  const stages = beatMap.beats.filter((beat) => ["stage/axis-stage-transition", "axis-stage-transition"].includes(beat.templateId ?? beat.mgComponent ?? beat.recipe));
  const intervals = stages.map((beat) => {
    const { start, end } = resolveBeatRenderWindow(beat, beatMap, words);
    const duration = beat.templateData?.duration ?? 0.8;
    if (!Number.isFinite(duration) || duration <= 0 || end - start < duration * 2) throw new Error(`${beat.id}: stage interval must cover both transitions`);
    return { start, end, duration };
  }).sort((a,b) => a.start-b.start);
  if (intervals.some((value,index) => index && value.start < intervals[index-1].end)) throw new Error("Stage intervals overlap");
  const target = "hyperframes/index.template.html";
  let template = fs.readFileSync(path.join(jobRoot, target), "utf8");
  const stageDirectory = path.join(templateRoot, "stage/axis-stage-transition");
  const css = fs.readFileSync(path.join(stageDirectory, "axis-stage.css"), "utf8");
  const helper = fs.readFileSync(path.join(stageDirectory, "axis-stage-transitions.js"), "utf8");
  const timeline = `${helper}\nconst stageRoot = document.getElementById("root");\nconst stageSpeaker = document.getElementById("a-roll");\nstageRoot.classList.add("axis-stage-root");\nstageSpeaker.classList.add("axis-stage-speaker");\n${intervals.map(({ start, end, duration }) => `window.addAxisStageTransitions(timeline, { root: stageRoot, speaker: stageSpeaker, intervals: [[${start},${end}]], duration: ${duration} });`).join("\n")}`;
  for (const [kind, content, marker] of [["CSS", css, "/* CUT_MOTION_MG_STYLES */"], ["TIMELINE", timeline, "/* CUT_MOTION_MG_TIMELINES */"]]) {
    const begin = `/* CUT_MOTION_STAGE_${kind}_START */`;
    const end = `/* CUT_MOTION_STAGE_${kind}_END */`;
    const block = intervals.length ? `${begin}\n${content}\n${end}` : "";
    const startIndex = template.indexOf(begin);
    if (startIndex >= 0) {
      const endIndex = template.indexOf(end, startIndex);
      if (endIndex < 0) throw new Error("Incomplete managed stage block");
      const oldBlock = template.slice(startIndex, endIndex + end.length);
      const key = `${target}#${kind}`;
      if (oldBlock !== block && manifest.files[key] !== hash(oldBlock) && !force) throw new Error(`${kind} stage block was edited; preserve it or use --force`);
      template = template.replace(oldBlock, block);
    } else if (block) {
      if (!template.includes(marker)) throw new Error(`Composition is missing ${marker}`);
      template = template.replace(marker, `${block}\n${marker}`);
    }
    manifest.files[`${target}#${kind}`] = hash(block);
  }
  outputs.set(target, template);
}

// Validate the complete batch before publishing any file.
for (const [relative, content] of outputs) {
  const target = path.join(jobRoot, relative);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (existing !== null && existing !== content && relative !== "hyperframes/index.template.html" && manifest.files[relative] !== hash(existing) && !force) throw new Error(`${relative} has manual/unmanaged edits; choose custom or use --force for explicit replacement`);
}
for (const [relative, content] of outputs) manifest.files[relative] = hash(content);
if (write) {
  outputs.set("state/mg-assembly.json", JSON.stringify(manifest, null, 2) + "\n");
  const backups = new Map();
  try {
    for (const [relative, content] of outputs) {
      const target = path.join(jobRoot, relative);
      backups.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  } catch (error) {
    for (const [target, previous] of backups) {
      if (previous === null) fs.rmSync(target, { force: true });
      else fs.writeFileSync(target, previous);
    }
    throw error;
  }
}
console.log(`${targets.length} beat(s), ${outputs.size} files ${write ? "assembled" : "planned (pass --write)"}`);
