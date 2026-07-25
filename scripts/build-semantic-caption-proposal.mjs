import fs from "node:fs";
import path from "node:path";
import { sha256File } from "./workflow-utils.mjs";

const [jobDirectoryArgument] = process.argv.slice(2);
if (!jobDirectoryArgument) {
  console.error("Usage: node build-semantic-caption-proposal.mjs <job-directory>");
  process.exit(64);
}

const jobDirectory = path.resolve(jobDirectoryArgument);
const transcript = JSON.parse(fs.readFileSync(path.join(jobDirectory, "state", "transcript.json"), "utf8"));
const transcriptPath = path.join(jobDirectory, "state", "transcript.json");
const segmentationPath = path.join(jobDirectory, "captions", "caption-segmentation.txt");
const exceptionsPath = path.join(jobDirectory, "captions", "caption-exceptions.json");
const lexiconPath = path.join(jobDirectory, "captions", "caption-lexicon.json");
if (!fs.existsSync(lexiconPath)) throw new Error("Semantic caption planning requires captions/caption-lexicon.json");
const lexicon = JSON.parse(fs.readFileSync(lexiconPath, "utf8"));
const referenceText = transcript.segments.map((segment) => segment.text).join("");
const phrases = fs.readFileSync(segmentationPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const ignored = /[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u;
const normalizeCharacters = (value) => [...value.normalize("NFKC").toLowerCase()].filter((character) => !ignored.test(character));
const referenceCharacters = normalizeCharacters(referenceText);
const phraseCharacters = phrases.map(normalizeCharacters);
const segmentedCharacters = phraseCharacters.flat();
if (segmentedCharacters.join("") !== referenceCharacters.join("")) {
  throw new Error("caption-segmentation.txt must preserve the approved transcript verbatim after punctuation and spacing normalization");
}

const acousticCharacters = [];
for (const segment of transcript.segments) {
  for (const word of segment.words) {
    const characters = normalizeCharacters(word.text);
    for (let index = 0; index < characters.length; index += 1) {
      const start = word.start + (word.end - word.start) * index / characters.length;
      const end = word.start + (word.end - word.start) * (index + 1) / characters.length;
      acousticCharacters.push({ character: characters[index], start, end });
    }
  }
}

const rows = referenceCharacters.length + 1;
const columns = acousticCharacters.length + 1;
const costs = Array.from({ length: rows }, () => new Uint16Array(columns));
const moves = Array.from({ length: rows }, () => new Uint8Array(columns));
for (let row = 1; row < rows; row += 1) {
  costs[row][0] = row;
  moves[row][0] = 1;
}
for (let column = 1; column < columns; column += 1) {
  costs[0][column] = column;
  moves[0][column] = 2;
}
for (let row = 1; row < rows; row += 1) {
  for (let column = 1; column < columns; column += 1) {
    const substitution = costs[row - 1][column - 1]
      + (referenceCharacters[row - 1] === acousticCharacters[column - 1].character ? 0 : 1);
    const insertion = costs[row - 1][column] + 1;
    const deletion = costs[row][column - 1] + 1;
    const best = Math.min(substitution, insertion, deletion);
    costs[row][column] = best;
    moves[row][column] = best === substitution ? 0 : best === insertion ? 1 : 2;
  }
}

const referenceToAcoustic = new Array(referenceCharacters.length).fill(null);
let row = referenceCharacters.length;
let column = acousticCharacters.length;
while (row > 0 || column > 0) {
  const move = moves[row][column];
  if (row > 0 && column > 0 && move === 0) {
    referenceToAcoustic[row - 1] = column - 1;
    row -= 1;
    column -= 1;
  } else if (row > 0 && (column === 0 || move === 1)) {
    row -= 1;
  } else {
    column -= 1;
  }
}

const mappedTimings = referenceToAcoustic.map((acousticIndex) => acousticIndex === null ? null : acousticCharacters[acousticIndex]);
for (let index = 0; index < mappedTimings.length; index += 1) {
  if (mappedTimings[index]) continue;
  let previous = index - 1;
  let next = index + 1;
  while (previous >= 0 && !mappedTimings[previous]) previous -= 1;
  while (next < mappedTimings.length && !mappedTimings[next]) next += 1;
  if (previous >= 0 && next < mappedTimings.length) {
    const ratio = (index - previous) / (next - previous);
    const anchor = mappedTimings[previous].end
      + (mappedTimings[next].start - mappedTimings[previous].end) * ratio;
    mappedTimings[index] = { start: anchor, end: anchor };
  } else if (previous >= 0) {
    mappedTimings[index] = { start: mappedTimings[previous].end, end: mappedTimings[previous].end + 1 / 30 };
  } else if (next < mappedTimings.length) {
    mappedTimings[index] = { start: Math.max(0, mappedTimings[next].start - 1 / 30), end: mappedTimings[next].start };
  } else {
    throw new Error("Unable to align reference transcript to acoustic transcript");
  }
}

let characterOffset = 0;
const cues = phrases.map((text, index) => {
  const characters = phraseCharacters[index];
  const startCharacter = characterOffset;
  const endCharacter = characterOffset + characters.length - 1;
  characterOffset += characters.length;
  return {
    id: `caption-${String(index + 1).padStart(4, "0")}`,
    text,
    rawStart: mappedTimings[startCharacter].start,
    rawEnd: mappedTimings[endCharacter].end,
    referenceCharacterStart: startCharacter,
    referenceCharacterEnd: endCharacter
  };
});
const boundaries = [cues[0].rawStart];
for (let index = 1; index < cues.length; index += 1) {
  boundaries.push((cues[index - 1].rawEnd + cues[index].rawStart) / 2);
}
boundaries.push(cues.at(-1).rawEnd);
for (let index = 0; index < cues.length; index += 1) {
  cues[index].start = Number(boundaries[index].toFixed(6));
  cues[index].end = Number(boundaries[index + 1].toFixed(6));
  delete cues[index].rawStart;
  delete cues[index].rawEnd;
}
const minimumDurationSeconds = 0.5;
for (let index = cues.length - 1; index >= 0; index -= 1) {
  const duration = cues[index].end - cues[index].start;
  if (duration >= minimumDurationSeconds) continue;
  const deficit = minimumDurationSeconds - duration;
  if (index > 0 && cues[index - 1].end - cues[index - 1].start >= minimumDurationSeconds + deficit) {
    cues[index].start = Number((cues[index].start - deficit).toFixed(6));
    cues[index - 1].end = cues[index].start;
  } else if (index + 1 < cues.length && cues[index + 1].end - cues[index + 1].start >= minimumDurationSeconds + deficit) {
    cues[index].end = Number((cues[index].end + deficit).toFixed(6));
    cues[index + 1].start = cues[index].end;
  }
}

const proposal = {
  schemaVersion: "1.0.0",
  status: "proposed",
  wordingAuthority: "state/transcript.json",
  transcriptRevision: transcript.revision ?? 1,
  transcriptSha256: sha256File(transcriptPath),
  timingAuthority: "state/transcript.json reconciled word timestamps",
  segmentationAuthority: "captions/caption-segmentation.txt",
  rules: {
    exactlyOneLine: true,
    minimumDurationSeconds,
    targetDurationSeconds: [0.8, 2.5],
    targetDisplayUnits: [4, 10.5],
    maximumDisplayUnits: 11.8,
    fitFontSizePx: [88, 96],
    protectedTerms: lexicon.protectedTerms ?? [],
    forbiddenStandaloneCues: lexicon.forbiddenStandaloneCues ?? []
  },
  alignment: {
    referenceCharacters: referenceCharacters.length,
    acousticCharacters: acousticCharacters.length,
    editDistance: costs[referenceCharacters.length][acousticCharacters.length]
  },
  exceptions: fs.existsSync(exceptionsPath) ? JSON.parse(fs.readFileSync(exceptionsPath, "utf8")) : {},
  cues
};

const outputPath = path.join(jobDirectory, "captions", "caption-review-plan.json");
fs.writeFileSync(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
console.log(`Semantic caption proposal written: ${cues.length} cue(s), edit distance ${proposal.alignment.editDistance}`);
