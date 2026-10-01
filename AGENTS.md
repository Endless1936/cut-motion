# cut-motion Agent Protocol

cut-motion turns a talking-head video and an optional reference script into a tightly cut, motion-designed video. This repository is an Agent workflow, not a LangGraph, LlamaIndex, or fixed-template application.

`AGENTS.md` is the canonical operating contract. Codex, Claude Code, and compatible coding agents must follow it before editing media or authoring motion.

## Minimum input

- A local talking-head video.
- Optional preferences: caption mode, reference script, visual-axis strategy, output aspect, style references, and autonomy mode.

If media is missing, ask for its local path and stop. After receiving it, ask once for any known preferences without blocking progress when the user has none. When a reference script is supplied, persist its immutable copy in the job and use its recording-confirmed wording for release; ChatCut/ASR supplies timing and alignment. The recording remains authoritative for what was actually spoken.

A reference script may contain local visual notes in full-width `【】`. These are medium-strength, non-exhaustive references for the immediately preceding semantic clause unless a note explicitly names another local range. Only its speech text, after recording reconciliation, enters released wording; visual notes remain separate planning evidence and never replace whole-video MG and edit analysis or count as final axis or motion approval. Ordinary `[]` remains spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.

## Required outputs

Each run creates a job directory containing:

```text
jobs/<job-id>/
├── input/
├── state/
│   ├── project.json
│   ├── source-transcript.json
│   ├── transcript.json
│   ├── transcript-reconciliation.json
│   ├── reference-script-annotations.json
│   ├── chatcut-roughcut.json
│   ├── trim-plan.json              # explicit FFmpeg fallback audit input; not used for ChatCut rough cuts
│   ├── design-system.json
│   ├── creative-confirmation.json
│   ├── workflow.json
│   ├── beat-map.json
│   └── render-manifest.json
├── roughcut/
│   └── a-roll.mp4
├── docs/
│   ├── caption-plan.md  # subtitles only
│   ├── creative-confirmation.md
│   └── motion-plan.md
├── captions/
├── hyperframes/
├── previews/
├── checkpoints/
├── logs/
└── output/
    └── final.mp4
```

`source-audio-waveform-index.json` is a job-local working input for the rough-cut seam pass; build or reuse it once per source. `chatcut-seams.json` and `seam-waveform-lookup.json` may record the single batch lookup. These are evidence artifacts, not release outputs, workflow states, or approval gates.

Never overwrite the original source video. Every destructive-looking operation must produce a new artifact and update `state/project.json`.

Each job directory is an isolated working directory. Do not place job media, generated state, previews, or logs in the cut-motion repository root.

This is a local open-source workflow, not a production service. Keep jobs, private working data, and credentials out of Git; publish only explicitly approved examples. Follow the repository privacy check in `docs/agent-setup.md` before a commit. Do not add network-security infrastructure or video-workflow gates to solve local editing problems.

## Toolchain

Use the first available tool in each stage:

1. **Rough cut:** ChatCut project and editable timeline.
2. **Transcription:** ChatCut transcription, reconciled with the original recording and any supplied reference script. Local silence detection is a separate audio-only step, never a substitute for ASR.
3. **Precision trim:** FFmpeg and FFprobe.
4. **Motion design:** HyperFrames HTML/CSS with a single seek-safe GSAP timeline.
5. **Validation and render:** HyperFrames build/render and FFprobe. Additional automatic validation is enabled only by the explicit `auto` mode.

Use the job package's `npm run render` or `npm run render:revision` for the normal one-render delivery path. Route selection, chunked recovery, browser and worker settings, and preview handling are defined in [`docs/agent-setup.md`](docs/agent-setup.md#render-commands); use those package entrypoints and review the rendered MP4.

Remotion and Vibe Motion are not part of the default stack. Use them only when the user explicitly requests them and record the deviation in `state/project.json`.

## Operating modes

- `review` is the default fast path: follow [`docs/quality-gates.md`](docs/quality-gates.md) and [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md), use the existing `rough-cut-review` gate, then make one delivery render.
- `auto` uses the same state sequence and rough-cut standard with the existing automatic checks. The legacy trim-plan audit applies only when `roughCutEngine` is explicitly `ffmpeg-fallback`.

