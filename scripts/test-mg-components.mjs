#!/usr/bin/env node
/**
 * Contract tests for the MG component library (mg-library/).
 *
 * The component library replaced hand-written per-beat timelines. Those
 * hand-written timelines carried design decisions that no schema recorded, so
 * the refactor can silently drop one. This test pins the two classes of rule
 * that a render-time check cannot see:
 *
 *   1. Structural — every component emits a panel with a checked motion
 *      surface, only references selectors it actually rendered, and never
 *      touches root opacity (the composition builder owns the exit fade).
 *   2. Temporal — a container must never sit visibly settled and empty. A
 *      tinted box that stays blank for longer than the silhouette lead reads as
 *      a broken placeholder rather than a pending result. This is the rule that
 *      the b07 mapping refactor dropped, discovered by A/B comparing the
 *      component output against the approved hand-written baseline.
 *
 * The temporal check replays the emitted tween source through a small linear
 * model of GSAP. GSAP's easings are all >= linear on a 0 -> 1 ramp, so the
 * model under-reports opacity and only fails when the gap is unambiguous.
 */
import assert from "node:assert/strict";
import { componentNames, resolveComponent } from "../mg-library/index.mjs";
import { panelGeometry, SILHOUETTE_LEAD_SECONDS } from "../mg-library/shared.mjs";

const FPS = 30;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOUNDS = { x: 0.06, y: 0.42, width: 0.88, height: 0.3 };

/**
 * `containers` maps a container selector to the selectors that count as its
 * content. Decorative elements (a pulsing dot, a border) are deliberately not
 * listed: a dot on its own does not make a container read as populated.
 */
