# 统一方案输入

先运行 `node scripts/generate-plan.mjs <job> --outline`，取得成片时间上的句子 ID、词序号和时间。将 [planning-inputs.example.json](planning-inputs.example.json) 复制为 `state/planning-inputs.json`，按这个 outline 填内容决策，不用另写时间映射脚本。样例中的两句文案需要替换。

粗剪已放行并导出后，准备现有 `state/source-transcript.json`、`state/timeline-source-windows.json`、项目/工作流/设计系统/参考稿批注状态及粗剪媒体，运行 `node scripts/generate-plan.mjs <job> --write`。无需另外手写字幕计划、对账与方案文档。时间和句子 ID 来自保留片段映射；同一句被重新使用时会追加 `-repeat-2` 等后缀。

`cueLines` 按成片顺序完整覆盖每个词一次；长句允许携带 `fitFontSizePx`。`beats` 只填内容与锚点，模板共有属性自动补全；文案槽位见 [MG 模板库](motion-graphics/README.md)。`annotationDecisions` 是批注决策的唯一入口。`reconciliation.segments` 仅在需要更改已有文案决策时按 segment ID 填写；已有冲突和处理决定自动保留。

`cleanExport.captionRenderDisabled` 仅在此次 ChatCut 导出确实关闭字幕时设为 `true`；样例默认 `false`。粗剪锁定状态由已有工作流放行记录和媒体指纹推导，不用手填。

字幕方案默认生成 `approved`，表示 Agent 已完成准备；有意保留草稿才设置 `captionStatus: proposed`。生成后运行 `node scripts/compose-job.mjs <job>`，自动按顺序完成状态推进、MG 装配、字幕晋升安装和构建。无需手动改状态、重填派生属性或再运行一遍独立检查器。

重跑只覆盖上次生成后未被手改的产物。迁移手写方案时，先将需要保留的决策填入输入，再加 `--replace-existing`；被替换的内容保存在 job 的 `state/planning-backup-*`。局部 MG 微调使用装配器的单节点更新，不必重跑整套方案。
