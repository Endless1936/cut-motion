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

export const renderMotionPlanDoc = ({ jobId, captionMode, visualAxisMode, transcript, beatMap, cues, designSystem, extra = {} }) => {
  const lines = [];
  const localBeats = beatMap.beats.filter((beat) => beat.mgScope === "local");
  const captionOnlyBeats = beatMap.beats.filter((beat) => beat.mgScope === "none");
  const wordCount = transcript.segments.reduce((sum, segment) => sum + segment.words.length, 0);

  lines.push(
    `# 分镜与 MG 方案 · ${jobId}`,
    "",
    "> 面向用户的审核件是 `docs/creative-confirmation.md`；本文是逐拍的技术底稿。",
    "",
    `- 当前字幕模式：\`${captionMode}\`（口播 + 单行字幕承载完整措辞，MG 只做补充）`,
    `- 视觉轴：\`${visualAxisMode}\`（真人全屏、局部 MG 叠加）`,
    `- 依据：\`state/transcript.json\`（成片时间轴 revision ${transcript.revision ?? 1}）、\`state/beat-map.json\`、\`captions/caption-review-plan.json\``,
    `- 载体：\`${extra.mediaPath ?? "roughcut/a-roll.mp4"}\`；设计系统沿用 \`state/design-system.json\``,
    `- 规模：${transcript.segments.length} 句 / ${wordCount} 词 / ${transcript.duration.toFixed(1)} s；${beatMap.beats.length} 拍，其中 ${localBeats.length} 个局部 MG 节点`,
    "",
    "## Global direction",
    ""
  );
  for (const item of extra.globalDirection ?? []) lines.push(`- ${item}`);
  lines.push(
    "",
    "## 分镜表",
    "",
    "| Time | Audio phrase | Axis | Main flow | Visual reference | Visual treatment | Transition |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const beat of beatMap.beats) {
    const treatment = beat.mgScope === "local"
      ? dash(extra.treatments?.[beat.id] ?? `${beat.semanticTopology} · ${(beat.onScreenCopy ?? []).join(" / ")}`)
      : "纯字幕";
    lines.push([
      `${formatClock(beat.start)}–${formatClock(beat.end)}`,
      escapeCell(beat.text),
      beat.axis,
      dash(beat.primaryFlowAxis),
      dash(beat.visualReference),
      escapeCell(treatment),
      escapeCell(beat.transitionFamily ?? "字幕切换")
    ].join(" | ").replace(/^(.*)$/, "| $1 |"));
  }
  lines.push("", `时间为成片时间轴；每拍 \`audioAnchorTime\` 与 beat 起点一致，同步误差 0 帧。`, "", "## MG 节点明细", "");

  for (const beat of localBeats) {
    const cueIds = cueLabel(beat, cues);
    lines.push(
      `### ${beat.id} · ${escapeCell(extra.headlines?.[beat.id] ?? beat.intent)}（${formatClock(beat.start)}–${formatClock(beat.end)}，${(beat.end - beat.start).toFixed(2)} s）`,
      "",
      `- 语义拓扑 \`${beat.semanticTopology}\`；主推进轴 \`${beat.primaryFlowAxis}\`；继承范式 \`${beat.visualReference}\``,
      `- 上屏原文（仅此${beat.onScreenCopy.length}项可入画）：${beat.onScreenCopy.map((copy) => `\`${copy}\``).join(" ")}`,
      `- 对应字幕：${cueIds} — ${escapeCell(cueText(beat, cues))}`,
      `- 观众问题：${escapeCell(beat.viewerQuestion)}；任务 \`${beat.supportRole}\``,
      `- 动画样式：${escapeCell(beat.visualStyle)}`,
      `- 删除后的损失：${escapeCell(beat.removalLoss)}`,
      `- 信息增量：${escapeCell(beat.visualEncoding)}`,
      `- 布局：x ${beat.layout.primaryBoundsNormalized.x} / y ${beat.layout.primaryBoundsNormalized.y} / ${beat.layout.primaryBoundsNormalized.width}×${beat.layout.primaryBoundsNormalized.height}；占高 ${beat.layout.primaryOccupancyRatio}；面板内边距 ${beat.layout.panelPaddingPx} px`,
      `- 遮脸判断：\`${beat.layout.faceCover}\` — ${escapeCell(beat.layout.faceSafetyNote)}`
    );
    if (beat.reuseGroup) lines.push(`- 复用：\`reuseGroup: ${beat.reuseGroup}\` — ${escapeCell(beat.reuseReason)}`);
    if (beat.factualClaims?.length) lines.push(`- 事实来源：${beat.factualClaims.map((claim) => `${claim.claim}（${claim.source}）`).join("；")}`);
    else if (beat.evidenceSource) lines.push(`- 事实来源：${escapeCell(beat.evidenceSource)}`);
    lines.push("");
  }

  lines.push("## 明确不加 MG 的段落", "", "| Time | Audio phrase | Reason |", "| --- | --- | --- |");
  for (const beat of captionOnlyBeats) {
    lines.push(`| ${formatClock(beat.start)}–${formatClock(beat.end)} | ${escapeCell(beat.text)} | ${escapeCell(beat.notes ?? "口播与字幕已完整表达；增加 MG 不能产生足以抵消注意力成本的具体信息增量。")} |`);
  }

  lines.push("", "## 时序节奏自查", "");
  for (const item of extra.rhythmNotes ?? []) lines.push(`- ${item}`);
  lines.push(
    "",
    "## Review decision",
    "",
    `- Recommended option：${escapeCell(extra.recommendation ?? "按本方案实现局部 MG 节点")}`,
    "- User decision：待确认",
    "- Revision notes：无",
    ""
  );
  if (extra.openQuestions?.length) {
    lines.push("## 遗留问题（需要裁决，不影响本方案成立）", "");
    extra.openQuestions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
    lines.push("");
  }
  return `${lines.join("\n")}`;
};

