#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { prepareSpeechTiming } from "./mg-speech-timing.mjs";
const [job, lookupPath, ...flags] = process.argv.slice(2);
if (!job || !lookupPath) throw new Error("Usage: prepare-mg-speech-timing.mjs <job> <ChatCut-word-lookup-json> [--write]");
const timing = prepareSpeechTiming(path.resolve(job), JSON.parse(fs.readFileSync(lookupPath, "utf8")));
if (flags.includes("--write")) fs.writeFileSync(path.join(job, "state/mg-speech-timing.json"), `${JSON.stringify(timing, null, 2)}\n`);
console.log(`${timing.words.length} source-timed words mapped to the approved cut (${timing.fps} fps)`);
