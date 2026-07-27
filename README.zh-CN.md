# MotionScript

[English](README.md)

MotionScript 是一个开源 Agent 工作流：将口播视频制作成节奏紧凑、带有动态图形设计的视频。

它面向 Codex、Claude Code 和类似的编程 Agent，不是节点编排工具或通用编排框架。工作流定义在 `AGENTS.md`；脚本、Schema、动效配方、模板和黄金样片使其可复现。

## 能做什么

```text
口播视频 + 可选制作偏好
  → 基于录音转写，并按需对齐参考稿
  → ChatCut 粗剪 + FFmpeg 帧级精修锁定
  → 短语级节拍图
  → HyperFrames + HTML/CSS + GSAP 动效设计
  → 同步与视觉质检
  → HyperFrames 渲染
```

## 前置条件

MotionScript 有两类依赖：ChatCut 提供 Agent 侧剪辑能力；本地工具与任务级 HyperFrames CLI 负责执行仓库脚本并渲染视频。

### Agent 集成

- **ChatCut**：默认 `subtitles`（带字幕）模式必需。它负责可编辑粗剪，并提供原始字幕时间证据；语义分页由后续审核方案确定。`motion-copy` 模式优先使用它，不可用时可记录为 FFmpeg 的保守降级方案。
- **HyperFrames Agent 集成**：可选但推荐，用于提供创作指引。渲染和校验始终使用仓库声明的任务级 HyperFrames CLI 精确版本。

如果没有 ChatCut，Agent 必须先征求一次安装同意，再使用官方宿主提示词引导安装，而不是执行仓库内的确定性安装脚本：

- Codex：`Read https://chatcut.io/chatgpt to install and use the ChatCut plugin`
- Claude Code：`Read https://chatcut.io/claude to install and use the ChatCut plugin`

安装或认证后，确认 ChatCut 已出现在当前 Agent 会话中。

### 本地必需工具

- 带有 Bash 的 macOS 或 Linux；Windows 请使用 WSL2 或等效 Unix Shell。
- Node.js 22+，并包含 `npm`、`npx`。
- 支持 H.264/AAC 的 FFmpeg 和 FFprobe。
- 用于处理精剪方案的 `jq`。
- WOFF2 格式的[得意黑](https://github.com/atelier-anchor/smiley-sans/releases)。该字体采用 SIL Open Font License 1.1，但仓库不内置；下载后以 `smiley-sans-oblique.woff2` 文件名复制到任务目录。

可随时运行本地预检：

```bash
./scripts/check-environment.sh check
```

仓库验证按环境拆分：

```bash
./scripts/verify-repository.sh --static
MOTIONSCRIPT_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

静态验证是 CI 安全的默认路径；运行时验证会解析任务级 HyperFrames 运行时并执行真实 CLI 与媒体检查，因此需要字体路径，也可能安装缺失的任务依赖。

如有缺失，Agent 必须先说明缺失项与变更范围，并征得一次明确同意，才可安装依赖。未经同意，不得安装软件包、修改全局 Agent 配置或启动 ChatCut 认证。

### 任务级渲染运行时

HyperFrames 与 GSAP 是任务级 npm 依赖，不要求全局安装或全局插件。创建任务并同意依赖准备后执行：

```bash
./scripts/check-environment.sh install-job jobs/<job-id> --yes
mkdir -p jobs/<job-id>/hyperframes/assets/fonts
cp /path/to/smiley-sans-oblique.woff2 jobs/<job-id>/hyperframes/assets/fonts/smiley-sans-oblique.woff2
```

`install-job` 会先在 npm 的 `_npx` 缓存中查找完全匹配的 HyperFrames 版本；找到后通过任务内软链接复用，不再下载。GSAP 单独复用或仅安装 GSAP；找不到精确缓存时才在任务内执行 `npm install`，不需要全局安装 HyperFrames。

预览版与最终版使用同一份合成、分辨率、帧率、时间线和音频：

```bash
cd jobs/<job-id>/hyperframes
npm run render:preview  # HyperFrames standard 质量
npm run render          # HyperFrames high 质量
```

两者预期只有编码质量档位不同；状态机会继续验证最终版与已批准预览版在剪辑内容上保持一致。

### 必需输入资产

- 一个本地口播视频。
- 可选的字幕模式、参考口播稿和视觉轴偏好；未提供时由 Agent 在分析剪辑锁定版后推荐。
- 上述已授权字体；风格参考和画幅比例为可选项。

## 开始任务

```bash
./scripts/scaffold-project.sh jobs/my-video /absolute/path/to/talking-head.mov review
```

然后对 Agent 说：

```text
请对 jobs/my-video 使用 MotionScript 工作流。
源视频已在任务的 input 目录中。
字幕模式：subtitles（或 motion-copy）
参考口播稿：/path/to/script.txt（或“无”）
模式：review
```

若未提供偏好，工作流仍会继续转写与粗剪。剪辑锁定版审核会同时给出字幕和视觉轴建议，一次批准同时确认剪辑与这些选择。

命令最后两个参数可选：

- 工作流模式：`review` 或 `auto`；
- 字幕模式：`motion-copy` 或 `subtitles`。

每个任务都拥有独立的工作目录、状态机、审阅检查点、日志、字幕目录、创意确认包、分镜动画方案、HyperFrames 项目、预览和输出目录。

`review` 始终在剪辑锁定版和最终预览暂停。只有存在 MG、`motion-copy`、B 轴/混合轴、口播歧义或用户明确要求时才展示创意确认包；首次或动效语言变化时才生成视觉样片，纯字幕项目除非明确要求字幕布局预检，否则直接进入最终预览。`auto` 使用同样的验证产物和已记录的 Agent 推荐。

已完成任务可在原任务内按粗剪、动效方案、合成或交付范围定向返修。交付返修先渲染候选文件，校验通过后才替换 `output/final.mp4`；大型媒体只保留当前版本。

## 仓库结构

- `AGENTS.md`：Agent 的唯一工作契约。
- `docs/`：工作流架构、视觉语言与质量关卡。
- `schemas/`：各阶段共享的持久化状态格式。
- `recipes/`：可复用的动效语法，而非固定布局。
- `assets/design-system.default.json`：可量化的字体、间距、密度、节奏和表面设计 Token。
- `scripts/`：确定性的媒体与校验辅助脚本。
- `templates/hyperframes/`：最小化、支持安全跳转的合成脚手架。
- `examples/gold-standard/`：成功参考实现及其设计拆解。

## 设计原则

MotionScript 自动化生产流程，但不把审美自动化掉。它固定流程、状态、审阅关卡与视觉约束，同时允许 Agent 围绕当前句子的语义设计动效。

动效编写前，工作流会校验短语覆盖率、时间漂移、微事件频率、主场景节奏、B 轴时长、得意黑使用情况、字号、行高、面板边距、焦点占比、空组件与安全区域声明。

## 许可证与第三方资产

MotionScript 的代码、文档和可复用模板以 [Apache-2.0](LICENSE) 发布。参考帧与第三方权利边界见 [NOTICE](NOTICE)。仓库刻意不包含凭据、授权字体、源视频、生成媒体和任务产物。
