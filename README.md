<h1 align="center"><img src="assets/logo.png" alt="cut-motion 图标" width="48" align="absmiddle"> cut-motion</h1>

## 🤖 让 Agent 帮你配置

首次使用，把下面这段复制给 **Codex 或能操作本机的 Agent**：

```text
请帮我在这台电脑上配置 cut-motion：
https://github.com/Endless1936/cut-motion

如果本机已有这个项目，直接使用；否则克隆仓库。先读 AGENTS.md 和 docs/agent-setup.md，再运行本地环境检查，并确认当前会话能调用 ChatCut 工具。
如果缺少 ChatCut，按环境指南中对应我客户端的官方步骤配置。需要安装插件或系统工具、修改 Agent 全局配置或登录时，先征求我的同意。
HyperFrames 和 GSAP 在剪辑项目进入合成时按指南准备，使用仓库内的固定版本。
配置完成后告诉我哪些检查通过了、还有什么需要我操作。等我提供本地视频路径，再开始剪辑。
```

## 🎬 一段口播，剪成一条成片

cut-motion 是一套开源 Agent 剪辑工作流。ChatCut 负责可编辑的粗剪，HyperFrames 负责字幕、动效和成片导出。你提供一段本地视频，用自然语言告诉 Agent 想怎么剪。

ChatCut 的[安装指南](docs/agent-setup.md#environment-preflight)覆盖 ChatGPT 桌面端的 Work／Codex、Claude Code 和 WorkBuddy。

## ✂️ 从粗剪到成片

1. **转写与粗剪** — Agent 对齐录音，剪掉明显口误、重复和多余停顿。
2. **确认剪辑与风格** — 默认走 `review`，你先看粗剪，再一起确认字幕、动效和整体风格。
3. **渲染与修改** — Agent 导出 MP4。想调整字幕、排版或节奏，可以在同一个任务里继续改。

想让 Agent 自动继续，可以明确选择 `auto`。[查看完整工作流](docs/workflow.md)

## ✨ 两种字幕风格

- **带字幕** — 用清晰的独立字幕呈现口播，在适合的位置加动画，比如用双卡切换交接两张截图。
- **无独立字幕** — 让口播文案直接成为画面里的动态文字，按这期视频的风格设计。

没有特别偏好时，Agent 会沿用任务默认设置。[浏览动效模板库](templates/motion-graphics/README.md) · [查看视觉语言](docs/visual-language.md)

## 📎 你可以提供什么

只给本地视频路径就能开工。你也可以带上：

- 📝 逐字稿或参考口播稿。用 `【】` 在句子后标注局部画面想法，批注不会进入字幕。
- 🖼️ 产品截图、录屏、辅助素材或喜欢的视觉参考。
- 📐 字幕偏好、发布平台或画面比例。

## 💬 可以直接这样说

- “帮我剪 `/path/to/video.mov`，节奏自然一点。”
- “加字幕，只有需要展示产品时才叠截图或录屏。”
- “沿用这次的粗剪，把开头两张图改成切牌效果。”

## 🛠️ 给 Agent 和贡献者

[`AGENTS.md`](AGENTS.md) · [环境准备与维护](docs/agent-setup.md) · [English](README-EN.md)

## 📄 版权与许可

cut-motion 的代码、文档和可复用模板采用 [Apache-2.0](LICENSE) 发布。第三方工具、字体和用户媒体仍遵循各自的许可，详细边界见 [NOTICE](NOTICE)。