`rough-cut-review` is the only workflow gate. Inspecting the rendered file is a handoff for the user's editorial decision, not another state or approval gate.

## Workflow state machine

`state/workflow.json` is the authoritative state. `currentState` may only be one of `intake`, `transcription`, `rough-cut`, `rough-cut-review`, `rough-cut-export`, `motion-plan`, `composition`, `render`, or `complete`. Never advance by assumption or by merely creating the next artifact.

Use `scripts/workflow-state.mjs` for every transition:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json status
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json advance --artifact <path> --note <summary>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json revise --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note <reason>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json reopen <rough-cut|motion-plan|composition|delivery> --actor user --note <feedback>
```

The only approval commands are for `rough-cut-review`: `approve` records the user's decision and `revise` returns to `rough-cut`. In `auto`, the same state is resolved by recording `automatic-fallback`; no parallel state path is created. Record the result in `roughCutReviewDecision` as `pending`, `manual-approved`, or `automatic-fallback`. Never infer approval or an automatic decision from silence.

Every creative round records a `revisionId` and preserves prior decisions in `history`; use `scripts/workflow-state.mjs` to reopen the earliest affected state. `docs/revision-standard.md` owns revision scope, evidence, and delivery handling. Use one combined delivery confirmation before the first delivery render of each round; it is delivery coordination, not another workflow gate.

## Caption modes

`captionMode` is independent of workflow mode:

- `motion-copy` is the no-subtitle mode. Every spoken phrase appears inside the designed motion; there is no separate subtitle layer.
- `subtitles` is the default release path. Captions carry the spoken transcript; motion graphics carry only supplemental meaning such as diagrams, tool labels, counters, comparisons, icons, and semantic emphasis.

If the user has no caption preference, analyze the locked edit and record a recommendation before `rough-cut-review`. Resolve the choice with the rough-cut decision; a late caption-mode change at or after planning returns to `motion-plan`.

For `subtitles` mode:

- Use [`docs/subtitle-segmentation-standard.md`](docs/subtitle-segmentation-standard.md) for wording, cue grouping, timing, punctuation, and caption promotion; recorded speech remains the wording authority.
- Prefer white 得意黑 at the design-system weight (default `400`) with the existing soft downward shadow; if its local font file is unavailable, continue with the sans-serif fallback.
- Captions carry the complete spoken wording. [`docs/subtitle-mg-standard.md`](docs/subtitle-mg-standard.md) governs supplemental local MG; the recorded plan selects its nodes and axis.
- Keep the default A-axis full-frame talking head under localized overlays, with captions and protected evidence unobscured. Use a B-axis only when selected in the motion plan.

## Visual axis modes

Use these user-facing names; do not call them A-roll and B-roll:

- **A-axis overlay mode:** the talking-head video remains full-frame and localized MG appears above it.
- **B-axis stage mode:** motion design owns the full frame and the speaker may remain in a protected live PiP.

Infer the axis recommendation from the locked edit, content-display needs, and available supporting media. Record the recommendation and its reason with the rough-cut decision, then implement the chosen axis in HyperFrames. The creative-confirmation package defines the treatment; a later B-axis change returns to `motion-plan` and updates the recorded preference without adding another workflow gate. Record decisions in `state/workflow.json` and `state/creative-confirmation.json`.

## Canonical workflow

### 0. Environment preflight

Detailed host setup, job installation, render, and repository-maintenance commands are collected in `docs/agent-setup.md`.

Before creating a job, inspect the active Agent tool surface for ChatCut, then run:

```bash
./scripts/check-environment.sh check
```

ChatCut is an Agent integration and cannot be reliably discovered from the shell. HyperFrames Agent integration is optional authoring guidance; the required renderer is the exact job-local CLI resolved below.

If required ChatCut or a local dependency is unavailable:

1. Explain the missing items, their purpose, and the exact installation scope in one concise prompt.
2. Wait for explicit user approval. Do not install packages, alter global Agent configuration, or start OAuth before approval.
3. For ChatCut, after approval direct the user to the official setup for their client: ChatGPT desktop Work/Codex (`https://chatcut.io/chatgpt`), Claude Code (`https://chatcut.io/claude`), or WorkBuddy (`https://chatcut.io/workbuddy`). Start a new session after installation, then confirm the ChatCut tools are available. Do not assume ChatGPT website or remote workspaces are supported; follow the current official client guide. Do not add a deterministic ChatCut installer to this repository.
4. After a job is scaffolded, run `./scripts/check-environment.sh install-job jobs/<job-id> --yes` only after approval. It must first search the configured npm `_npx` cache for the exact declared HyperFrames version and reuse it through a job-local package symlink. Download HyperFrames only when no exact cache exists. Resolve GSAP independently so a missing GSAP package never forces a second HyperFrames download.

