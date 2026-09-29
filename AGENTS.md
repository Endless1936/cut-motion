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

For ordinary jobs, use the job package's `npm run render` or `npm run render:revision` entrypoint, which selects the existing automatic render mode. For macOS Apple Silicon jobs with several long media nodes, use the explicit `npm run render:chunked` entrypoint; it resolves the pinned local HyperFrames CLI, binds the exact cached arm64 HeadlessChrome, uses Metal, and renders through `scripts/render-chunks.mjs` in chunked mode. On Linux, Windows/WSL2, and other supported hosts, the normal entrypoint keeps HyperFrames' platform-default browser resolution. Do not fall back to a bare `hyperframes render`: HyperFrames 0.7.60 can block during pre-frame media initialization even when the browser itself launches successfully.

Remotion and Vibe Motion are not part of the default stack. Use them only when the user explicitly requests them and record the deviation in `state/project.json`.

## Operating modes

- `review` is the default fast path. Before the existing `rough-cut-review`, follow [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md) for the semantic edit, candidate pass, spoken-content coverage, and one original-source waveform batch lookup. Use targeted seam review only for specific concerns raised by candidate or waveform evidence; exhaustive per-seam playback is not required. After approval, export once, perform basic media checks, build HyperFrames, and render once. These are checks inside the existing path, not additional states or gates.
- `auto` follows the same nine-state sequence and the same ChatCut editing standard, then enables existing validations. The legacy trim-plan audit runs only when `roughCutEngine` is explicitly set to `ffmpeg-fallback`; it never runs for a ChatCut rough cut.

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

Every creative round has a `revisionId`. Preserve prior decisions in `history`; revisions invalidate downstream hashes and return to the earliest affected state. `currentState` and `pendingGate` identify the active position.

Do not interpret silence as approval in `review` mode.

Completed jobs stay in the same job directory when the user requests revision. Use `reopen`: editorial cuts return to `rough-cut`, MG structure or copy returns to `motion-plan`, parameter-only visual changes return to `composition`, and encoding-only changes return to `render`. A parameter-only change should be rebuilt and checked in a local 1–3 second window before any full delivery render. Render a delivery revision to `output/final.candidate.mp4` when preserving the last delivery matters; otherwise the user may inspect the new output directly.

Follow `docs/revision-standard.md` for feedback scope, evidence layout, caption edits, and late cuts. Preserve settled user choices and fix every affected use of a reported pattern. Targeted checks of a reported defect are allowed in `review`; they do not enable the full automatic pipeline or add a gate.

The fast path renders once at the requested delivery quality and lets the user inspect that file. Before the first delivery-quality render in a delivery round, make one combined confirmation that the reference wording, subtitle text and segmentation, MG/material inventory and deferred items, axis, and output settings are the delivery version. If any of those are still unsettled, continue with planning, building, or targeted checks as needed instead of starting the delivery render. A later change to one of them follows the existing revision path and needs a new combined confirmation before the next delivery render. This is an interaction rule, not an additional workflow state or approval gate. A temporary affected-window preview is allowed for a parameter-only revision, but it is not a workflow state or a required precursor to delivery.

## Caption modes

`captionMode` is independent of workflow mode:

- `motion-copy` is the no-subtitle mode. Every spoken phrase appears inside the designed motion; there is no separate subtitle layer.
- `subtitles` is the default release path. Captions carry the spoken transcript; motion graphics carry only supplemental meaning such as diagrams, tool labels, counters, comparisons, icons, and semantic emphasis.

If the user has no caption preference, analyze the locked edit and record a recommendation before `rough-cut-review`. Resolve the choice with the rough-cut decision; a late caption-mode change at or after planning returns to `motion-plan`.

For `subtitles` mode:

