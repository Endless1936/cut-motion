/** Thin data adapter over the approved HTML/CSS/GSAP sources. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templateContent } from "./template-content.mjs";

export const templateRoot = fileURLToPath(new URL("../assets/motion-graphics/", import.meta.url));
export const DEFAULT_MG_TOP_PX = 280; // Upper placement on the 1080×1920 template canvas.
const entries = {
  "ordered-steps": ["h3", "p", "h3", "p", "h3", "p", "h3", "p"],
  "parallel-points": ["p", "p", "p", "p"],
  "linear-flow": ["h3", "h3", "h3", "h3"],
  "relation-map": ["h3", "h4", "h4", "h4"],
  "converge-sources": ["h3", "h3", "h3", "h3", "p"],
  "map-transform": ["h3", "p"],
  comparison: ["p", "span", "p", "span", "p"],
  "metric-proof": ["p", "span", "span", "p"],
  "evidence-focus": [],
  quote: ["p", "p"],
  "code-snippet": ["p", "code", "code", "code", "code"],
  correction: ["old", "p"],
  annotation: ["p"],
  "stage/b-axis-horizon-grid": [],
  "stage/axis-stage-transition": []
};
const aliases = { "list-ordered": "ordered-steps", "ordered-list": "ordered-steps", "list-unordered": "parallel-points", "list-build": "parallel-points", "quote-reveal": "quote", "code-block": "code-snippet", "code-build": "code-snippet", "b-axis-horizon-grid": "stage/b-axis-horizon-grid", "axis-stage-transition": "stage/axis-stage-transition" };
export const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const componentNames = () => Object.keys(entries);
export function resolveComponent(reference) {
  const name = aliases[reference] ?? reference;
  if (!Object.hasOwn(entries, name ?? "")) return null;
  const slots = entries[name]; // Legacy sample count, never a content limit.
  // The shared transition helper has no fragment; every other template owns
  // its semantic metadata on the rendered root element.
  let semanticTopology = "demonstration", primaryFlowAxis = "vertical";
  if (name !== "stage/axis-stage-transition") {
    const fragment = fs.readFileSync(path.join(templateRoot, name, "fragment.html"), "utf8");
    const root = fragment.match(/^\s*<div\b[^>]*>/)?.[0] ?? "";
    semanticTopology = root.match(/\bdata-topology=["']([^"']+)["']/)?.[1];
    primaryFlowAxis = root.match(/\bdata-primary-flow-axis=["']([^"']+)["']/)?.[1];
    if (!semanticTopology || !primaryFlowAxis) throw new Error(`${name}: template root needs data-topology and data-primary-flow-axis`);
  }
  return { meta: { name, semanticTopology, primaryFlowAxis, motionFamily: "editorial", transitionFamily: "template-reveal", summary: `Reusable ${name} template`, legacyCopySlots: slots.length, ...(!name.startsWith("stage/") ? { defaultTopPx: DEFAULT_MG_TOP_PX } : {}) }, content: beat => templateContent(name, beat), render: ({ beat }) => renderTemplate(name, beat) };
}
export const describeComponents = () => componentNames().map((name) => resolveComponent(name).meta);
export function componentFor(beat) {
  const requested = beat.templateId ?? beat.mgComponent ?? beat.recipe;
  if (requested === "custom") return { component: null, requested, via: "custom" };
  const component = resolveComponent(requested);
  if (!component) throw new Error(`${beat.id}: unknown template ${requested}; choose a canonical templateId or custom`);
  return { component, requested, via: "templateId" };
}

export function renderTemplate(name, beat) {
  if (name === "stage/axis-stage-transition") throw new Error("A/B transition belongs to the shared composition timeline");
  const directory = path.join(templateRoot, name);
  let fragment = fs.readFileSync(path.join(directory, "fragment.html"), "utf8");
  const data = beat.templateData ?? {};
  const copy = data.copy ?? beat.onScreenCopy ?? [];
  if (!Array.isArray(copy) || copy.some(value => typeof value !== "string")) throw new Error(`${beat.id}: MG copy must be text strings`);
  if (data.items !== undefined && (!Array.isArray(data.items) || data.items.some(item => typeof item !== "string" && (!item || typeof (item.label ?? item.text) !== "string")))) throw new Error(`${beat.id}: items need text or labelled objects`);
  if (name === "evidence-focus") {
    if (typeof data.image !== "string" || !data.image.replace(/^\.\//, "").startsWith("assets/") || !/^[a-zA-Z0-9_./-]+$/.test(data.image) || data.image.split("/").includes("..") || typeof data.alt !== "string") throw new Error(`${beat.id}: evidence needs a local assets/ image and alt text`);
    if (!Array.isArray(data.focus) || !data.focus.length) throw new Error(`${beat.id}: evidence needs focus rectangles`);
    for (const { x, y, width, height } of data.focus) {
      if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) throw new Error(`${beat.id}: invalid focus rectangle percentages`);
    }
  }
  const content = templateContent(name, beat);
  if (content) {
    if (name !== "evidence-focus" && !content.copy.length) throw new Error(`${beat.id}: MG needs meaningful content`);
    const rootTag = fragment.match(/^\s*<div\b[^>]*>/)[0].replace(/\s(?:style|data-layout)="[^"]*"/g, "");
    const layout = data.layout ?? (name === "linear-flow" && (data.items?.length ?? copy.length) > 4 ? "vertical" : "default");
    const axis = name === "linear-flow" && layout === "vertical" ? "vertical" : content.axis;
    fragment = `${rootTag}${content.body}</div>\n`.replace(/data-primary-flow-axis="[^"]*"/, `data-primary-flow-axis="${axis}"`);
    fragment = fragment.replace(/^(\s*<div[^>]*)(>)/, `$1 data-layout="${escapeHtml(layout)}"$2`);
  }
  fragment = fragment.replace(/data-beat-id="[^"]*"/, `data-beat-id="${escapeHtml(beat.id)}"`).replace(/data-axis="[^"]*"/, `data-axis="${escapeHtml(beat.axis ?? "A")}"`);
  if (beat.layout?.faceCover) fragment = fragment.replace(/data-face-cover="[^"]*"/, `data-face-cover="${escapeHtml(beat.layout.faceCover)}"`);
  const times = data.revealTimes ?? (beat.microEvents?.length ? beat.microEvents.map((event) => Number(event.time) - Number(beat.start)) : null);
  const count = [...fragment.matchAll(/data-at="[^"]*"/g)].length;
  if (times && (times.length !== count || times.some((time) => !Number.isFinite(time) || time < 0 || time >= beat.end - beat.start))) throw new Error(`${beat.id}: revealTimes needs ${count} relative times inside the beat`);
  let atIndex = 0;
  fragment = fragment.replace(/data-at="([^"]*)"/g, (_, value) => {
    const time = times ? times[atIndex++] : (count <= 1 ? 0 : atIndex++ * Math.min(0.55, (beat.end - beat.start) * 0.55 / (count - 1)));
    if (time >= beat.end - beat.start) throw new Error(`${beat.id}: sample reveal exceeds beat; supply revealTimes`);
    return `data-at="${time}"`;
  });
  const topPx = data.topPx !== undefined ? data.topPx : (!name.startsWith("stage/") ? DEFAULT_MG_TOP_PX : undefined);
  if (topPx !== undefined) {
    if (!Number.isFinite(topPx)) throw new Error(`${beat.id}: topPx must be finite`);
    if (data.widthPx !== undefined && (!Number.isFinite(data.widthPx) || data.widthPx <= 0)) throw new Error(`${beat.id}: widthPx must be positive`);
    const width = data.widthPx === undefined ? "" : `;--mg-width:${data.widthPx}px`;
    fragment = fragment.replace(/^(\s*<div[^>]*)(>)/, `$1 style="--mg-top:${topPx}px${width}"$2`);
  }
  let style = fs.readFileSync(path.join(directory, "style.css"), "utf8");
  return { fragment, style, timeline: fs.readFileSync(path.join(directory, "timeline.mjs"), "utf8") };
}
