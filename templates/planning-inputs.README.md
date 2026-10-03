# 统一方案输入

粗剪和时间映射稳定并把 ChatCut 项目交给用户试听后，复制 [planning-inputs.example.json](planning-inputs.example.json) 到 `state/planning-inputs.json`。字幕使用生成器的默认分段，不运行 `--outline`、不逐条手工填写 `cueLines`。试听期间只填写关键 MG 节点、模板、锚点和真实文案例外。

用户批准后，缺少源词时只导入一次；并行启动清洁版 A-roll 导出和 `node scripts/generate-plan.mjs <job> --write`。方案无需另行审批，生成后立即交付。仅在确知 ChatCut 字幕已关闭时记录 `cleanExport.captionRenderDisabled: true`；未知状态不阻断，最终 MP4 检查时留意重复字幕。方案和媒体锁都就绪后运行 `node scripts/compose-job.mjs <job>`。
