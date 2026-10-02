/**
 * Shared helpers for the MG component library.
 *
 * A component never writes its own root element: `scripts/assemble-mg.mjs`
 * emits the `data-beat-id` root from the Beat Map, so the geometry, axis and
 * motion-group metadata stay data-driven. A component only supplies the inner
 * markup, its scoped CSS and its GSAP timeline.
 *
 * Component contract
 * ------------------
 *   export const meta = { name, summary, primaryFlowAxis, semanticTopology, motionFamily, transitionFamily, params }
 *   export const render = ({ beat, geometry, times, items, result, source }) => ({ inner, style, timeline })
 *
 * `timeline` is spliced into a block where `beat`, `root`, `select` and the
 * GSAP `timeline` already exist, and where the exit fade is appended by the
 * composition builder — components must not animate root opacity at exit.
 */

export const CANVAS = { width: 1080, height: 1920 };

/** The A-axis band a panel may occupy, in CSS pixels, from the Beat Map layout. */
export const panelGeometry = (beat) => {
  const bounds = beat.layout?.primaryBoundsNormalized ?? { x: 0.06, y: 0.42, width: 0.88, height: 0.3 };
  return {
    left: round(CANVAS.width * bounds.x),
    top: round(CANVAS.height * bounds.y),
    width: round(CANVAS.width * bounds.width),
    height: round(CANVAS.height * bounds.height)
  };
};

export const round = (value, places = 1) => Number(Number(value).toFixed(places));
export const t = (value) => Number(Number(value).toFixed(3));

/** Absolute time for the i-th micro event, falling back to a fixed cadence. */
export const timeAt = (times, index, fallback) => {
  const value = times?.[index];
  return Number.isFinite(value) ? t(value) : t(fallback);
};

/**
 * Beat Maps already name their micro events; components look times up by that
 * vocabulary instead of by array position, so inserting or splitting an event
 * in the plan cannot silently retime a component.
 */
export const eventTime = (events, types, fallback) => {
  const match = (events ?? []).find((event) => types.includes(event.type) && Number.isFinite(Number(event.time)));
  return match ? t(Number(match.time)) : t(fallback);
};

/** Times of the micro events matching `types`; omitting `types` takes them all. */
export const eventTimes = (events, types) => (events ?? [])
  .filter((event) => (!types || types.includes(event.type)) && Number.isFinite(Number(event.time)))
  .map((event) => t(Number(event.time)))
  .sort((left, right) => left - right);

/**
 * The reveal cadence for a component that shows `count` discrete things: use
 * the planned micro-event times when there are enough, otherwise a fixed step.
 */
export const revealCadence = (events, count, start, step = 0.14) => {
  const declared = eventTimes(events);
  return Array.from({ length: count }, (_, index) => declared[index] ?? t(start + 0.1 + index * step));
};

/** Base rules every MG root needs; emitted by the assembler, not the component. */
export const BASE_ROOT_CSS = ".mg-root{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;color:#fff}";

/**
 * The panel element. The layout contract requires any `*panel*`/`*card*` class
 * to declare a checked motion surface and an explicit border policy, so every
 * component opens its panel with this exact tag.
 */
export const PANEL_OPEN = '<div class="panel" data-motion-surface="container" data-border-policy="none">';

/** The localized glass surface the design system allows on the A axis. */
export const panelCss = (geometry, { extra = "", radius = 20 } = {}) => `.panel{position:absolute;left:${geometry.left}px;top:${geometry.top}px;width:${geometry.width}px;height:${geometry.height}px;box-sizing:border-box;padding:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:${radius}px;background:var(--glass);backdrop-filter:blur(14px);box-shadow:0 28px 72px rgba(0,0,0,.32)}${extra}`;

export const labelChipCss = (className, { fontSize = 72, height = 112 } = {}) => `.${className}{height:${height}px;padding:0 20px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(255,255,255,.08);font-size:${fontSize}px;line-height:1;font-weight:400;white-space:nowrap}`;

/** The one reveal gesture every panel opens with: the surface drops into place. */
export const panelEntrance = (selectorName = ".panel") => [
  "timeline.set(root, { autoAlpha: 1 }, beat.start);",
  `timeline.fromTo(select("${selectorName}"), { y: -26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: "power2.out" }, beat.start);`
].join("\n");

/**
 * The "never an empty container" rule.
 *
 * When a container reveals before the label that fills it, the container sits
 * visibly blank for however long the label is still waiting on the audio. An
 * empty tinted box reads as a loading placeholder, not as a result, so the
 * container looks broken rather than pending. Components that open a container
 * early hold a dim silhouette of the incoming label until its own reveal lands.
 */
export const CONTAINER_SILHOUETTE_OPACITY = 0.22;
export const SILHOUETTE_LEAD_SECONDS = 0.4;

/** True when a container would sit empty long enough for the gap to be read. */
export const needsSilhouette = (containerTime, labelTime) =>
  t(labelTime) - t(containerTime) >= SILHOUETTE_LEAD_SECONDS;

/** The dim placeholder reveal that keeps a waiting container from reading as empty. `selectorName` is a class selector, dot included. */
export const silhouetteReveal = (selectorName, at, { opacity = CONTAINER_SILHOUETTE_OPACITY, duration = 0.2 } = {}) =>
  `timeline.fromTo(select("${selectorName}"), { autoAlpha: 0 }, { autoAlpha: ${opacity}, duration: ${duration}, ease: "power2.out" }, ${t(at)});`;

/** Rise-in used for every discrete label so the vocabulary stays consistent. */
export const chipReveal = (selectorName, times, { stagger = 0.06, duration = 0.24 } = {}) => {
  const list = times.map((value) => t(value)).join(", ");
  return [
    `const revealTimes = [${list}];`,
    `select("${selectorName}").forEach((chip, index) => {`,
    `  timeline.fromTo(chip, { y: -20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: ${duration}, ease: "power3.out" }, revealTimes[Math.min(index, revealTimes.length - 1)] + index * ${stagger});`,
    "});"
  ].join("\n");
};

/** Validate the params a component needs so a bad Beat Map fails loudly, not silently. */
export const requireItems = (beat, minimum = 1) => {
  const items = beat.onScreenCopy ?? [];
  if (items.length < minimum) throw new Error(`${beat.id}: component needs at least ${minimum} on-screen label(s)`);
  return items;
};
