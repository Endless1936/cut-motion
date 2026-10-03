import fs from "node:fs";
import path from "node:path";
import { resolveCaptionCues } from "./caption-review-utils.mjs";

const [jobDirectoryArgument] = process.argv.slice(2);
if (!jobDirectoryArgument) {
  console.error("Usage: node render-caption-review-doc.mjs <job-directory>");
  process.exit(64);
}

const jobDirectory = path.resolve(jobDirectoryArgument);
const semanticPlanPath = path.join(jobDirectory, "captions", "caption-review-plan.json");
if (!fs.existsSync(semanticPlanPath)) throw new Error("captions/caption-review-plan.json is required");
const plan = JSON.parse(fs.readFileSync(semanticPlanPath, "utf8"));
const transcript = JSON.parse(fs.readFileSync(path.join(jobDirectory, "state", "transcript.json"), "utf8"));
const captions = { ...plan, cues: resolveCaptionCues(plan, transcript) };

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const followsMainTimelineEntries = captions.segmentationAuthority === "ChatCut main timeline transcript entries";
const usesManualPhraseCues = captions.segmentationAuthority === "agent-authored phrase cues within ChatCut main timeline entries"
  || captions.segmentationAuthority === "agent-authored phrase cues within transcript segments";
const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
};
const lines = [
  "# 字幕方案",
  "",
  usesManualPhraseCues
    ? "> 字幕按中文自然短语切分；文字来自已批准逐字稿，每条时间限制在对应主时间线条目的范围内。"
    : followsMainTimelineEntries
    ? "> 字幕严格沿用已批准的 ChatCut 主时间线条目边界；逐字稿提供文字，条目范围提供时间。"
    : "> 字幕按中文自然短语切分；逐字稿提供文字和时间。",
  "",
  usesManualPhraseCues
    ? `- ${captions.cues.length} 条单行字幕；按语义拆分较长条目，每行不超过 10 个显示单位（中文 1 字，英文约 3 个字符计 1 个单位）。每条保留对应主条目的时间范围。`
    : followsMainTimelineEntries
    ? `- ${captions.cues.length} 条单行字幕；每行不超过 10 个显示单位（中文 1 字，英文约 3 个字符计 1 个单位）。`
    : `- ${captions.cues.length} 条单行字幕；自然词组断句，每行不超过 10 个显示单位（中文 1 字，英文约 3 个字符计 1 个单位）；不拆受保护词组或留下单字虚词。`,
  "- 字幕时长按语速自然安排；短句通常 0.8–2.5 秒，避免短于 0.5 秒。",
  "",
  "## 完整字幕切分",
  "",
  "| Cue | 时间 | 单行字幕 |",
  "| --- | --- | --- |"
];

for (const cue of captions.cues) {
  const text = cue.text ?? cue.lines?.[0] ?? "";
  lines.push(`| ${cue.id} | ${formatTime(cue.start)}–${formatTime(cue.end)} | ${escapeCell(text)} |`);
}

lines.push("");

const outputPath = path.join(jobDirectory, "docs", "caption-plan.md");
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Caption review plan written: ${outputPath}`);