- treat `docs/subtitle-segmentation-standard.md` as the binding wording, grouping, timing, and single-line specification;
- treat `docs/subtitle-mg-standard.md` as the binding MG selection specification;
- use white 得意黑;
- inherit `captions.fontWeight`, which defaults to `400`; do not use `700` or synthetic bold unless a confirmed brand requirement changes the design system;
- use a soft downward black shadow, not an opaque subtitle bar;
- render exactly one line per cue. Segment by complete lexical units, syntax, clauses, breath, and reading rhythm before applying width constraints. Never split a protected word or fixed phrase, isolate a function word or particle, or create a cue merely to satisfy a raw character count;
- use mutually exclusive half-open frame windows for captions; the outgoing cue is hidden at its end frame before the incoming cue is shown. Derive rendered seconds from those frames, including after revisions;
- allow `?` or `？` only as the final character of a cue; replace every other punctuation mark, including internal commas and enumeration commas, with a single space;
- target 4–10.5 measured display units and 0.8–2.5 seconds per cue; allow up to 11.8 measured units with cue-level fitting between 88–96px. A meaningful short closing phrase may be an explicit exception, but a one-character cue is always invalid;
- keep captions centered in the lower safe zone;
- do not repeat the same sentence as a large motion headline;
- when a reference script is supplied, persist its immutable job-local copy and use its recording-confirmed wording for release; use ChatCut/ASR output for timing and alignment, not released wording. Without a reference script, use the reconciled recording-backed transcript as wording authority;
- retain `captions/chatcut-pages.json` as raw timing evidence, but do not preserve its `/` pagination blindly. Build `captions/caption-review-plan.json` by aligning the approved wording to word timestamps and authoring semantic one-line groups;
- run `scripts/check-caption-review-plan.mjs` when preparing or explicitly auditing the plan. `captions/caption-review-plan.json` is the semantic draft and approval authority, not an installable caption file: promote the settled wording/timing plan to `captions/captions.json`, then run `scripts/check-captions.mjs` and `scripts/install-captions.mjs <captions> <composition> <design-system>` when captions are installed;
- build released captions in HyperFrames. Add MG only at selected semantic nodes after the caption baseline is viable. Never cover captions, PiP, product evidence, or protected UI; face coverage follows the brief-semantic-only A-axis rule below. Global MG is forbidden in `subtitles` mode.
- default to A-axis overlays in `subtitles` mode: keep the talking-head video full-frame beneath localized MG. A B-axis stage is a recorded motion-plan preference, not a new workflow gate.

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
3. For ChatCut, after approval instruct the active Agent with `Read https://chatcut.io/chatgpt to install and use the ChatCut plugin` in Codex or `Read https://chatcut.io/claude to install and use the ChatCut plugin` in Claude Code. Do not add a deterministic ChatCut installer to this repository.
4. After a job is scaffolded, run `./scripts/check-environment.sh install-job jobs/<job-id> --yes` only after approval. It must first search the configured npm `_npx` cache for the exact declared HyperFrames version and reuse it through a job-local package symlink. Download HyperFrames only when no exact cache exists. Resolve GSAP independently so a missing GSAP package never forces a second HyperFrames download.

ChatCut is used only to create the editable rough cut. If it is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative fallback; do not claim that ChatCut ran. Captions, MG, and B-axis composition always belong to HyperFrames. HyperFrames requires no global install: `install-job` reuses an exact `_npx` cache entry when available and otherwise installs the pinned npm dependency inside the job.

### 1. Intake and probe

1. Create a job with `scripts/scaffold-project.sh`.
2. Copy or link the source into `input/`; never modify it.
3. Ask once for optional caption, reference-script, and visual-axis preferences. Record supplied choices; otherwise keep them deferred and continue.
4. Probe duration, dimensions, frame rate, codecs, sample rate, and rotation with FFprobe.
5. For every ChatCut rough cut, start building or reusing the original-source waveform index as soon as the source is probed, following `docs/source-audio-silence-index.md`. Continue ChatCut import and semantic editing while a new index is being built; have it ready for one batch seam lookup before rough-cut review. Do not decode the MOV again per cut.
6. Use 30 fps as the project timeline default, even if the source is 29.97 fps; use another rate only when the user requests it. Record source and timeline rates separately.

### 2. Transcript and alignment

1. Use ChatCut for transcription and timing. Do not use local ASR; if ChatCut is unavailable, follow environment preflight and defer transcript-dependent edits. The original audio may still be indexed locally for a targeted seam audit.
2. If a reference script is supplied, persist the immutable original under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. Reconcile its wording with the recording: remove unspoken text, restore spoken omissions, and use the confirmed script wording for release.
3. When the reference contains `【】`, use only `speechText` from `state/reference-script-annotations.json` for released wording and retain every visual note separately.
4. Store timestamps in `state/transcript.json` and evidence in `state/transcript-reconciliation.json`; run the reconciliation checker.
5. Advancing transcription snapshots the source-timeline word timings to immutable `state/source-transcript.json`; its workflow hash survives rough-cut revisions.
6. Preserve uncertainty. A release-impact wording conflict is resolved against the recording before release; it does not create a separate default user gate.

