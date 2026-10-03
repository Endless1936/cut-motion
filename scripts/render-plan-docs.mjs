/**
 * Render the two prose documents of the motion-plan stage from the derived
 * artifacts. Both used to be written by hand every job; the prose that is
 * genuinely editorial comes from the job's `state/planning-inputs.json`
 * (`documents` block), everything else is derived from the beat map,
 * transcript and reconciliation.
 */
import { formatClock } from "./plan-artifacts.mjs";

const escapeCell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const dash = (value) => (value === undefined || value === null || value === "" ? "—" : value);

const cuesForBeat = (beat, cues) => {
  const explicit = new Set(beat.captionCueIds ?? []);
  if (explicit.size > 0) return cues.filter((cue) => explicit.has(cue.id));
  return cues.filter((cue) => cue.end > beat.start && cue.start < beat.end);
};

const cueLabel = (beat, cues) => {
  const matched = cuesForBeat(beat, cues);
  if (matched.length === 0) return "—";
  return matched.map((cue) => cue.id).join(" + ");
};

const cueText = (beat, cues) => cuesForBeat(beat, cues).map((cue) => cue.text).join(" / ");

/**
 * The first three Global-direction lines describe the design system, not the
 * film, so they are derived from `state/design-system.json` instead of being
 * typed out per job - which is where the two drifted apart. Only the editorial
 * lines (which axes are used, how the film ends) remain authored. If an input
 * repeats a derived line, omit that duplicate instead of failing plan output.
 */
const DERIVED_DIRECTION_LABELS = /^(caption\s+mode|字幕模式|typography|字体|排版|palette|配色)\s*[:：]/i;

const derivedGlobalDirection = ({ captionMode, cues, designSystem }) => {
  const typography = designSystem.typography ?? {};
  const captions = designSystem.captions ?? {};
  const palette = designSystem.palette ?? {};
  const accents = ["cobalt", "coral", "green", "yellow", "violet"]
    .filter((token) => palette[token] !== undefined)
    .map((token) => `${token} \`${palette[token]}\``);
  return [
    `Caption mode：\`${captionMode}\`，${cues.length} 条单行字幕承载全部措辞`,
    `Typography：${typography.displayNameZh ?? typography.displayFamily}（${typography.displayFamily}）${typography.fontWeight}；主文案 ${(typography.primarySizePx ?? []).join("–")} px，次级 ${(typography.secondarySizePx ?? []).join("–")} px，outlineReserve ${typography.outlineReservePx} px；字幕 ${captions.fontSizePx} px / 行高 ${captions.lineHeight} / 最多 ${captions.maximumLines} 行`,
    `Palette：纸面 \`${palette.paper}\`、正文 \`${palette.ink}\`、强调 ${accents.join(" / ")}、连线取 \`${designSystem.motionContract?.connectorColorToken ?? "connector"}\` token`
  ];
};