const FIXTURES = {
  mapping: [
    {
      name: "mapping-late-label",
      // The real b07-workflow-mapping shape: the output container opens 0.8s
      // before the audio names the result.
      beat: {
        id: "fx-mapping-late",
        start: 13.1,
        end: 16.093,
        axis: "A",
        recipe: "vertical-build",
        onScreenCopy: ["Codex", "图书带货视频"],
        layout: { faceCover: "partial", primaryBoundsNormalized: BOUNDS },
        microEvents: [
          { time: 13.2, type: "tool-chip-in" },
          { time: 13.7, type: "link-line" },
          { time: 13.7, type: "output-container" },
          { time: 14.5, type: "output-label" },
          { time: 15.5, type: "link-lock" }
        ]
      },
      containers: [
        [".panel", [".source-chip", ".output-name"]],
        [".output-box", [".output-name"]]
      ],
      containerAt: 13.7,
      labelAt: 14.5,
      expectSilhouette: true
    },
    {
      name: "mapping-prompt-label",
      // Container and label land together: a silhouette here would be noise.
      beat: {
        id: "fx-mapping-prompt",
        start: 13.1,
        end: 16.093,
        axis: "A",
        recipe: "vertical-build",
        onScreenCopy: ["Codex", "图书带货视频"],
        layout: { faceCover: "partial", primaryBoundsNormalized: BOUNDS },
        microEvents: [
          { time: 13.2, type: "tool-chip-in" },
          { time: 13.7, type: "link-line" },
          { time: 13.7, type: "output-container" },
          { time: 13.75, type: "output-label" },
          { time: 15.5, type: "link-lock" }
        ]
      },
      containers: [
        [".panel", [".source-chip", ".output-name"]],
        [".output-box", [".output-name"]]
      ],
      containerAt: 13.7,
      labelAt: 13.75,
      expectSilhouette: false
    }
  ],
  convergence: [
    {
      name: "convergence-four-sources",
      beat: {
        id: "fx-convergence",
        start: 7.14,
        end: 10.5,
        axis: "A",
        recipe: "convergence-build",
        onScreenCopy: ["文案", "画面", "音频", "剪辑", "豆包"],
        layout: { faceCover: "partial", primaryBoundsNormalized: BOUNDS },
        microEvents: [
          { time: 7.24, type: "source-chip-in" },
          { time: 7.3, type: "source-chip-in" },
          { time: 7.36, type: "source-chip-in" },
          { time: 7.42, type: "source-chip-in" },
          { time: 7.6, type: "merge-line" },
          { time: 9, type: "result-lock" }
        ]
      },
      containers: [
        [".panel", [".source-chip", ".result-name"]],
        [".result-box", [".result-name"]]
      ]
    }
  ],
  strikeout: [
    {
      name: "strikeout-single-label",
      beat: {
        id: "fx-strikeout",
        start: 18.7,
        end: 21.4,
        axis: "A",
        recipe: "tool-strikeout",
        onScreenCopy: ["Codex"],
        layout: { faceCover: "partial", primaryBoundsNormalized: BOUNDS },
        microEvents: [
          { time: 18.8, type: "tool-chip-in" },
          { time: 19.95, type: "strike-start" },
          { time: 20.7, type: "strike-lock" }
        ]
      },
      containers: [[".panel", [".tool-name"]]]
    }
  ],
  "list-ordered": [
    {
      name: "list-ordered-three",
      beat: {
        id: "fx-list-ordered",
        start: 1,
        end: 4,
        axis: "A",
        recipe: "ordered-list",
        onScreenCopy: ["第一件事", "第二件事", "第三件事"],
        layout: { faceCover: "none", primaryBoundsNormalized: BOUNDS },
        microEvents: [{ time: 1.2, type: "entry" }, { time: 1.6, type: "entry" }, { time: 2, type: "entry" }]
      },
      containers: []
    }
  ],
  "list-unordered": [
    {
      name: "list-unordered-three",
      beat: {
        id: "fx-list-unordered",
        start: 1,
        end: 4,
        axis: "A",
        recipe: "list-build",
        onScreenCopy: ["第一件事", "第二件事", "第三件事"],
        layout: { faceCover: "none", primaryBoundsNormalized: BOUNDS },
        microEvents: [{ time: 1.2, type: "entry" }, { time: 1.6, type: "entry" }, { time: 2, type: "entry" }]
      },
      containers: []
    }
  ],
  quote: [
    {
      name: "quote-two",
      beat: {
        id: "fx-quote",
        start: 1,
        end: 4,
        axis: "A",
        recipe: "quote-reveal",
        onScreenCopy: ["第一行", "第二行"],
        layout: { faceCover: "none", primaryBoundsNormalized: BOUNDS },
        microEvents: [{ time: 1.2, type: "entry" }, { time: 1.6, type: "entry" }]
      },
      containers: []
    }
  ],
  "code-block": [
    {
      name: "code-block-three",
      beat: {
        id: "fx-code-block",
        start: 1,
        end: 4,
        axis: "A",
        recipe: "code-build",
        onScreenCopy: ["npm i a", "npm i b", "npm i c"],
        layout: { faceCover: "none", primaryBoundsNormalized: BOUNDS },
        microEvents: [{ time: 1.2, type: "entry" }, { time: 1.5, type: "entry" }, { time: 1.8, type: "entry" }]
      },
      containers: [[".code-frame", [".code-line"]]]
    }
  ],
  heading: [
    {
      name: "heading-one",
      beat: {
        id: "fx-heading",
        start: 1,
        end: 4,
        axis: "A",
        recipe: "title-reveal",
        onScreenCopy: ["一句话主张"],
        layout: { faceCover: "none", primaryBoundsNormalized: BOUNDS },
        microEvents: [{ time: 1.2, type: "entry" }]
      },
      containers: []
    }
  ]
};

// ---------------------------------------------------------------------------
// A small linear model of the emitted GSAP source
// ---------------------------------------------------------------------------