### 3. Shared edit lock

Use [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md) as the sole detailed rough-cut policy. This section records only ChatCut operations and required evidence.

1. Create or target a ChatCut project. Before importing, call `browse_assets` and reuse the exact source asset ID if it is already in the target project. Otherwise import the authoritative job copy through the ChatCut `asset-import` skill; do not substitute an unverified proxy or retry through multiple routes. If the local helper is blocked by sandbox `EPERM`, request one scoped escalation when authorized and stop if denied. Record the asset ID and separate setup, transfer, and transcription time.
2. Use ChatCut only to build the editable talking-head rough-cut timeline; do not add released captions, MG, or B-axis composition there.
3. Complete the ChatCut semantic edit according to the Golden Standard; retain each valid recorded phrase or give it an explicit editorial disposition. Do not remove content based only on ASR omission or script mismatch.
4. Immediately after the ChatCut semantic edit, apply the Golden Standard's terminal-tail trim, then run its remaining candidate and completeness checks using `state/source-transcript.json`, Script with `showSilence:true`, and `scripts/detect-silence.sh` for its candidate-only scan. Classify the remaining candidates before the existing review gate.
5. Use the source-waveform procedure in the Golden Standard and `docs/source-audio-silence-index.md` for one schema-v2 batch lookup of the retained ChatCut seams. The map must come from a fresh ChatCut asset inspection and original-file probe; it checks map-field consistency, not remote bytes. The lookup is evidence only and does not require exhaustive per-seam playback or edits. Record source asset IDs/names, source and rough-cut durations, and measured `elapsedSecondsByStage` in `state/chatcut-roughcut.json`. Keep the cut closed before `rough-cut-review`.
6. Follow the Golden Standard's local transition rule: use a 0–2 frame transition only after confirming a hard pop remains after the physical boundary is correct; default to 0 and never use smoothing to hide a gap.
7. If the user requests a revision, revise the same ChatCut timeline and reopen the same browser review. If the user approves, record approval and export once to `roughcut/a-roll.mp4`; perform only the basic media probe and lock.
8. In `auto`, resolve `rough-cut-review` by recording `automatic-fallback`. Apply the candidate-discovery and source-waveform seam policy only to ChatCut rough cuts. If ChatCut is unavailable, use the conservative FFmpeg fallback described below. The legacy trim-plan audit is restricted to output explicitly marked `roughCutEngine: "ffmpeg-fallback"`.
9. Promote the approved export with `scripts/promote-job-media.mjs <job> roughcut <export> --consume-source` before advancing `rough-cut-export`. It atomically replaces `roughcut/a-roll.mp4` and refreshes the HyperFrames input through a hard link when possible.
10. For `subtitles`, retain any ChatCut timing output only as raw alignment evidence; released captions are authored and installed in HyperFrames. Released wording comes from the persisted reference script when supplied, otherwise from the reconciled recording transcript.

The shared baseline for both caption modes is: protected regions take precedence over decoration; protect the face, PiP, product evidence, UI, and any active caption; check text wrapping, entrance/peak/hold/exit bounds, and audio continuity before adding decorative motion. Caption mode changes only how speech is represented and how much motion is appropriate, not the rough-cut, source-lock, safe-area, or HyperFrames validation discipline.

If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and perform only conservative silence and false-start removal. Never pretend the ChatCut stage ran.

### 4. Rough-cut source-boundary procedure

The ChatCut rough-cut rules are defined only in [`docs/talking-head-trim-standard.md`](docs/talking-head-trim-standard.md). Use [`docs/source-audio-silence-index.md`](docs/source-audio-silence-index.md) for index and batch-lookup mechanics. These checks finish inside the existing `rough-cut-review` path; they add no state or approval gate. The legacy trim-plan audit runs only when `roughCutEngine` is explicitly set to `ffmpeg-fallback`; it does not apply to ChatCut timelines.