ChatCut is used only to create the editable rough cut. If it is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative fallback; do not claim that ChatCut ran. Captions, MG, and B-axis composition always belong to HyperFrames. HyperFrames requires no global install: `install-job` reuses an exact `_npx` cache entry when available and otherwise installs the pinned npm dependency inside the job.

### 1. Intake and probe

1. Create a job with `scripts/scaffold-project.sh`.
2. Copy or link the source into `input/`; never modify it.
3. Ask once for optional caption, reference-script, and visual-axis preferences. Record supplied choices; otherwise keep them deferred and continue.
4. Probe duration, dimensions, frame rate, codecs, sample rate, and rotation with FFprobe.
5. Use 30 fps as the project timeline default, even if the source is 29.97 fps; use another rate only when the user requests it. Record source and timeline rates separately.

### 2. Transcript and alignment

1. Use ChatCut for transcription and timing. Do not use local ASR; if ChatCut is unavailable, follow environment preflight and defer transcript-dependent edits. The original audio may still be indexed locally for a targeted seam audit.
2. If a reference script is supplied, persist the immutable original under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. Reconcile its wording with the recording: remove unspoken text, restore spoken omissions, and use the confirmed script wording for release.
3. When the reference contains `【】`, use only `speechText` from `state/reference-script-annotations.json` for released wording and retain every visual note separately.
4. Store timestamps in `state/transcript.json` and evidence in `state/transcript-reconciliation.json`; run the reconciliation checker.
5. Advancing transcription snapshots the source-timeline word timings to immutable `state/source-transcript.json`; its workflow hash survives rough-cut revisions.
6. Preserve uncertainty. A release-impact wording conflict is resolved against the recording before release; it does not create a separate default user gate.

### 3. Shared edit lock

Use [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md) as the sole detailed rough-cut policy. This section records only ChatCut operations and required evidence.

1. Create or target a ChatCut project, reusing its exact source asset when present; otherwise import the authoritative job copy. Use ChatCut for the editable talking-head timeline.
2. Follow the sole [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md) for semantic editing, candidate cleanup, spoken coverage, and seam review. Keep valid recorded speech or record its editorial disposition.
3. Follow the standard's source-index and seam-lookup sequence. Record asset IDs, durations, and stage timings in `state/chatcut-roughcut.json`; [`docs/source-audio-silence-index.md`](docs/source-audio-silence-index.md) defines lookup mechanics.
4. After the existing review decision, export and promote the approved timeline once with `scripts/promote-job-media.mjs`; run the basic media lock before `rough-cut-export`.

If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative FFmpeg fallback. Captions, MG, and B-axis composition are authored in HyperFrames.

### 4. Semantic beat map and motion plan

Create `state/beat-map.json` before writing animation code.

Copy `assets/design-system.default.json` to `state/design-system.json`, then change it only when the user or supplied brand requires a different system. Prefer 得意黑 when its font file is available; its absence does not block a job, and the composition falls back to sans-serif.

Every spoken sentence must be represented. Split long sentences into meaningful phrases. Every beat records timing, source, intent, axis, and coverage; only `motion-copy` or approved local-MG beats require motion recipes and micro-events. Caption-only subtitle beats use `mgScope: none` with empty motion fields.

- exact start and end time;
- source transcript segment IDs;
- semantic intent and emphasis;
- A-axis or B-axis treatment;
- one primary motion recipe when motion is approved;
- one `primaryFlowAxis` (`horizontal` or `vertical`) and `visualReference` when motion is approved;
- one `semanticTopology` and word-level `entryAnchorWordId` when motion is approved;
- one word-level `exitAnchorWordId` plus `exitAnchorOffsetFrames` when motion is approved;
- motion family and transition family when motion is approved;
- micro-event timestamps and topology roles; connector/container events share a `revealGroup`;
- supporting components;
- entrance, hold, and exit timing;
- measured typography and layout bounds;
- collision, face-cover, and safe-area notes.

