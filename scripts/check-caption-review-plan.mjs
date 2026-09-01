import fs from "node:fs";
import path from "node:path";
import { sha256File } from "./workflow-utils.mjs";
import { resolveCaptionCues } from "./caption-review-utils.mjs";

const [planPathArgument] = process.argv.slice(2);
if (!planPathArgument) {
  console.error("Usage: node check-caption-review-plan.mjs <caption-review-plan.json>");
  process.exit(64);
}

const planPath = path.resolve(planPathArgument);
const jobDirectory = path.dirname(path.dirname(planPath));
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const transcriptPath = path.join(jobDirectory, "state", "transcript.json");
const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
const referenceText = transcript.segments.map((segment) => segment.text).join("");
const lexicon = JSON.parse(fs.readFileSync(path.join(jobDirectory, "captions", "caption-lexicon.json"), "utf8"));
const errors = [];
const warnings = [];
const ignored = /[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u;
const normalize = (value) => [...value.normalize("NFKC").toLowerCase()].filter((character) => !ignored.test(character)).join("");
const displayUnits = (value) => [...value.normalize("NFKC")].reduce((sum, character) => {
  if (/\s/.test(character)) return sum + 0.25;
  if (/[\u0000-\u007f]/.test(character)) return sum + 0.55;
  if (/[，。；：！？、]/u.test(character)) return sum + 0.5;
  return sum + 1;
}, 0);

if (!["proposed", "approved"].includes(plan.status)) errors.push("caption review plan status must be proposed or approved");
if (plan.wordingAuthority !== "state/transcript.json") errors.push("wordingAuthority must be state/transcript.json");
if (plan.transcriptRevision !== (transcript.revision ?? 1)) errors.push("caption plan transcript revision is stale");
if (plan.transcriptSha256 !== sha256File(transcriptPath)) errors.push("caption plan transcript fingerprint is stale");
if (plan.rules?.exactlyOneLine !== true) errors.push("caption review plan must require exactly one line");
for (const term of lexicon.protectedTerms ?? []) {
  if (!(plan.rules?.protectedTerms ?? []).includes(term)) errors.push(`caption plan omitted protected term: ${term}`);
}
if (plan.rules?.minimumDurationSeconds !== 0.5
  || plan.rules?.targetDisplayUnits?.[0] !== 4
  || plan.rules?.targetDisplayUnits?.[1] !== 10.5
  || plan.rules?.maximumDisplayUnits !== 11.8) {
  errors.push("caption plan cannot relax the binding duration or width limits");
}
if (!Array.isArray(plan.cues) || plan.cues.length === 0) errors.push("caption review plan has no cues");
if (normalize(plan.cues.map((cue) => cue.text).join("")) !== normalize(referenceText)) {
  errors.push("caption cues do not preserve the approved reference transcript");
}

let resolvedCues = [];
try {
  resolvedCues = resolveCaptionCues(plan, transcript);
} catch (error) {
  errors.push(error.message);
}
const totalWordCount = (transcript.segments ?? []).reduce((sum, segment) => sum + (segment.words?.length ?? 0), 0);
if (resolvedCues.length > 0 && resolvedCues.at(-1).endWordIndex !== totalWordCount - 1) {
  errors.push("caption word ranges do not cover the complete transcript");
}

let previousEnd = -Infinity;
let characterOffset = 0;
const cueRanges = [];
for (const [index, cue] of resolvedCues.entries()) {
  const expectedId = `caption-${String(index + 1).padStart(4, "0")}`;
  if (cue.id !== expectedId) errors.push(`${cue.id}: expected sequential ID ${expectedId}`);
  if (/[\r\n]/.test(cue.text)) errors.push(`${cue.id}: cue must render on exactly one line`);
  if (normalize(cue.text) !== normalize(cue.resolvedText)) errors.push(`${cue.id}: text does not match its selected transcript word range`);
  const normalizedText = normalize(cue.text);
  if (normalizedText.length < 2) errors.push(`${cue.id}: one-character cues are forbidden`);
  const cueRange = { start: characterOffset, end: characterOffset + normalizedText.length - 1, id: cue.id };
  characterOffset += normalizedText.length;
  cueRanges.push(cueRange);
  if (!(cue.end > cue.start)) errors.push(`${cue.id}: end must be greater than start`);
  if (cue.start < previousEnd - 0.001) errors.push(`${cue.id}: cues overlap`);
  const duration = cue.end - cue.start;
  if (duration < plan.rules.minimumDurationSeconds) errors.push(`${cue.id}: duration ${duration.toFixed(2)}s is below ${plan.rules.minimumDurationSeconds}s`);
  if (duration > plan.rules.targetDurationSeconds[1] + 0.05) warnings.push(`${cue.id}: duration ${duration.toFixed(2)}s exceeds target`);
  const units = displayUnits(cue.text);
  if (units > plan.rules.maximumDisplayUnits) errors.push(`${cue.id}: ${units.toFixed(2)} display units exceed ${plan.rules.maximumDisplayUnits}`);
  const shortException = plan.exceptions?.[cue.id];
  if (units < 4 && (shortException?.kind !== "meaningful-short-closing" || !String(shortException?.reason ?? "").trim())) {
    errors.push(`${cue.id}: ${units.toFixed(2)} display units require a meaningful-short exception with reason`);
  }
  if (units > 10.5 && !(cue.fitFontSizePx >= 88 && cue.fitFontSizePx <= 96)) errors.push(`${cue.id}: long cue requires fitFontSizePx between 88 and 96`);
  const fixedForbidden = ["的", "了", "着", "过", "啊", "吧", "吗", "呢", "与", "和", "但", "所以", "因为", "而"];
  if (fixedForbidden.includes(normalizedText) || plan.rules.forbiddenStandaloneCues.includes(normalizedText)) errors.push(`${cue.id}: function word cannot stand alone`);
  const endsWithQuestion = /[?？]$/u.test(cue.text);
  const punctuationBody = (endsWithQuestion ? cue.text.slice(0, -1) : cue.text)
    .replace(/(?<=[A-Za-z0-9])\.(?=[A-Za-z0-9])/g, "");
  if (/[，。；：！!、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u.test(punctuationBody)) {
    errors.push(`${cue.id}: punctuation is only allowed as a final question mark`);
  }
  if (!endsWithQuestion && /[?？]/u.test(cue.text)) {
    errors.push(`${cue.id}: question marks are only allowed at the end of a cue`);
  }
  previousEnd = cue.end;
}
const fullText = normalize(referenceText);
for (const term of plan.rules.protectedTerms ?? []) {
  const normalizedTerm = normalize(term);
  let offset = fullText.indexOf(normalizedTerm);
  if (offset < 0) errors.push(`protected term is not present in the approved transcript: ${term}`);
  while (offset >= 0) {
    const end = offset + normalizedTerm.length - 1;
    if (!cueRanges.some((range) => offset >= range.start && end <= range.end)) {
      errors.push(`protected term is split across cues: ${term}`);
    }
    offset = fullText.indexOf(normalizedTerm, offset + 1);
  }
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`Caption review plan passed: ${plan.cues.length} semantic cue(s), ${warnings.length} warning(s)`);
