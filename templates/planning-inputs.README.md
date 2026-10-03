# 统一方案输入

粗剪稳定并把 ChatCut 项目交给用户试听后，复制 [planning-inputs.example.json](planning-inputs.example.json) 到 `state/planning-inputs.json`。试听期间只填写关键 MG 内容、模板和真实文案例外；用户批准后，按主时间线预览的 entry 顺序将 `sourceSegmentIds` 和 MG 锚点绑定到生成的 `main-001`、`main-002` 等 ID，不要使用 ChatCut item ID 或 Script 行号。示例中的 `:word-001` 是整条 entry 的锚点，不要求词级时间；初次合成按 entry 的完整时间范围定位，只有用户看过成片并提出具体段内时序修改时才查词级时间。字幕时间直接来自批准后的 ChatCut 主时间线预览；按 `preview_timeline({views:["transcript"]})` 返回的顺序保存所有页的 `structuredContent` 到 `state/chatcut-main-timeline.json`。仅当响应返回 `nextOffset` 时才分页，并将其作为下一次请求的 `offset`。

制作 Caption Plan 时，先用主时间线 entry 的完整文本和时间，手工填写 `captionCues`：按自然中文短语切分，覆盖完整文案；每条字幕不超过 10 个显示单位（中文字符按 1 个、约 3 个英文字符按 1 个计算），时间落在所属 entry 内。示例 JSON 中的 cue 内容和时间只是格式示例，必须替换成当前 job 的实际 entry ID、文案和时间。`generate-plan.mjs` 负责排版生成，不会替你做中文断句；不要依赖“一条 entry 一条字幕”的默认回退来代替手工分句。这个要求由执行指引保证，不增加长度校验或审批门。

用户批准粗剪后，并行启动清洁版 A-roll 导出和 `node scripts/generate-plan.mjs <job> --write`。三份方案生成后立即交付；在 `review` 模式等待用户一次性批准整套方案，再运行 `node scripts/compose-job.mjs <job>`。`auto` 模式只有在用户明确选择后才自动继续。仅在确知 ChatCut 字幕已关闭时记录 `cleanExport.captionRenderDisabled: true`；未知状态不阻断，最终 MP4 检查时留意重复字幕。方案审批与媒体锁都就绪后再合成。
