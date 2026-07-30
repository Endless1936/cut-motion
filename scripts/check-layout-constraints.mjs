import fs from "node:fs";
import path from "node:path";

const [compositionPath, designSystemPath] = process.argv.slice(2);

if (!compositionPath || !designSystemPath) {
  console.error("Usage: node check-layout-constraints.mjs <index.html> <design-system.json>");
  process.exit(64);
}

const composition = fs.readFileSync(compositionPath, "utf8");
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const beatMapSchema = JSON.parse(fs.readFileSync(new URL("../schemas/beat-map.schema.json", import.meta.url), "utf8"));
const informationRoles = beatMapSchema.properties.beats.items.properties.supportRole.enum;
const informationRolePattern = new RegExp(
  `data-information-role=["'](${informationRoles.join("|")})["']`,
  "i"
);
const errors = [];
const typography = designSystem.typography ?? {};
const bAxisPolicy = designSystem.axisPolicies?.B ?? {};
const motionContract = designSystem.motionContract ?? {};

if (typography.orphanLineAllowed !== false || typography.minimumLastLineCharacters < 2) {
  errors.push("design system must forbid single-character orphan lines");
}

if (!/data-layout-constraints\s*=\s*["']enforced["']/i.test(composition)) {
  errors.push("composition must declare enforced layout constraints");
}
if (!/data-motion-contract\s*=\s*["']enforced["']/i.test(composition)) errors.push("composition must declare the motion contract");
if (!/data-runtime-layout\s*=\s*["']hyperframes["']/i.test(composition)) errors.push("composition must delegate peak-frame layout checks to HyperFrames");
if (!composition.includes("window.__motionContract")) errors.push("composition must execute the browser motion contract");
if (!composition.includes('timeline.eventCallback("onUpdate", () => {')
  || !composition.includes("function checkedTotalTime(value, suppressEvents)")
  || !composition.includes("if (motionContractUpdateSerial === serialBeforeSeek) window.__motionContract(Number(value))")) {
  errors.push("motion contract must cover GSAP updates and direct HyperFrames timeline seeks");
}
if (motionContract.outerFrameAllowed !== false || motionContract.containerBorderPolicy !== "none") errors.push("design system must forbid generic outer frames and container borders");
if (!composition.includes(`--${motionContract.connectorColorToken}:`)) errors.push("composition must define the connector color token");

for (const match of composition.matchAll(/<[^>]+data-motion-surface=["']container["'][^>]*>/gi)) {
  if (!/data-border-policy=["']none["']/i.test(match[0])) errors.push("motion containers must declare border-policy none");
}
for (const match of composition.matchAll(/<[^>]+data-motion-role=["']connector["'][^>]*>/gi)) {
  if (!new RegExp(`data-color-token=["']${motionContract.connectorColorToken}["']`, "i").test(match[0])) errors.push("connectors must use the design-system connector token");
  if (!/data-color-property=["'](color|background-color|border-color)["']/i.test(match[0])) errors.push("connectors must declare the computed color property");
  if (!/data-reveal-group=["'][^"']+["']/i.test(match[0])) errors.push("connectors must declare a runtime reveal group");
  if (!/data-flow-axis=["'](horizontal|vertical)["']/i.test(match[0])) errors.push("connectors must declare their rendered flow axis");
}
for (const match of composition.matchAll(/<[^>]+data-motion-role=["']label["'][^>]*>/gi)) {
  if (!informationRolePattern.test(match[0])) {
    errors.push(`labels must declare data-information-role as one of: ${informationRoles.join(", ")}`);
  }
}
for (const match of composition.matchAll(/<[^>]+data-motion-group=["'][^"']+["'][^>]*>/gi)) {
  for (const declaration of [
    /data-axis=["'](A|B)["']/i,
    /data-group-kind=["'](primary|auxiliary)["']/i,
    /data-group-start=["'][0-9.]+["']/i,
    /data-group-duration=["'][0-9.]+["']/i,
    /data-face-cover=["'](none|partial|intentional)["']/i,
    /data-primary-flow-axis=["'](horizontal|vertical)["']/i,
    /data-semantic-topology=["'][^"']+["']/i
  ]) {
    if (!declaration.test(match[0])) errors.push("motion groups must declare axis, lifetime, face coverage, flow, and topology");
  }
}
if (designSystem.captions) {
  const captionStylesheetPath = path.join(path.dirname(compositionPath), "caption.css");
  if (!fs.existsSync(captionStylesheetPath)) {
    errors.push("composition requires a sibling caption.css");
  } else {
    const captionStylesheet = fs.readFileSync(captionStylesheetPath, "utf8");
    const captionLayerRule = /\.clip\.motion-caption-layer\s*\{([^}]*)\}/i.exec(captionStylesheet)?.[1] ?? "";
    if (!/top\s*:\s*auto\s*;/i.test(captionLayerRule)
      || !/bottom\s*:\s*var\(--caption-bottom\b/i.test(captionLayerRule)) {
      errors.push("caption layer must override generic clip inset and preserve the configured bottom offset");
    }
  }
  const expectedBottomPx = designSystem.canvas.height * designSystem.captions.bottomOffsetRatio;
  if (Math.abs(designSystem.captions.bottomOffsetPx - expectedBottomPx) > 0.5) errors.push("caption bottom offset must equal its canvas ratio");
  const ratio = Number(/data-caption-bottom-ratio=["']([0-9.]+)["']/i.exec(composition)?.[1]);
  if (!Number.isFinite(ratio) || Math.abs(ratio - designSystem.captions.bottomOffsetRatio) > 0.0001) errors.push("composition caption-bottom ratio must match the design system");
  const weight = Number(/data-caption-font-weight=["']([0-9]+)["']/i.exec(composition)?.[1]);
  if (weight !== designSystem.captions.fontWeight || weight > 500) errors.push("composition caption weight must remain the approved normal weight");
  for (const match of composition.matchAll(/<section[^>]*class=["'][^"']*\bmotion-caption-layer\b[^"']*["'][^>]*>/gi)) {
    const bottom = Number(/--caption-bottom\s*:\s*([0-9.]+)px/i.exec(match[0])?.[1]);
    if (!Number.isFinite(bottom) || Math.abs(bottom - expectedBottomPx) > 0.5) {
      errors.push("every caption layer must use the design-system bottom offset");
    }
  }
}

for (const match of composition.matchAll(/<[^>]+class=["']([^"']+)["'][^>]*>/gi)) {
  const classes = match[1].split(/\s+/);
  if (classes.some((name) => /(?:^|-)(?:card|panel)$/.test(name)) && !/data-motion-surface=["']container["']/i.test(match[0])) {
    errors.push("card and panel classes must declare a checked motion surface");
  }
  if (classes.some((name) => /(?:^|-)(?:label|tag|badge)$/.test(name)) && !/data-motion-role=["']label["']/i.test(match[0])) {
    errors.push("label, tag, and badge classes must declare an information role");
  }
}
for (const match of composition.matchAll(/\.motion-caption-line\s*\{([^}]*)\}/gi)) {
  if (/font-weight\s*:\s*(?:bold|[6-9]00)\b/i.test(match[1])) errors.push("caption CSS cannot override the approved normal weight");
  if (!/font-synthesis\s*:\s*none/i.test(match[1])) errors.push("caption CSS must disable synthetic bold");
}

for (const declaration of ["overflow-wrap: normal", "word-break: normal", "text-wrap: balance"]) {
  if (!composition.includes(declaration)) errors.push(`composition is missing no-orphan declaration: ${declaration}`);
}

const explicitLines = composition.split(/<br\s*\/?\s*>/i).slice(1);
for (const [index, line] of explicitLines.entries()) {
  const text = line.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const firstRun = text.match(/^[\p{Script=Han}]+/u)?.[0] ?? "";
  if (firstRun.length === 1) errors.push(`explicit line ${index + 2} begins with a one-character orphan: ${firstRun}`);
}

const usesPip = /id\s*=\s*["']speaker-pip["']/i.test(composition);
if (usesPip && bAxisPolicy.pipProtectionRequired) {
  const zone = bAxisPolicy.pipExclusionZone;
  if (![zone?.rightPx, zone?.bottomPx, zone?.widthPx, zone?.heightPx].every((value) => Number.isFinite(value) && value > 0)) {
    errors.push("B-axis PIP requires a measurable exclusion zone");
  }
  if (!/data-pip-safe-zone\s*=\s*["']required["']/i.test(composition)) {
    errors.push("PIP composition must mark at least one protected content zone");
  }
  if (!/\.pip-safe-zone\s*\{[^}]*var\(--pip-safe-right\)/s.test(composition)) {
    errors.push("PIP-safe content must reserve the declared right-side exclusion zone");
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);

console.log(`Layout constraints passed: no orphan lines; PIP protection ${usesPip ? "required" : "not used"}`);