const splitTopLevel = (text) => {
  const parts = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (const character of text) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(" || character === "{" || character === "[") depth += 1;
    if (character === ")" || character === "}" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts.map((part) => part.trim());
};

const parseVars = (text) => {
  const body = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  const vars = {};
  for (const part of splitTopLevel(body)) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    vars[key] = /^-?[0-9.]+$/.test(raw) ? Number(raw) : raw.replace(/^"|"$/g, "");
  }
  return vars;
};

const callBodies = (source) => {
  const calls = [];
  const pattern = /timeline\.(set|to|fromTo|from)\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const open = pattern.lastIndex - 1;
    let depth = 0;
    let index = open;
    for (; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    calls.push({ kind: match[1], args: splitTopLevel(source.slice(open + 1, index - 1)) });
    pattern.lastIndex = index;
  }
  return calls;
};

/** `const sourceChip = select(".source-chip");` -> { sourceChip: ".source-chip" } */
const selectorBindings = (source) => {
  const bindings = {};
  const pattern = /const\s+([A-Za-z_$][\w$]*)\s*=\s*select\("([^"]+)"\)/g;
  let match;
  while ((match = pattern.exec(source))) bindings[match[1]] = match[2];
  return bindings;
};

const allSelectors = (source) => [...source.matchAll(/select\("([^"]+)"\)/g)].map((match) => match[1]);

const resolveTarget = (argument, bindings) => {
  const direct = /^select\("([^"]+)"\)$/.exec(argument);
  if (direct) return direct[1];
  const indexed = /^([A-Za-z_$][\w$]*)\[\d+\]$/.exec(argument);
  if (indexed) return bindings[indexed[1]] ?? null;
  if (argument === "root") return "root";
  return bindings[argument] ?? null;
};

const modelTweens = (source) => {
  const bindings = selectorBindings(source);
  return callBodies(source).map((call) => {
    const target = resolveTarget(call.args[0] ?? "", bindings);
    const numeric = (value) => (/^-?[0-9.]+$/.test((value ?? "").trim()) ? Number(value) : null);
    if (call.kind === "fromTo") {
      const from = parseVars(call.args[1] ?? "{}");
      const to = parseVars(call.args[2] ?? "{}");
      return { kind: call.kind, target, from, to, time: numeric(call.args[3]) };
    }
    if (call.kind === "to" || call.kind === "set") {
      const to = parseVars(call.args[1] ?? "{}");
      return { kind: call.kind, target, from: null, to, time: numeric(call.args[2]) };
    }
    const from = parseVars(call.args[1] ?? "{}");
    return { kind: call.kind, target, from, to: null, time: numeric(call.args[2]) };
  });
};

const opacityOf = (vars, fallback) => {
  if (!vars) return fallback;
  if (vars.autoAlpha !== undefined) return Number(vars.autoAlpha);
  if (vars.opacity !== undefined) return Number(vars.opacity);
  return fallback;
};

/**
 * Replay the tweens that target `selector` and report opacity at `at`.
 * Resting opacity comes from the last `fromTo`/`from` in source order, because
 * GSAP renders those from-values immediately when the tween is created.
 */
const opacityAt = (tweens, selector, at, rest = 0) => {
  const own = tweens.filter((tween) => tween.target === selector && tween.time !== null);
  let value = rest;
  const sourceOrdered = own.filter((tween) => tween.kind === "fromTo" || tween.kind === "from");
  if (sourceOrdered.length > 0) value = opacityOf(sourceOrdered.at(-1).from, value);
  for (const tween of own.slice().sort((left, right) => left.time - right.time)) {
    if (tween.time > at) break;
    const startValue = opacityOf(tween.from, value);
    const endValue = opacityOf(tween.to, startValue);
    const duration = Number(tween.to?.duration ?? tween.from?.duration ?? 0);
    const progress = duration <= 0 ? 1 : Math.min(1, Math.max(0, (at - tween.time) / duration));
    value = startValue + (endValue - startValue) * progress;
  }
  return value;
};

/**
 * Resting opacity declared in the component CSS. An element is invisible until
 * a tween says otherwise only when its own rule sets `opacity:0`; everything
 * else starts visible, so a tween that never fires shows as a real gap.
 */
const restingOpacity = (style) => {
  const hidden = new Set();
  const pattern = /(?:^|\n)\.([A-Za-z0-9_-]+)\{([^}]*)\}/g;
  let match;
  while ((match = pattern.exec(style))) {
    if (/(?:^|;)opacity:0(?![.\d])/.test(match[2])) hidden.add(`.${match[1]}`);
  }
  return (selector) => (hidden.has(selector) ? 0 : 1);
};

/**
 * The rule: a container that has been settled for longer than the silhouette
 * lead must show at least one of its content selectors.
 */
const findEmptyContainer = (tweens, containers, beat, rest) => {
  const samples = [];
  for (let time = beat.start; time <= beat.end; time += 1 / FPS) samples.push(Number(time.toFixed(4)));
  const violations = [];
  for (const [container, contents] of containers) {
    let armedSince = null;
    for (const time of samples) {
      if (opacityAt(tweens, container, time, rest(container)) >= 0.9) {
        if (armedSince === null) armedSince = time;
      } else {
        armedSince = null;
      }
      if (armedSince === null || time - armedSince < SILHOUETTE_LEAD_SECONDS) continue;
      const best = Math.max(...contents.map((selector) => opacityAt(tweens, selector, time, rest(selector))));
      if (best < 0.1) violations.push({ container, contents, at: Number(time.toFixed(3)), held: Number((time - armedSince).toFixed(3)) });
    }
  }
  return violations;
};

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const renderFixture = (componentName, fixture) => {
  const component = resolveComponent(componentName);
  assert.ok(component, `${componentName}: not registered`);
  const geometry = panelGeometry(fixture.beat);
  const events = (fixture.beat.microEvents ?? []).slice().sort((left, right) => Number(left.time) - Number(right.time));
  return component.render({ beat: fixture.beat, geometry, events, beatMap: { fps: FPS }, fps: FPS });
};

let checkedComponents = 0;
let checkedFixtures = 0;

try {
  // Every shipped component must have a fixture, so a new component cannot ship
  // untested just because nobody remembered to add one.
  for (const name of componentNames()) {
    assert.ok(FIXTURES[name], `${name}: registered component has no contract fixture in test-mg-components.mjs`);
  }
  for (const name of Object.keys(FIXTURES)) {
    assert.ok(componentNames().includes(name), `${name}: fixture exists for an unregistered component`);
  }

  for (const [componentName, fixtures] of Object.entries(FIXTURES)) {
    checkedComponents += 1;
    for (const fixture of fixtures) {
      checkedFixtures += 1;
      const { inner, style, timeline } = renderFixture(componentName, fixture);
      const label = `${componentName}/${fixture.name}`;

      // --- structural -----------------------------------------------------
      assert.doesNotMatch(inner, /<(?:script|style|video|audio)\b/i, `${label}: emitted a forbidden element`);
      const opens = (inner.match(/<div\b/g) ?? []).length;
      const closes = (inner.match(/<\/div>/g) ?? []).length;
      assert.equal(opens, closes, `${label}: unbalanced <div> in the fragment`);
      assert.match(inner, /data-motion-surface="container"/, `${label}: no checked motion surface declared`);

      const snippet = [
        "const beat = {};",
        "const root = null;",
        "const select = () => [];",
        "const timeline = { set() {}, to() {}, fromTo() {}, from() {} };",
        "{",
        timeline,
        "}"
      ].join("\n");
      assert.doesNotThrow(() => new Function(snippet), `${label}: generated timeline is not valid JavaScript`);

      const tweens = modelTweens(timeline);
      const rest = restingOpacity(style);

      // Components must not fade the root: the composition builder owns the exit.
      for (const tween of tweens.filter((entry) => entry.target === "root")) {
        const value = opacityOf(tween.to, null);
        assert.ok(value === null || value > 0, `${label}: component animates root opacity to ${value}; the builder owns the exit fade`);
      }

      // Every selector the timeline drives must exist in the fragment, or the
      // tween silently animates nothing. `select()` is only ever handed a class
      // selector in this library, so a missing leading dot is itself a defect:
      // `select("output-name")` is a valid type selector that matches nothing.
      const classes = new Set([...inner.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
      for (const selector of new Set(allSelectors(timeline))) {
        assert.match(selector, /^\./, `${label}: select("${selector}") is not a class selector; the class selector needs a leading dot`);
        const name = selector.replace(/^\./, "");
        assert.ok(classes.has(name), `${label}: timeline drives ${selector}, which the fragment never renders`);
      }

      // --- temporal: no settled-and-empty container ------------------------
      const violations = findEmptyContainer(tweens, fixture.containers ?? [], fixture.beat, rest);
      assert.equal(
        violations.length,
        0,
        `${label}: container sat settled but empty at ${violations.slice(0, 3).map((entry) => `${entry.container}@${entry.at}s (held ${entry.held}s)`).join(", ")}`
      );

      // --- the specific silhouette behaviour -------------------------------
      if (fixture.expectSilhouette !== undefined) {
        const { containerAt, labelAt } = fixture;
        const wait = Number((labelAt - containerAt).toFixed(3));
        const silhouetteTweens = tweens.filter((tween) => tween.target === ".output-name" && tween.time !== null);
        const preLabel = silhouetteTweens.filter((tween) => tween.time < labelAt);
        const labelTween = silhouetteTweens.find((tween) => tween.time === labelAt);
        assert.ok(labelTween, `${label}: the output label never reveals at its planned event time ${labelAt}`);

        const midway = (containerAt + labelAt) / 2;
        const opacityWhileWaiting = opacityAt(tweens, ".output-name", midway, rest(".output-name"));

        if (fixture.expectSilhouette) {
          assert.ok(preLabel.length > 0, `${label}: the output container opens ${wait}s before its label with no placeholder reveal`);
          assert.ok(
            opacityWhileWaiting >= 0.15,
            `${label}: the output name is at opacity ${opacityWhileWaiting.toFixed(3)} while its container waits, so the box reads as empty`
          );
          assert.equal(labelTween.kind, "to", `${label}: the label reveal must continue from the silhouette, not restart from zero`);
        } else {
          assert.equal(preLabel.length, 0, `${label}: a placeholder reveal was emitted even though the label lands ${wait}s after its container`);
        }
        assert.ok(
          opacityAt(tweens, ".output-name", labelAt + 0.5, rest(".output-name")) > 0.9,
          `${label}: the output name never reaches full opacity`
        );
      }
    }
  }

  // --- the rule is load-bearing ------------------------------------------
  // The pre-fix hand-written mapping timeline, kept verbatim: it reveals the
  // container early and only fades the label in at 14.5. If this snippet ever
  // stops being reported as an empty container, the invariant above has been
  // weakened and would no longer have caught the original regression.
  const preFixTimeline = [
    'const outputBox = select(".output-box");',
    'const outputName = select(".output-name");',
    'timeline.fromTo(outputBox, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, 13.7);',
    'timeline.fromTo(outputName, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.26, ease: "power3.out" }, 14.5);'
  ].join("\n");
  const preFixTweens = modelTweens(preFixTimeline);
  const preFixViolations = findEmptyContainer(preFixTweens, [[".output-box", [".output-name"]]], { start: 13.1, end: 16.093 }, () => 0);
  assert.ok(
    preFixViolations.length > 0,
    "the empty-container invariant no longer flags the pre-fix mapping timeline, so it cannot catch this regression"
  );
  assert.equal(
    opacityAt(preFixTweens, ".output-name", 14.1, 0),
    0,
    "the pre-fix timeline should hold the output name at zero opacity until 14.5"
  );

  console.log(`MG component contract tests passed (${checkedFixtures} fixtures across ${checkedComponents} components).`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
