# cut-motion

[English](README-EN.md)

cut-motion 是一套开源 Agent 视频制作工作流，可以把一段口播素材制作成经过精剪、带字幕或动态图形设计的成片。

## 如何使用

你不需要学习剪辑软件、代码或终端命令。用 Codex、Claude Code 或类似的编程 Agent 打开这个项目，然后直接告诉它要剪辑的视频路径。

例如：

```text
请使用 cut-motion 剪辑这个视频：
/Users/你的名字/Desktop/video.mov
```

Agent 会先检查电脑环境。需要安装工具或登录服务时，会解释原因并征求你的同意；未经同意不会安装。

## 固定流程

每个 job 只沿着这条状态路径前进：

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
→ motion-plan → composition → render → complete
```

1. 你提供口播视频；Agent 探测媒体并记录可选偏好。
2. Agent 转写并对齐录音，处理参考逐字稿与录音之间的差异。
3. ChatCut 只负责可编辑粗剪：删除明显口误、重复和无意义空白，不在 ChatCut 中制作字幕、MG 或 B-axis 画面。
4. 唯一人工门控是 `rough-cut-review`：Agent 打开 ChatCut 粗剪时间线，等待你批准或要求返修。`review` 在这里暂停；`auto` 在同一状态路径上执行显式自动校验并继续。
5. 粗剪导出后，进入 HyperFrames 阶段，在这里完成字幕、MG、A/B-axis 画面、合成与渲染。
6. `review` 快速路径只做必要的基础媒体检查，不跑全量自动校验、标准预览或短样片；默认直接按交付质量渲染一次。`auto` 不增加状态，只在既有转移上执行自动校验。

## 两种字幕模式

- **带字幕模式**：完整口播内容以清晰字幕呈现，只在有助于理解的位置加入少量动画；字幕和 MG 都在 HyperFrames 中完成。
- **无字幕模式**：没有单独的字幕层，口播文案直接成为 HyperFrames 中的动态图形。

带字幕模式默认参考 `examples/traework-reference/`；无字幕模式继续参考 `examples/gold-standard/` 的全屏动效样例。

如果没有偏好，Agent 会在粗剪审核前给出字幕模式和视觉轴建议，并把选择记录到 job 状态中。

## 你可以提供什么

只有视频路径是必需的。你还可以选择提供：

- 逐字稿或参考口播稿；
- 偏好的字幕模式；
- 喜欢的视觉参考；
- 发布平台或画面比例；
- 产品截图、录屏或其他辅助素材。

这些信息没有提供也不会阻塞流程，Agent 会根据素材自行分析并推荐。

参考逐字稿可以用 `【】` 在局部语句后批注画面偏好。批注只作为该局部的参考，不会进入字幕，也不会替代 Agent 对全片剪辑和动画节点的分析。

## 可以直接这样说

- “帮我精剪这段口播，节奏自然一点。”
- “使用带字幕模式，只在重要解释处加 MG。”
- “不要单独字幕，把口播文案直接做成动画。”
- “这一版节奏太快，在原任务中放慢一点。”
- “剪辑不要改，只调整动画排版。”

## 给 Agent 和贡献者

Agent 的完整工作规则见 [`AGENTS.md`](AGENTS.md)。环境准备、检测和维护命令见 [`docs/agent-setup.md`](docs/agent-setup.md)。

## 版权与许可

cut-motion 的代码、文档和可复用模板采用 [Apache-2.0](LICENSE) 发布。第三方工具、字体和用户媒体仍遵循各自的许可，详细边界见 [NOTICE](NOTICE)。
