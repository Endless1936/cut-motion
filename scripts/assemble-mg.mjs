#!/usr/bin/env node
/**
 * Assemble MG module sources for every local Beat Map entry from the component
 * library, instead of hand-writing fragment.html / style.css / timeline.mjs.
 *
 *   node scripts/assemble-mg.mjs <job-directory> [--check] [--beat <id>]
 *
 * The component library lives in mg-library/ at the repository root. A beat is
 * matched to a component by `beat.mgComponent`, else by its `recipe` alias.
 * Without --write the sources are computed and reported but not emitted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentFor } from "../mg-library/index.mjs";
import { BASE_ROOT_CSS, panelGeometry } from "../mg-library/shared.mjs";
import { resolveBeatRenderWindow, transcriptWordsById } from "./motion-window-utils.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const [jobArgument, ...flags] = process.argv.slice(2);
if (!jobArgument) {
  console.error("Usage: node scripts/assemble-mg.mjs <job-directory> [--write] [--beat <id>]");
  process.exit(64);
}
const write = flags.includes("--write");
const onlyBeat = flags.includes("--beat") ? flags[flags.indexOf("--beat") + 1] : null;

const jobRoot = path.resolve(jobArgument);
const hyperframesDirectory = path.join(jobRoot, "hyperframes");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const beatMap = readJson(path.join(jobRoot, "state", "beat-map.json"));
const transcript = readJson(path.join(jobRoot, "state", "transcript.json"));
const wordsById = transcriptWordsById(transcript);
const fps = Number(beatMap.fps ?? 30);

const decimal = (value) => Number(Number(value).toFixed(6));
const attribute = (value) => escapeAttribute(String(value));

const targets = (beatMap.beats ?? [])
  .filter((beat) => beat.mgScope === "local" && (!onlyBeat || beat.id === onlyBeat));
if (targets.length === 0) {
  console.log(onlyBeat ? `no local MG beat matches ${onlyBeat}` : "no local MG beats in this job");
  process.exit(0);
}

const results = [];
for (const beat of targets) {
  const { component } = componentFor(beat);
  const window = resolveBeatRenderWindow(beat, beatMap, wordsById);
  const groupStart = decimal(window.start);
  const groupDuration = decimal(window.end - window.start);
  const geometry = panelGeometry(beat);
  const events = (beat.microEvents ?? []).slice().sort((left, right) => Number(left.time) - Number(right.time));

  const { inner, style, timeline } = component.render({ beat, geometry, events, beatMap, fps });
  if (/<(?:script|style|video|audio)\b/i.test(inner)) throw new Error(`${beat.id}: ${component.meta.name} emitted a forbidden element`);
  assertTimelineSyntax(beat.id, timeline, window);

  const rootTag = [
    '<div class="mg-root"',
    ` data-beat-id="${attribute(beat.id)}"`,
    " data-motion-group",
    ` data-axis="${attribute(beat.axis)}"`,
    ' data-group-kind="primary"',
    ` data-group-start="${groupStart}"`,
    ` data-group-duration="${groupDuration}"`,
    ` data-face-cover="${attribute(beat.layout?.faceCover ?? "partial")}"`,
    ` data-primary-flow-axis="${attribute(component.meta.primaryFlowAxis)}"`,
    ` data-topology="${attribute(beat.semanticTopology ?? component.meta.semanticTopology)}"`,
    ">"
  ].join("");
  const fragment = `${rootTag}\n${inner}\n</div>\n`;
  const css = `${BASE_ROOT_CSS}\n${style}\n`;
  const timelineSource = `${timeline}\n`;

  const moduleDirectory = path.join(hyperframesDirectory, "mg", beat.id);
  const files = { "fragment.html": fragment, "style.css": css, "timeline.mjs": timelineSource };
  const changed = [];
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(moduleDirectory, name);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (existing === content) continue;
    changed.push(name);
    if (write) {
      fs.mkdirSync(moduleDirectory, { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  results.push({ beat, component: component.meta.name, window, geometry, changed });
  const status = changed.length === 0 ? "unchanged" : write ? `wrote ${changed.join(", ")}` : `would write ${changed.join(", ")}`;
  console.log(`${beat.id}  ${component.meta.name.padEnd(14)}  ${groupStart}-${decimal(window.end)}  ${status}`);
}

console.log(`\n${results.length} local MG module(s) from ${new Set(results.map((entry) => entry.component)).size} component(s); ${write ? "emitted" : "dry run — pass --write to emit"}`);
void scriptDirectory;

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/**
 * Compile the component timeline exactly the way build-composition splices it
 * into the composition script. `new Function` parses without executing, so a
 * broken selector or stray token fails here instead of during a render.
 */
function assertTimelineSyntax(beatId, timeline, window) {
  const snippet = [
    "const beat = {};",
    "const root = null;",
    "const select = () => [];",
    "const timeline = { set() {}, to() {}, fromTo() {} };",
    "{",
    timeline,
    "}"
  ].join("\n");
  try {
    // eslint-disable-next-line no-new-func
    new Function(snippet);
  } catch (error) {
    throw new Error(`${beatId}: generated timeline is not valid JavaScript (${error.message}); render window ${window.start}-${window.end}`);
  }
}