### 5. Semantic beat map and motion plan

Create `state/beat-map.json` before writing animation code.

Copy `assets/design-system.default.json` to `state/design-system.json`, then change it only when the user or supplied brand requires a different system. 得意黑 is the required default display face; missing font media is a blocking preflight failure, not permission to silently fall back.

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

Run `scripts/check-visual-plan.mjs` while preparing a motion-bearing plan or when `auto` validation is enabled. This check does not add a workflow gate.

For `subtitles`, write exact one-line segmentation to `docs/caption-plan.md`; for `motion-copy`, review complete designed-speech coverage in the beat map and motion plan without a caption plan. Bundle the applicable artifacts with reconciliation, MG mappings, copy, information gain, style, timing, axis, and intentional no-MG passages in one internal creative confirmation package. It is consumed by HyperFrames and does not add a user gate.

If `state/reference-script-annotations.json` contains visual notes, bind each note to the locked recording timeline and list it in the creative confirmation package as `adopted`, `adjusted`, or `rejected`, with its resolved local scope, final treatment, reason, and relevant beat IDs. Plan every unannotated passage normally. Correct or reject a note that conflicts with the recording, available evidence, visual-value rules, protected regions, or coherent axis behavior.

Any later change to caption segmentation, the MG node set or count, on-screen copy, support role, visual style, or axis mode is a plan change. Use `replan` to return to `motion-plan` and regenerate the package. Only parameter-only corrections that preserve the selected nodes, copy, meaning, style family, and axis—such as a small position, size, or easing adjustment—may return directly to implementation.

In `motion-copy` mode, do not add a separate subtitle band; spoken wording appears inside the designed effects. In `subtitles` mode, the reconciled captions carry complete transcript coverage and the beat map contains only supplemental visuals. Establish a caption-only composition baseline, then add local MG where the creative confirmation package identifies a semantic node and a protected-region-safe placement; this does not require a separate export or user approval. English may support Chinese copy, but cannot replace essential Chinese meaning.

Every subtitle-mode local MG must close one documented viewer cognition gap and follow `docs/subtitle-mg-standard.md`. Record its viewer question, support role, concrete removal loss, visual encoding, still-frame value, attention cost, factual-claim sources, and plain-language term explanations in `state/beat-map.json`. New information without sufficient editorial value is not a reason to add MG.

For `subtitles`, preserve ChatCut timing pages only as evidence, align the settled release wording to word timestamps, and write the proposed semantic segmentation to `captions/caption-review-plan.json`. Validate it for transcript completeness, protected terms, function-word isolation, duration, overlap, and measured single-line width when preparing or when `auto` validation is enabled. The review plan is not directly installable; promote that exact plan to `captions/captions.json` and install the promoted file as timed `.clip` layers in HyperFrames after wording and timing are settled.

### 6. HyperFrames composition

1. Use HyperFrames for media ownership, caption installation, MG, A/B-axis composition, timing, checks, and render.
2. Use HTML/CSS for layout and visual components.
3. Use one paused GSAP timeline registered with HyperFrames. All motion must be deterministic and seek-safe.
4. Keep `<video>` and `<audio>` as direct children of the composition root.
5. Use transforms, opacity, color, and border-radius for motion. Avoid runtime layout measurements and nondeterministic values.
6. Keep the A-roll moving when shown in a picture-in-picture window.
7. Embed 得意黑 through `@font-face`. Run `scripts/check-font.sh` when `auto` validation is enabled or when font behavior is in doubt.
8. Measure text in its final font before animation. Reserve room for outline, shadow, rotation, and overshoot at their peak values.
9. Use `scripts/check-information-value.mjs` and `scripts/check-layout-constraints.mjs` when `auto` validation is enabled. They are not additional workflow gates.
10. Preserve `data-motion-contract="enforced"` and the browser contract from the scaffold. Generic container borders, non-token connector colors, decorative labels, and caption-offset drift are blocking failures; HyperFrames remains responsible for computed peak-frame bounds.
11. Put every authored visual inside one `data-motion-group` that declares axis, primary/auxiliary role, active time, face-cover policy, primary flow, and topology. Mark connectors with their reveal group and rendered flow axis. Mark icon/status roots as `data-motion-role="indicator"` and other composite collision boxes as `data-collision-unit`; an intentional overlap exception applies only to the exact unit carrying `data-overlap-policy="intentional"`. Every `data-motion-role="label"` declares `data-information-role` as `evidence`, `explanation`, `calibration`, `organization`, `action`, or `consequence`; these values match Beat Map `supportRole`. The existing browser contract enforces bounds, protected-region separation, A-axis replacement, group lifetime, and primary-flow continuity during timeline updates.
12. Author each MG Beat under `hyperframes/mg/<beat-id>/` as `fragment.html`, `style.css`, and `timeline.mjs`. Beat IDs match `^[a-z0-9][a-z0-9-]*$`; `mg-<beat-id>` is reserved for the generated wrapper. The builder encloses each stylesheet in `@scope (#mg-<beat-id>)`; keep shared declarations in `index.template.html`. Start the authored Beat root hidden, reveal it explicitly on the shared timeline, and let the builder own its hard exit. Run `scripts/build-composition.mjs` before checks or renders; `hyperframes/index.html` is deterministic generated output and must not be edited. Do not ship a placeholder `*.motion.json`; any motion sidecar must match the checked HTML basename and reference real composition selectors.