Run `scripts/check-visual-plan.mjs` in `auto` or when a specific planning question needs it.

For `subtitles`, prepare the caption plan; for `motion-copy`, cover all speech in the beat map. Bundle the settled wording, MG, style, timing, axis, and intentional no-MG choices in the internal creative-confirmation package.

If `state/reference-script-annotations.json` contains visual notes, bind each note to the locked recording timeline and list it in the creative confirmation package as `adopted`, `adjusted`, or `rejected`, with its resolved local scope, final treatment, reason, and relevant beat IDs. Plan every unannotated passage normally. Correct or reject a note that conflicts with the recording, available evidence, visual-value rules, protected regions, or coherent axis behavior.

For job revisions, use [`docs/revision-standard.md`](docs/revision-standard.md) to route a local change to composition or a global creative change to motion planning.

### 5. HyperFrames composition

1. Use HyperFrames for media, captions, MG, axis composition, timing, and render. Build layout in HTML/CSS and register one paused, seek-safe GSAP timeline; keep `<video>` and `<audio>` as direct children of the composition root.
2. Animate with transforms, opacity, color, and border-radius. Keep motion deterministic and PiP footage moving. Embed 得意黑 when available; otherwise use the sans-serif fallback and measure text in the rendered font at peak bounds.
3. Keep cut-motion diagnostics outside rendered composition HTML and frame capture. HyperFrames computes peak-frame bounds.
4. Author each Beat under `hyperframes/mg/<beat-id>/` as `fragment.html`, `style.css`, and `timeline.mjs`. Give each visual one `data-motion-group` with axis, kind, time, face policy, flow, and topology. Labels declare a `data-information-role` matching Beat Map `supportRole`; connectors declare `data-motion-role="connector"`, `data-reveal-group`, `data-flow-axis`, `data-color-token`, and `data-color-property`. Mark icons/status with `data-motion-role="indicator"`, composite boxes with `data-collision-unit`, and intentional overlaps with `data-overlap-policy="intentional"` on the exact unit.
5. Start Beat roots hidden, reveal them on the shared timeline, and let the builder apply scoped styles and hard exits. Keep shared styles in `index.template.html`; run `scripts/build-composition.mjs` to generate `hyperframes/index.html`. Add a motion sidecar only when it matches checked HTML and real selectors.

### 6. A/B-axis direction

- Use the A-axis for full-frame talking-head footage with localized overlays; use B-axis as a full motion-design stage with an optional moving speaker PiP.
- Apply the axis-specific layout, face coverage, flow, and scene rules in `docs/visual-language.md`; reserve the B-axis PiP exclusion zone from `design-system.json`.
- Choose an axis for the phrase's meaning and record it in the motion plan. Keep each passage coherent.

### 7. Timing and density

Use `docs/density-and-layout.md` for motion cadence, typography, spacing, safe areas, and peak-state bounds. Use `docs/visual-language.md` for composition grammar, axis guidance, and common visual failures.

### 8. Validation and delivery

`review` and `auto` delivery procedures are defined in [`docs/quality-gates.md`](docs/quality-gates.md). Both use the same state sequence; `review` leaves the final editorial decision to the user, while `auto` runs only its listed checks.

Only canonical large media persists: immutable `input/source.*`, `roughcut/a-roll.mp4`, HyperFrames input, optional local diagnostics, and `output/final.mp4`. Use `promote-job-media.mjs` for explicit external exports; it must reject immutable input, escaped directories, and approved artifacts. Never scan download folders or delete unregistered user files.

## Motion-graphics visual grammar

Use [`docs/visual-language.md`](docs/visual-language.md) for design grammar and mode-specific examples. Use its visual failures as authoring cues to correct the composition, not as a separate validation pass.

## Failure policy

Report missing inputs, failed checks, and fallbacks plainly. Preserve the last known-good rough cut and composition before major revisions; retry only safe transient failures.

## Completion definition

A job is complete on the `review` path when the final file exists, basic media checks pass, and the user has the opportunity to inspect it. Automatic-validation completion is claimed only when the user explicitly selected `auto` and the applicable checks passed.
