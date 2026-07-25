# MotionScript

[中文说明](README.zh-CN.md)

MotionScript is an open Agent workflow for turning a talking-head video into a tightly cut, motion-designed video.

It is designed for Codex, Claude Code, and similar coding agents. It is not a node graph or an orchestration framework. The workflow lives in `AGENTS.md`, while scripts, schemas, recipes, templates, and a gold-standard example make the instructions reproducible.

## What it does

```text
Talking-head video + two explicit intake decisions
  → recording-backed transcription and optional script reconciliation
  → editable ChatCut rough cut + FFmpeg precision edit lock
  → phrase-level beat map
  → HyperFrames + HTML/CSS + GSAP motion design
  → sync and visual QA
  → HyperFrames render
```

## Requirements

MotionScript has two dependency layers. Agent plugins provide editing and authoring capabilities; local tools execute the repository scripts and render the final video. Both are required for the default release path.

### Agent plugins

- **ChatCut** — required for the default `subtitles` flow: it creates the editable rough cut and raw caption timing evidence. In `motion-copy`, it is preferred and the workflow can use a conservative FFmpeg fallback when unavailable.
- **HyperFrames** — the Agent plugin supplies composition-authoring guidance and tools. It does **not** replace the local HyperFrames CLI used by this repository to validate, preview, snapshot, and render HTML compositions.

For Claude Code, install ChatCut using ChatCut's [official guide](https://chatcut.io/claude), or paste this prompt into a new Claude Code chat: `Read https://chatcut.io/claude to install and use the ChatCut plugin`. In Codex or another Agent host, install and authenticate the corresponding ChatCut and HyperFrames plugins through that host. The workflow checks the active Agent tool surface before it begins a job.

### Required local tools

- macOS or Linux with Bash. On Windows, use WSL2 or an equivalent Unix shell.
- Node.js 22 or newer with `npm` and `npx`.
- FFmpeg and FFprobe with H.264/AAC support.
- `jq` for trim-plan processing.
- A properly licensed local display font in WOFF2 format. The default workflow expects `smiley-sans-oblique.woff2`; it is intentionally not bundled with this repository.

Run the local preflight at any time:

```bash
./scripts/check-environment.sh check
```

Repository validation is split by environment:

```bash
./scripts/verify-repository.sh --static
MOTIONSCRIPT_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

The static path is the CI-safe default. Runtime validation resolves the task-local HyperFrames runtime and executes real CLI and media checks, so it requires the licensed font path and may install missing task dependencies.

If anything is missing, the Agent must explain the required change and ask for one explicit confirmation before installing dependencies. It must not install packages, change global Agent configuration, or start ChatCut authentication without that confirmation.

### Per-job render runtime

HyperFrames and GSAP are job-resolved dependencies, not global tools. After creating a job and approving dependency setup, run:

```bash
./scripts/check-environment.sh install-job jobs/<job-id> --yes
mkdir -p jobs/<job-id>/hyperframes/assets/fonts
cp /path/to/smiley-sans-oblique.woff2 jobs/<job-id>/hyperframes/assets/fonts/smiley-sans-oblique.woff2
```

`install-job` first searches npm's local `_npx` cache for the exact declared HyperFrames version. When found, it creates a job-local symlink and does not download HyperFrames again. GSAP is reused separately or installed alone when missing. A full `npm install` is only the fallback when no matching HyperFrames cache exists. The font remains a separately supplied, licensed input asset.

### Required input assets

- One local talking-head video.
- An explicit choice of caption mode and whether a reference script is supplied. The recording is always transcribed; a script only assists reconciliation.
- The licensed local font above; style references and aspect ratio are optional.

## Start a job

```bash
./scripts/scaffold-project.sh jobs/my-video /absolute/path/to/talking-head.mov review
```

Then ask the Agent:

```text
Use the MotionScript workflow for jobs/my-video.
The source video is already in the job input directory.
Caption mode: subtitles (or motion-copy)
Reference script: /path/to/script.txt (or none)
Mode: review
```

If either intake decision is omitted, the Agent asks for the missing caption-mode or reference-script decision before transcription.

The final two arguments are optional:

- workflow mode: `review` or `auto`;
- caption mode: `motion-copy` or `subtitles`.

Every job receives its own isolated workspace, workflow state, review checkpoints, logs, captions directory, creative-confirmation package, motion-plan document, HyperFrames project, previews, and output directory.

`review` always pauses at the locked edit and final preview. Creative confirmation appears only for MG, `motion-copy`, B-axis or hybrid treatment, transcript ambiguity, or an explicit request. A visual sample appears for first or changed motion language, or when a caption-layout precheck is explicitly requested; caption-only work otherwise proceeds to final preview. `auto` uses the same validated artifacts and never supplies missing intake decisions.

## Repository map

- `AGENTS.md` — canonical Agent contract.
- `docs/` — workflow architecture, visual language, and quality gates.
- `schemas/` — durable state formats shared between stages.
- `recipes/` — reusable motion grammar, not fixed layouts.
- `assets/design-system.default.json` — measurable type, spacing, density, rhythm, and surface tokens.
- `scripts/` — deterministic media and validation helpers.
- `templates/hyperframes/` — minimal seek-safe composition scaffold.
- `examples/gold-standard/` — the successful reference implementation and its design breakdown.

## Design principle

MotionScript automates the production pipeline without automating taste away. It fixes the process, state, review gates, and visual constraints while allowing the Agent to design sentence-specific motion.

The workflow checks phrase coverage, timing drift, micro-event frequency, major-scene cadence, B-axis duration, 得意黑 usage, typography scale, line height, panel padding, focal occupancy, empty components, and safe-area declarations before composition authoring begins.

## License and third-party assets

MotionScript code, documentation, and reusable templates are released under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for reference-frame and third-party boundaries. The repository intentionally excludes credentials, licensed fonts, source videos, generated media, and job outputs.
