import fs from "node:fs";

const [compositionPath, designSystemPath] = process.argv.slice(2);

if (!compositionPath || !designSystemPath) {
  console.error("Usage: node check-information-value.mjs <index.html> <design-system.json>");
  process.exit(64);
}

const composition = fs.readFileSync(compositionPath, "utf8");
const designSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const minimumTextSize = designSystem.density.minimumVisibleTextPx ?? designSystem.typography.secondarySizePx[0];
const forbiddenLabels = designSystem.density.forbiddenSelfEvidentLabels ?? [];
const errors = [];

for (const match of composition.matchAll(/font-size\s*:\s*([^;}\n]+)/gi)) {
  const value = match[1].trim();
  const pixelMatch = value.match(/^([0-9]+(?:\.[0-9]+)?)px$/i);
  if (!pixelMatch) {
    errors.push(`font-size must use an auditable px value, found "${value}"`);
    continue;
  }
  const size = Number(pixelMatch[1]);
  if (size < minimumTextSize) errors.push(`visible text size ${size}px is below the ${minimumTextSize}px information floor`);
}

const visibleText = composition
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

for (const label of forbiddenLabels) {
  if (visibleText.includes(label)) errors.push(`self-evident label is forbidden: ${label}`);
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);

console.log(`Information-value check passed: minimum ${minimumTextSize}px; checked ${forbiddenLabels.length} forbidden self-evident label(s), none present`);