const nonDerivedGlobalDirection = (globalDirection = []) => globalDirection.filter((item) => {
    // Match field labels only; ordinary editorial prose remains unrestricted.
    const label = item.trim().replace(/^(?:[-+*]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)/, "").replace(/[*_`]/g, "");
    return !DERIVED_DIRECTION_LABELS.test(label);
  });

export const renderMotionPlanDoc = ({ jobId, captionMode, visualAxisMode, transcript, beatMap, cues, designSystem, extra = {} }) => {
  const lines = [];
  const localBeats = beatMap.beats.filter((beat) => beat.mgScope === "local");

  lines.push(
    `# 分镜与 MG 方案 · ${jobId}`,
    "",
    captionMode === "subtitles"
      ? "> 本文只列需要制作的 MG 节点；字幕全文见 `docs/caption-plan.md`。"
      : "> 本文列出需要制作的 MG 节点及对应动态文案。",
    "",
    `- 当前字幕模式：\`${captionMode}\`（口播 + 单行字幕承载完整措辞，MG 只做补充）`,
    `- 视觉轴：\`${visualAxisMode}\`。`,
    `- 载体：\`${extra.mediaPath ?? "roughcut/a-roll.mp4"}\`；设计系统沿用 \`state/design-system.json\``,
    `- 时长：${transcript.duration.toFixed(1)} s；局部 MG：${localBeats.length} 个`,
    "",
    "## Global direction",
    ""
  );
  const authoredDirection = nonDerivedGlobalDirection(extra.globalDirection);
  for (const item of [
    ...derivedGlobalDirection({ captionMode, cues, designSystem }),
    ...authoredDirection
  ]) lines.push(`- ${item.replace(/^-\s*/, "")}`);
  lines.push(
    "",
    "## MG 节点",
    ""
  );

  for (const beat of localBeats) {
    const cueIds = cueLabel(beat, cues);
    lines.push(
      `### ${beat.id} · ${escapeCell(extra.headlines?.[beat.id] ?? beat.intent)}（${formatClock(beat.start)}–${formatClock(beat.end)}，${(beat.end - beat.start).toFixed(2)} s，${beat.axis} 轴）`,
      "",
      `- 模板：\`${beat.templateId ?? beat.mgComponent ?? beat.recipe}\`；启动锚点：\`${beat.entryAnchorWordId ?? beat.audioAnchorTime}\``,
      `- 上屏原文（仅此${beat.onScreenCopy.length}项可入画）：${beat.onScreenCopy.map((copy) => `\`${copy}\``).join(" ")}`,
      `- 对应字幕：${cueIds} — ${escapeCell(cueText(beat, cues))}`,
      `- 用途：${escapeCell(beat.intent)}；任务 \`${beat.supportRole}\``,
      `- 表现：${escapeCell(beat.visualStyle)}；拓扑 \`${beat.semanticTopology}\`，主轴 \`${beat.primaryFlowAxis}\`，参考 \`${beat.visualReference}\``,
      `- 位置：${beat.layout.primaryBoundsNormalized.x}, ${beat.layout.primaryBoundsNormalized.y}，${beat.layout.primaryBoundsNormalized.width}×${beat.layout.primaryBoundsNormalized.height}；遮脸 \`${beat.layout.faceCover}\`${beat.layout.faceSafetyNote ? ` — ${escapeCell(beat.layout.faceSafetyNote)}` : ""}`
    );
    if (beat.reuseGroup) lines.push(`- 复用：\`reuseGroup: ${beat.reuseGroup}\` — ${escapeCell(beat.reuseReason)}`);
    if (beat.factualClaims?.length) lines.push(`- 事实来源：${beat.factualClaims.map((claim) => `${claim.claim}（${claim.source}）`).join("；")}`);
    else if (beat.evidenceSource) lines.push(`- 事实来源：${escapeCell(beat.evidenceSource)}`);
    lines.push("");
  }

  if (extra.openQuestions?.length) {
    lines.push("## 遗留问题（需要裁决，不影响本方案成立）", "");
    extra.openQuestions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
    lines.push("");
  }
  return `${lines.join("\n")}`;
};

export const renderCreativeConfirmationDoc = ({
  workflow,
  reconciliation,
  annotationState,
  extra = {}
}) => {
  const lines = [];
  const unresolved = (reconciliation.items ?? []).filter((item) => item.resolution === "unresolved" && item.releaseImpact === true);
  const annotations = annotationState?.annotations ?? [];

  lines.push(
    "# 创意确认包",
    "",
    `- 字幕模式：\`${workflow.captionMode}\`。`,
    `- 视觉轴：\`${workflow.visualAxisMode}\`。`,
    "- 录音是最终文案依据；参考稿只辅助术语和拼写。"
  );
  if (unresolved.length > 0) lines.push(`- 未解决且影响发布的文案冲突：${unresolved.map((item) => item.id).join("、")}`);
  for (const item of extra.wordingNotes ?? []) lines.push(`- ${item}`);
  if (annotations.length > 0) {
    lines.push(
      "",
      "## 参考稿批注",
      "",
      "| ID | 原批注 | 处理结果 | 最终画面 / Beat |",
      "| --- | --- | --- | --- |"
    );
    for (const decision of extra.annotationDecisions ?? []) {
      const source = annotations.find((annotation) => annotation.id === decision.id);
      lines.push(`| ${decision.id} | ${escapeCell(source?.instruction ?? "")} | ${escapeCell(decision.disposition)} | ${escapeCell(decision.finalTreatment)} / ${escapeCell((decision.beatIds ?? []).join(", "))} |`);
    }
  }

  if (extra.axisNote) lines.push(`- 轴向说明：${escapeCell(extra.axisNote)}`);
  if (extra.openQuestions?.length) {
    lines.push("## 待用户裁决的事项", "");
    extra.openQuestions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
    lines.push("");
  }
  return `${lines.join("\n")}`;
};
