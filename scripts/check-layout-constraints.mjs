import fs from "node:fs";

const [compositionPath, designSystemPath] = process.argv.slice(2);

if (!compositionPath || !designSystemPath) {
  console.error("Usage: node check-layout-constraints.mjs <index.html> <design-system.json>");
  process.exit(64);
}

const composition = fs.readFileSync(compositionPath, "utf8");
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const errors = [];
const typography = designSystem.typography ?? {};
const bAxisPolicy = designSystem.axisPolicies?.B ?? {};

if (typography.orphanLineAllowed !== false || typography.minimumLastLineCharacters < 2) {
  errors.push("design system must forbid single-character orphan lines");
}

if (!/data-layout-constraints\s*=\s*["']enforced["']/i.test(composition)) {
  errors.push("composition must declare enforced layout constraints");
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
