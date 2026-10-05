# cut-motion

[English](README-EN.md)

一套轻量的口播剪辑 Skill：ChatCut 做可编辑粗剪，HyperFrames 做字幕、MG 和成片。保留 13 个可变内容的 MG 模板，以及 A/B 轴两个舞台模块。

用 Codex、Claude Code 或其他支持 Skill 的 Agent 打开仓库，告诉它本地视频路径即可：

> 用 cut-motion 剪辑 /absolute/path/video.mov。参考逐字稿用于修正识别错字。

默认使用 Review：先审核 ChatCut 粗剪，再审核合并的字幕与 MG 方案。明确指定 Auto 后连续制作；两种模式使用相同的制作方法。默认竖屏、独立字幕、A 轴叠加 MG，也可指定 Motion Copy，让完整口播直接成为动画文字。

每个项目只维护一份 `jobs/<id>/plan.json`。字幕校正、MG 内容与实际口播时间都在其中；HTML、截图和视频由工具生成。MG 位于中上方，卡片水平居中、尺寸固定，按关键词展开并避开字幕。

约两分钟的常规口播以 20 分钟完成为执行目标，不包含等待用户的时间；这是待实测的目标。

Agent 从 [Skill](.agents/skills/cut-motion/SKILL.md) 开始。ChatCut 接入与本地工具用法见 [接入说明](.agents/skills/cut-motion/references/chatcut.md)。项目级 HyperFrames/GSAP 依赖可以直接安装；全局安装和登录须征得同意。

维护模板时可运行 `node dev/template-preview.mjs` 生成可拖动时间的预览。`dev/` 的预览与隐私检查用于仓库开发，不属于每次剪辑的制作流程。

代码、文档和模板采用 [Apache-2.0](LICENSE)。字体、第三方工具和用户媒体遵循各自许可，见 [NOTICE](NOTICE)。
