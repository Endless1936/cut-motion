/** Thin data adapter over the approved HTML/CSS/GSAP sources. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const templateRoot = fileURLToPath(new URL("../templates/motion-graphics/", import.meta.url));
const entries = {
  "ordered-steps": ["sequence", "vertical", ["h3", "p", "h3", "p", "h3", "p", "h3", "p"]],
  "parallel-points": ["parallel", "vertical", ["p", "p", "p", "p"]],
  "linear-flow": ["linear", "horizontal", ["h3", "h3", "h3", "h3"]],
  "relation-map": ["one-to-many", "vertical", ["h3", "h4", "h4", "h4"]],
  "converge-sources": ["convergence", "vertical", ["h3", "h3", "h3", "h3", "p"]],
  "map-transform": ["mapping", "vertical", ["h3", "p"]],
  comparison: ["comparison", "horizontal", ["p", "span", "p", "span", "p"]],
  "metric-proof": ["emphasis", "vertical", ["p", "span", "span", "p"]],
  "evidence-focus": ["evidence", "vertical", []],
  quote: ["emphasis", "vertical", ["p", "p"]],
  "code-snippet": ["demonstration", "vertical", ["p", "code", "code", "code", "code"]],
  correction: ["emphasis", "vertical", ["old", "p"]],
  annotation: ["emphasis", "horizontal", ["p"]],
  "stage/b-axis-horizon-grid": ["demonstration", "vertical", []],
  "stage/axis-stage-transition": ["demonstration", "vertical", []]
};
const aliases = { "list-ordered": "ordered-steps", "ordered-list": "ordered-steps", "list-unordered": "parallel-points", "list-build": "parallel-points", "quote-reveal": "quote", "code-block": "code-snippet", "code-build": "code-snippet", "b-axis-horizon-grid": "stage/b-axis-horizon-grid", "axis-stage-transition": "stage/axis-stage-transition" };
export const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const componentNames = () => Object.keys(entries);
export function resolveComponent(reference) {
  const name = aliases[reference] ?? reference;
  if (!Object.hasOwn(entries, name ?? "")) return null;
  const [semanticTopology, primaryFlowAxis, slots] = entries[name];
  return { meta: { name, semanticTopology, primaryFlowAxis, motionFamily: "editorial", transitionFamily: "template-reveal", summary: `Approved ${name} template`, copySlots: slots.length }, render: ({ beat }) => renderTemplate(name, beat) };
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
  const slots = entries[name][2];
  if (!Array.isArray(copy) || copy.length !== slots.length || copy.some((value) => typeof value !== "string")) throw new Error(`${beat.id}: ${name} needs ${slots.length} text slots in templateData.copy`);
  let index = 0;
  if (name === "correction") {
    fragment = fragment.replace(/(<p class="correction-old"[^>]*>)[\s\S]*?(<span)/, (_, open, span) => `${open}${escapeHtml(copy[index++])}\n    ${span}`);
  }
  // Only textual leaves are slots: decorative spans and nested containers stay intact.
  fragment = fragment.replace(/<(p|h3|h4|code|span)(\s[^>]*)?>([^<]*(?:<br\s*\/?\s*>[^<]*)*)<\/\1>/g, (whole, tag, attrs, text) => {
    if (!text.trim() || /class="(?:step-number|code-number)"/.test(attrs ?? "")) return whole;
    if (index >= copy.length) throw new Error(`${name}: template text slots changed`);
    return `<${tag}${attrs ?? ""}>${escapeHtml(copy[index++]).replaceAll("\n", "<br>")}</${tag}>`;
  });
  if (index !== copy.length) throw new Error(`${name}: template text slots changed`);
  fragment = fragment.replace(/data-beat-id="[^"]*"/, `data-beat-id="${escapeHtml(beat.id)}"`).replace(/data-axis="[^"]*"/, `data-axis="${escapeHtml(beat.axis ?? "A")}"`);
  if (beat.layout?.faceCover) fragment = fragment.replace(/data-face-cover="[^"]*"/, `data-face-cover="${escapeHtml(beat.layout.faceCover)}"`);
  const times = data.revealTimes ?? (beat.microEvents?.length ? beat.microEvents.map((event) => Number(event.time) - Number(beat.start)) : null);
  const count = [...fragment.matchAll(/data-at="[^"]*"/g)].length;
  if (times && (times.length !== count || times.some((time) => !Number.isFinite(time) || time < 0 || time >= beat.end - beat.start))) throw new Error(`${beat.id}: revealTimes needs ${count} relative times inside the beat`);
  let atIndex = 0;
  fragment = fragment.replace(/data-at="([^"]*)"/g, (_, value) => {
    const time = times ? times[atIndex++] : Number(value);
    if (time >= beat.end - beat.start) throw new Error(`${beat.id}: sample reveal exceeds beat; supply revealTimes`);
    return `data-at="${time}"`;
  });
  if (data.topPx !== undefined) {
    if (!Number.isFinite(data.topPx)) throw new Error(`${beat.id}: topPx must be finite`);
    fragment = fragment.replace(/^(<div[^>]*)(>)/, `$1 style="--mg-top:${data.topPx}px"$2`);
  }
  if (name === "evidence-focus") {
    if (typeof data.image !== "string" || !/^(?:\.\/)?assets\/[\w./-]+$/.test(data.image) || data.image.split("/").includes("..") || typeof data.alt !== "string") throw new Error(`${beat.id}: evidence needs a local assets/ image and alt text`);
    if (!Array.isArray(data.focus) || data.focus.length !== 2) throw new Error(`${beat.id}: evidence needs two focus rectangles`);
    fragment = fragment.replace(/src="[^"]*"/, `src="${escapeHtml(data.image)}"`).replace(/alt="[^"]*"/, `alt="${escapeHtml(data.alt)}"`);
    let focusIndex = 0;
    fragment = fragment.replace(/style="left:[^"]*"/g, () => {
      const { x, y, width, height } = data.focus[focusIndex++];
      if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) throw new Error(`${beat.id}: invalid focus rectangle percentages`);
      return `style="left:${x}%;top:${y}%;width:${width}%;height:${height}%"`;
    });
  }
  let style = fs.readFileSync(path.join(directory, "style.css"), "utf8");
  if (name === "annotation" && data.topPx !== undefined) style += `\n.annotation-caption-copy { top: ${data.topPx}px; }\n`;
  return { fragment, style, timeline: fs.readFileSync(path.join(directory, "timeline.mjs"), "utf8") };
}
