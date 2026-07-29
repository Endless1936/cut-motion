import fs from "node:fs";
import path from "node:path";
import { sha256File, writeJsonAtomic } from "./workflow-utils.mjs";
import { transcriptWords } from "./caption-review-utils.mjs";

const [planArgument] = process.argv.slice(2);
if (!planArgument) {
  console.error("Usage: node bind-caption-plan-word-ranges.mjs <caption-review-plan.json>");
  process.exit(64);
}

const planPath = path.resolve(planArgument);
const jobRoot = path.dirname(path.dirname(planPath));
const transcriptPath = path.join(jobRoot, "state", "transcript.json");
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
const installedCaptionsPath = path.join(jobRoot, "captions", "captions.json");
const installedCaptions = fs.existsSync(installedCaptionsPath)
  ? JSON.parse(fs.readFileSync(installedCaptionsPath, "utf8"))
  : null;
const installedById = new Map((installedCaptions?.cues ?? []).map((cue) => [cue.id, cue]));
const words = transcriptWords(transcript);
const ignored = /[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u;
const normalize = (value) => [...value.normalize("NFKC").toLowerCase()]
  .filter((character) => !ignored.test(character))
  .join("");

let wordCursor = 0;
for (const cue of plan.cues ?? []) {
  const target = normalize(cue.text);
  const startIndex = wordCursor;
  let assembled = "";
  while (wordCursor < words.length && assembled.length < target.length) {
    assembled += normalize(words[wordCursor].text);
    wordCursor += 1;
  }
  if (assembled !== target) {
    throw new Error(`${cue.id}: existing Agent-authored cue text does not exactly align to the next transcript words`);
  }
  cue.startWordId = words[startIndex].id;
  cue.endWordId = words[wordCursor - 1].id;
  const installedCue = installedById.get(cue.id);
  if (installedCue) {
    cue.start = installedCue.start;
    cue.end = installedCue.end;
  }
}
if (wordCursor !== words.length) throw new Error("Caption cues do not consume the complete transcript word sequence");
plan.transcriptRevision = transcript.revision ?? 1;
plan.transcriptSha256 = sha256File(transcriptPath);
writeJsonAtomic(planPath, plan);
console.log(`Bound ${(plan.cues ?? []).length} existing semantic cues to exact transcript word ranges`);