export const renderCreativeConfirmationDoc = ({
  jobId,
  workflow,
  beatMap,
  cues,
  transcript,
  reconciliation,
  annotationState,
  extra = {}
}) => {
  const lines = [];
  const localBeats = beatMap.beats.filter((beat) => beat.mgScope === "local");
  const captionOnlyBeats = beatMap.beats.filter((beat) => beat.mgScope === "none");
  const corrections = (reconciliation.items ?? []).filter((item) => item.type === "asr-correction");
  const unresolved = (reconciliation.items ?? []).filter((item) => item.resolution === "unresolved" && item.releaseImpact === true);
  const annotations = annotationState?.annotations ?? [];
  const wordCount = transcript.segments.reduce((sum, segment) => sum + segment.words.length, 0);

  lines.push(
    "# 创意确认包",
    "",
    "## 用户选择",
    "",
    `- 字幕模式：\`${workflow.captionMode}\`（默认：ChatCut 页面仅作原始时间证据，HyperFrames 实现经录音校正并审核的语义单行字幕；用户可切换为 \`motion-copy\`）`,
    `- 视频类型：\`${workflow.visualAxisMode}\`（口播全屏、局部 MG）；如需 \`B-axis stage\` 或混合模式，会列出具体段落供用户选择`,
    `- 字幕交付范围：\`selective-mg\`（字幕样片验证字形、语义单行切分、时序与安全区；另有 ${localBeats.length} 个局部 MG 节点，逐条列于下方 MG 审核清单）`,
    "- 方案依据：`docs/motion-plan.md` 与 `state/beat-map.json`；`subtitles` 额外包含 `docs/caption-plan.md`",
    "- 当前状态：**待用户确认**",
    "",
    "## 逐字稿对齐",
    "",
    `- 录音是事实依据；参考口播稿只辅助术语、拼写和预期结构。本 job 的参考稿状态为 \`${workflow.referenceScriptStatus}\`。`,
    `- 成片逐字稿为 \`state/transcript.json\`（成片时间轴 revision ${transcript.revision ?? 1}，${transcript.segments.length} 句 / ${wordCount} 词 / ${transcript.duration.toFixed(1)} s）；被粗剪剪掉的重说段保留在不可变的 \`state/source-transcript.json\` 中备查。`
  );
  for (const item of corrections) {
    lines.push(`- 已记录的 ASR 更正（\`${item.id}\`，type \`asr-correction\`，置信 ${item.confidence}）：${escapeCell(item.evidence.note)}`);
  }
  lines.push(`- 待确认歧义：\`releaseImpact: true\` 且未解决的条目 —— ${unresolved.length === 0 ? "无。" : unresolved.map((item) => item.id).join("、")}`);
  for (const item of extra.wordingNotes ?? []) lines.push(`- ${item}`);
  lines.push(
    "",
    "## 逐字稿画面批注",
    "",
    "`【】` 批注仅是对应局部语句的中等强度参考，不是完整画面清单，也不构成最终轴向或 MG 批准。未批注段落仍按完整内容独立规划。",
    "",
    annotations.length === 0
      ? "本 job 没有提供参考口播稿，`state/reference-script-annotations.json` 的 `annotations` 为空，因此没有需要采纳/调整/不采纳的批注。"
      : "以下为本 job 的批注处理结果。",
    "",
    "| ID | 原批注 | 最终作用范围 | 处理结果 | 最终画面处理 | 理由 / 对应 Beat |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  if ((extra.annotationDecisions ?? []).length > 0) {
    for (const decision of extra.annotationDecisions) {
      const source = annotations.find((annotation) => annotation.id === decision.id);
      lines.push(`| ${decision.id} | ${escapeCell(source?.instruction ?? "")} | ${escapeCell(decision.resolvedScope)} | ${escapeCell(decision.disposition)} | ${escapeCell(decision.finalTreatment)} | ${escapeCell(decision.reason)} / ${escapeCell((decision.beatIds ?? []).join(", "))} |`);
    }
  } else {
    lines.push("| 无 | 无 | 不适用 | 不适用 | 全片按完整内容独立规划 | 未提供参考稿，无批注可绑定 |");
  }

  lines.push(
    "",
    "## A/B 轴执行规则",
    "",
    "| Axis | 信息节奏 | 人物与安全区 | 组件表面 | 退出方式 |",
    "| --- | --- | --- | --- | --- |",
    "| A 轴叠加模式 | 快速替换；同一时刻仅一个主信息组和至多一个辅助组 | 口播视频全屏；有信息价值时可短暂遮脸，通常不超过 3 秒 | 局部半透明毛玻璃 | 当前语义组完整退出后，再进入下一组 |",
    "| B 轴舞台模式 | 同一语义页可累积 | MG 全屏；真人窗持续播放并受保护 | 完整信息舞台 | 页面完成后成组退出 |",
    "",
    extra.axisNote ?? `本片只用 \`${workflow.visualAxisMode}\`。所有局部 MG 面板的渲染窗口都控制在标准允许的时长内，且组间不累积。`,
    "",
    "## 分镜动画方案",
    "",
    `完整单行切分见 \`docs/caption-plan.md\`。全片 ${beatMap.beats.length} 个 beat，其中 ${localBeats.length} 个为局部 MG 节点，其余 ${captionOnlyBeats.length} 段为纯字幕。`,
    "",
    "### 明确不加 MG 的段落",
    "",
    "| 时间 | 原句 | 不加原因 |",
    "| --- | --- | --- |"
  );
  for (const beat of captionOnlyBeats) {
    lines.push(`| ${formatClock(beat.start)}–${formatClock(beat.end)} | ${escapeCell(beat.text)} | ${escapeCell(extra.noMgReasons?.[beat.id] ?? "字幕和口播已完整表达；增加动画不能产生具体信息增量")} |`);
  }

  lines.push(
    "",
    "### 字幕模式 MG 审核清单",
    "",
    "仅为 `mgScope: local` 的节点填写；纯字幕节点不填。每项必须说明为什么不只是“让画面更活跃”。",
    "",
    "| 时间 / 对应字幕 | 最终上屏原文 | 信息增量 | 动画样式 | 关系结构 / 启动词 | 主推进轴 | 继承范式 | 主要任务 | 删除后的具体损失 | 注意力成本 | 事实来源 / 高成本理由 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const beat of localBeats) {
    const cost = extra.mgCostNotes?.[beat.id]
      ?? (beat.factualClaims?.length
        ? beat.factualClaims.map((claim) => `${claim.claim}（${claim.source}）`).join("；")
        : beat.attentionCostReason ?? "未引入新事实（画面只复用口播已说出的名词）");
    lines.push([
      `${beat.id} ${formatClock(beat.start)}–${formatClock(beat.end)} / ${cueLabel(beat, cues)}`,
      beat.onScreenCopy.join(" "),
      escapeCell(beat.visualEncoding),
      escapeCell(beat.visualStyle),
      escapeCell(`${beat.semanticTopology} 关系；从「${beat.entryAnchorText ?? "起点"}」起`),
      beat.primaryFlowAxis,
      beat.visualReference,
      beat.supportRole,
      escapeCell(beat.removalLoss),
      escapeCell(extra.attentionLabels?.[beat.attentionCost] ?? ({ low: "低", medium: "中", high: "高" }[beat.attentionCost] ?? beat.attentionCost)),
      escapeCell(cost)
    ].join(" | ").replace(/^(.*)$/, "| $1 |"));
  }

  lines.push(
    "",
    "| 审核项 | 确认内容 |",
    "| --- | --- |",
    `| 字幕模式 | 当前为 \`${workflow.captionMode}\`；切到 \`motion-copy\` 会把全部口播改成动态排版并重做方案，需退回本步 |`,
    `| A 轴 | 快速替换、局部玻璃；${localBeats.length} 个 MG 节点的遮脸窗口均受控且互不累积 |`,
    "| B 轴 | 本片不使用，无真人小窗与舞台退出规则需要确认 |",
    "| 排版 | 字幕继承 400 正常字重且禁止伪粗体；严格单行，无单字孤行，无受保护词组跨行 |",
    "| 动画结构 | 每段声明横向或纵向主轴，主链均无中途 90° 转向 |",
    "| 视觉继承 | 文案、时间、尺寸变化复用已批准结构；主轴、层级或语法变化才重审 |",
    `| 样片 | 本次交付 \`selective-mg\`：字幕加确认包列出的 ${localBeats.length} 个局部 MG 节点 |`,
    "| 变更控制 | 字幕切分、MG 节点/数量、上屏文案、任务、样式或轴向变化，必须退回方案审核；批准前不得实现 |",
    "",
    "## 审核决定",
    "",
    `- 推荐选项：${escapeCell(extra.recommendation ?? "按本包实现全部局部 MG 节点")}`,
    "- 用户决定：待确认。",
    "- 修订记录：无。",
    ""
  );
  if (extra.openQuestions?.length) {
    lines.push("## 待用户裁决的事项", "");
    extra.openQuestions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
    lines.push("");
  }
  return `${lines.join("\n")}`;
};