### 7. A/B-axis direction

- The A-axis is the talking-head footage with designed effects layered over it.
- A-axis effects use replacement, not accumulation: one primary information group and at most one auxiliary group may remain visible. The prior group exits before the next group enters.
- Inside an approved subtitles-mode A-axis MG passage, prefer 1.8–3.0 second information groups. Caption-only passages have no MG cadence requirement.
- Prefer one face-safe A-axis zone. Informative MG may briefly cover the face for up to about three seconds, but the previous group must exit first and groups may not accumulate.
- An explicit user instruction may override the default face-coverage duration; record it as described in `docs/revision-standard.md` and honor it without repeatedly shrinking useful evidence to preserve the face.
- Anchor portrait A-axis MG in the upper-middle region and let it expand downward when needed; do not place the default focal group directly at frame center. For landscape A-axis MG, prefer the upper-left or upper-right region according to face and evidence placement.
- A-axis surfaces may use localized semi-transparent glass with a restrained blur and the existing typography, borders, shadows, palette and easing. Full-frame glass, haze, or blur is forbidden.
- Every MG declares a horizontal or vertical primary flow. The main chain cannot turn 90 degrees; a secondary-axis branch is allowed only from a terminal node.
- Reuse the visual reference or component named by `visualReference` when only copy, timing, or size changes. A changed primary flow, hierarchy, or animation grammar is a new visual plan.
- The B-axis is a full motion-design stage with the speaker optionally retained in a live circular or shaped window.
- B-axis effects may accumulate within one semantic scene, then exit as a group at that scene boundary. The live PIP remains protected and visibly moving.
- The B-axis PIP exclusion zone is fixed by `design-system.json`; no non-PIP component may overlap it at entrance, peak, hold, or exit. Reserve the zone in CSS before adding lower-third content.
- Use B-axis only when a phrase benefits from a full visual stage. Do not switch axes merely to create activity.
- Avoid rapid A/B/A/B alternation. One coherent B-axis passage is usually stronger than many short cuts.
- The effect may cover the face when the effect is the subject, but it must remain intentional and compositionally balanced.

### 8. Timing and density

- Phrase animation begins within three frames of its acoustic onset unless an intentional anticipation is documented.
- The first meaningful event is word-anchored and appears within 400ms. Connector and downstream container events in one reveal group start within two frames.
- In `motion-copy` mode, create a meaningful micro-event every 0.35–0.9 seconds and normally keep major layouts for 1.8–3.5 seconds.
- In `subtitles` mode, only approved local-MG passages use the 0.8–1.8 second supplemental-motion cadence; caption-only passages require no animation.
- A micro-event may reveal a clause, complete a diagram, strike a tool, move a playhead, change hierarchy, or trigger a semantic particle burst. Do not treat every micro-event as a new scene.
- No more than two consecutive phrases may use the same transition family.
- Reusing a complete visual signature requires one `reuseGroup` and a concrete `reuseReason`.
- Use incremental composition only on the B-axis when meaning accumulates. On the A-axis, use the declared replacement cadence instead.
- Hold important words long enough to read. Fleeting symbols and plus signs are defects.
- Decorative loops must continue through their intended scene end; never freeze before the audio ends.
- Each active frame has one primary focal group and one to four supporting elements. More is noise; fewer may be visually empty unless the emptiness is intentional and documented.
- Primary content should occupy roughly 28–65% of the vertical frame. Large blank cards and crowded edge-to-edge panels both fail.

