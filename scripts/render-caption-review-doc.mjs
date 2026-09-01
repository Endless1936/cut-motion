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
const beatMap = JSON.parse(fs.readFileSync(path.join(jobDirectory, "state", "beat-map.json"), "utf8"));
const localBeats = beatMap.beats.filter((beat) => beat.mgScope === "local");
const localByCue = new Map();
for (const beat of localBeats) {
  for (const cueId of beat.captionCueIds ?? []) {
    const ids = localByCue.get(cueId) ?? [];
    ids.push(beat.id);
    localByCue.set(cueId, ids);
  }
}

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
};
const cueTextForBeat = (beat) => {
  const explicitIds = new Set(beat.captionCueIds ?? []);
  const matchingCues = explicitIds.size > 0
    ? captions.cues.filter((cue) => explicitIds.has(cue.id))
    : captions.cues.filter((cue) => cue.end > beat.start && cue.start < beat.end);
  return matchingCues.map((cue) => cue.text ?? cue.lines?.[0] ?? "").join(" / ");
};

const lines = [
  "# 字幕与 MG 审核方案",
  "",
  "> 本文是实现前合同。字幕切分、MG 节点、最终上屏原文、信息增量和视觉样式经用户批准后，才允许进入样片或全片制作。",
  "",
  `- 字幕：${captions.cues.length} 条；每条严格单行；文字与时序均来自录音校正后的逐字稿。`,
  "- 切分：先按完整词组、短语、分句和气口切，再检查实测字宽；禁止机械按字符数截断。",
  "- 约束：虚词不得单独成 cue；受保护词组不得跨 cue；每条至少 0.5 秒，目标 0.8–2.5 秒、4–10.5 个显示单位。",
  `- MG：${localBeats.length} 个精选语义节点；不设最低频率，不为“画面活跃”补节点。`,
  localBeats.some((beat) => beat.axis === "B")
    ? "- 轴向：混合轴向；默认 A 轴真人全屏，仅在已批准的局部节点切入 B 轴，字幕持续保留。"
    : "- 轴向：A 轴叠加模式；口播保持全屏，MG 局部出现并完整退场。",
  "",
  "## 完整字幕切分",
  "",
  "| Cue | 时间 | 单行字幕 | 字符数 | 对应 MG |",
  "| --- | --- | --- | ---: | --- |"
];

for (const cue of captions.cues) {
  const text = cue.text ?? cue.lines?.[0] ?? "";
  const nodeIds = localByCue.get(cue.id) ?? [];
  lines.push(`| ${cue.id} | ${formatTime(cue.start)}–${formatTime(cue.end)} | ${escapeCell(text)} | ${[...text.replaceAll(" ", "")].length} | ${nodeIds.length > 0 ? nodeIds.join(", ") : "无"} |`);
}

lines.push(
  "",
  "## MG 节点",
  "",
  "| 节点 | 时间 / 对应字幕 | 对应原句 | 最终上屏原文 | 观众问题 | 信息任务 | 删除损失 | 动画样式 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |"
);
for (const beat of localBeats) {
  const cueRange = beat.captionCueIds.length === 1
    ? beat.captionCueIds[0]
    : `${beat.captionCueIds[0]}–${beat.captionCueIds.at(-1)}`;
  lines.push(`| ${beat.id} | ${formatTime(beat.start)}–${formatTime(beat.end)} / ${cueRange} | ${escapeCell(cueTextForBeat(beat))} | ${escapeCell(beat.onScreenCopy.join(" / "))} | ${escapeCell(beat.viewerQuestion)} | ${escapeCell(beat.supportRole)} | ${escapeCell(beat.removalLoss)} | ${escapeCell(beat.visualStyle)} |`);
}

lines.push(
  "",
  "## 明确不加 MG 的段落",
  "",
  "| 时间 | 对应原句 | 不加原因 |",
  "| --- | --- | --- |"
);
for (const beat of beatMap.beats.filter((candidate) => candidate.mgScope === "none")) {
  lines.push(`| ${formatTime(beat.start)}–${formatTime(beat.end)} | ${escapeCell(cueTextForBeat(beat))} | 口播与字幕已完整表达；增加 MG 不能产生足以抵消注意力成本的具体信息增量。 |`);
}

lines.push(
  "",
  "## 变更控制",
  "",
  "用户批准后，只有不改变节点、文案、含义、样式家族和轴向的小幅位置、字号或缓动修正可直接实现。字幕切分、MG 节点或数量、上屏文案、任务、样式、轴向发生变化，必须退回本方案重新审核。",
  ""
);

const outputPath = path.join(jobDirectory, "docs", "caption-plan.md");
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Caption review plan written: ${outputPath}`);