### 8.1 Typography and layout

- For a 1080×1920 vertical video, primary Chinese copy is normally 84–156 px; secondary copy is at least 42 px.
- Display line height stays between 0.92 and 1.12. Body or explanatory copy stays between 1.15 and 1.35.
- Keep at least 54 px horizontal and 88 px vertical canvas clearance. Reserve at least 18 px around outlined or transformed glyphs.
- Panel padding is normally 48–72 px. Never solve crowding by shrinking primary text below the minimum.
- A rendered Chinese line must never end or begin as a single-character orphan. Use a measured single line, balanced multi-line grouping, or an explicit semantic break with at least two visible Chinese characters on each line.
- Primary content should normally sit between 22% and 78% of frame height. The top strip is for small status labels, not the main sentence.
- Empty components are forbidden. A panel must contain copy, an icon, a status, a diagram, or visible animated state.
- Evaluate entrance, peak overshoot, hold, and exit frames. A layout that works only at rest is not valid.

### 9. Validation and delivery

`review` mode:

1. Build the HyperFrames composition and fix failures that prevent it from rendering.
2. Render once at the requested delivery quality through the job's stable render entrypoint; use `npm run render:chunked` for the known macOS multi-media route.
3. Verify output existence, duration, frame rate, dimensions, and audio stream with FFprobe.
4. Present the file for direct user inspection. These basic checks mean only that the file is structurally usable; they do not judge the edit, animation, or aesthetics.
5. Do not run full automatic validation, a standard preview, or a short sample unless the user explicitly requests one.

`auto` mode:

1. Run the applicable automatic checks in `docs/quality-gates.md` at the existing state transitions. The state machine enforces Golden Standard rough-cut checks, plan/reconciliation checks, and the detailed render receipt; deeper HyperFrames/content diagnostics remain explicit commands when requested.
2. Keep the same state sequence and render the delivery from `composition` to `render`; any diagnostic preview is evidence only and never becomes a state.
3. Reuse unchanged evidence only when the existing contract accepts it; do not present an automated pass as editorial or aesthetic approval.

Only canonical large media persists: immutable `input/source.*`, `roughcut/a-roll.mp4`, HyperFrames input, optional local diagnostics, and `output/final.mp4`. Use `promote-job-media.mjs` for explicit external exports; it must reject immutable input, escaped directories, and approved artifacts. Never scan download folders or delete unregistered user files.

## Gold-standard visual language

The finished reference is not a fixed template. It is a reusable motion grammar.

For `captionMode: subtitles`, use `examples/traework-reference/` and `recipes/traework-subtitles.json` as the preferred reference profile. Keep `examples/gold-standard/` as the runnable `motion-copy` reference; do not merge its embedded-speech behavior into subtitle-led jobs.

Use recipes from `recipes/` as semantic building blocks, then redesign their layout and choreography for the current sentence. Never paste the same card, transition, or palette across an entire video.

Required qualities:

- large, expressive typography that can overlap the speaker;
- clean surfaces with controlled color, not global haze or dirt;
- soft but saturated accents, restrained shadows, and selective glass;
- clear foreground, midground, and background depth;
- meaningful icons and components rather than empty colored shapes;
- varied motion families joined by consistent typography and easing;
- high animation density without high visual noise.

Read `docs/visual-language.md` before authoring. Treat its anti-patterns as render blockers.

## Failure policy

- Stop on missing input, unreadable media, invalid timing data, or failed final checks.
- Retry a tool operation only when the failure is transient and the retry is safe.
- Never hide a fallback or failed assertion.
- Preserve the last known-good rough cut and HyperFrames composition before a major revision.

## Completion definition

A job is complete on the `review` path when the final file exists, basic media checks pass, and the user has the opportunity to inspect it. Automatic-validation completion is claimed only when the user explicitly selected `auto` and the applicable checks passed.
