# cut-motion Agent Protocol

cut-motion turns a talking-head video and an optional reference script into a tightly cut, motion-designed video. This repository is an Agent workflow, not a LangGraph, LlamaIndex, or fixed-template application.

`AGENTS.md` is the canonical operating contract. Codex, Claude Code, and compatible coding agents must follow it before editing media or authoring motion.

## Minimum input

- A local talking-head video.
- Optional preferences: caption mode, reference script, visual-axis strategy, output aspect, style references, and autonomy mode.

If media is missing, ask for its local path and stop. After receiving it, ask once for any known preferences without blocking progress when the user has none. A supplied script is a high-priority reference, never ground truth; the recording remains authoritative.

A reference script may contain local visual notes in full-width `【】`. These are medium-strength, non-exhaustive references for the immediately preceding semantic clause unless a note explicitly names another local range. They never enter released wording, replace whole-video MG and edit analysis, or count as final axis or motion approval. Ordinary `[]` remains spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.

## Required outputs

Each run creates a job directory containing:

```text
jobs/<job-id>/
├── input/
├── state/
│   ├── project.json
│   ├── transcript.json
│   ├── transcript-reconciliation.json
│   ├── reference-script-annotations.json
│   ├── trim-plan.json
│   ├── design-system.json
│   ├── creative-confirmation.json
│   ├── workflow.json
│   ├── beat-map.json
│   └── qa-report.json
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

Never overwrite the original source video. Every destructive-looking operation must produce a new artifact and update `state/project.json`.

Each job directory is an isolated working directory. Do not place job media, generated state, previews, or logs in the cut-motion repository root.

## Toolchain

Use the first available tool in each stage:

1. **Rough cut:** ChatCut project and editable timeline.
2. **Transcription:** recorded speech, supplied reference script, ChatCut transcription, then a local speech-to-text fallback.
3. **Precision trim:** FFmpeg and FFprobe.
4. **Motion design:** HyperFrames HTML/CSS with a single seek-safe GSAP timeline.
5. **Validation and render:** HyperFrames CLI, FFprobe, frame snapshots, and audio silence checks.

Remotion and Vibe Motion are not part of the default stack. Use them only when the user explicitly requests them and record the deviation in `state/project.json`.

## Operating modes

- `review` is the default. Always pause at the locked edit and final HyperFrames preview. Pause for creative confirmation and a short visual sample only when their documented trigger conditions apply.
- `auto` runs end to end using the gold-standard visual language and conservative trim thresholds. It still performs every quality gate.

Passing an automated check is not a substitute for a review gate in `review` mode.

## Workflow state machine

`state/workflow.json` is the authoritative state. Never advance by assumption or by merely creating the next artifact.

Use `scripts/workflow-state.mjs` for every transition:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json status
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json advance --artifact <path> --note <summary>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json approve --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json revise --actor user --note <feedback>
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json reopen <rough-cut|motion-plan|composition|delivery> --actor user --note <feedback>
```

The mandatory user review gates are:

1. rough-cut review;
2. final-preview review.

Creative-confirmation review is additionally required for any MG, `motion-copy`, B-axis or hybrid treatment, release-impact transcript ambiguity, or explicit user request. Visual-sample review is required for first or changed motion language, axis behavior, motion typography, high-attention MG, or an explicit caption-layout precheck. Caption-only subtitle work may proceed to final preview without a separate sample. Generate creative artifacts internally even when their user gate is skipped.

In `review` mode, stop at every required gate, present the artifact, and wait for the user to approve or request revision. In `auto` mode, required gates are recorded as `auto-approved`; inapplicable gates are recorded as `skipped`. The user may switch modes at any time.

Every creative round has a `revisionId`. Preserve prior decisions in `history` and mark invalidated downstream decisions `superseded`; never rewrite history. `currentState` and `pendingGate` alone identify the active position.

Do not interpret silence as approval in `review` mode.

Completed jobs stay in the same job directory when the user requests revision. Use `reopen`: editorial cuts return to `rough-cut`, MG structure or copy returns to `motion-plan`, parameter-only visual changes return to `composition`, and encoding-only changes return to `render`. Only affected gates become `superseded`; delivery-only revision retains final-preview approval. Render a delivery revision to `output/final.candidate.mp4`; successful `render` advancement atomically promotes it to `output/final.mp4`, so the last validated delivery remains available until replacement passes.

The `final-preview` is rendered with HyperFrames `standard` quality; the final delivery uses `high` quality. Both use the same composition, resolution, frame rate, timing, and audio. When presenting the preview, explicitly say that approval triggers the stronger delivery encode and final media verification. After approval, state that the high-quality `output/final.mp4` has been generated and why this delivery step follows the preview.

## Caption modes

`captionMode` is independent of workflow mode:

- `motion-copy` is the no-subtitle mode. Every spoken phrase appears inside the designed motion; there is no separate subtitle layer.
- `subtitles` is the default release path. Captions carry the spoken transcript; motion graphics carry only supplemental meaning such as diagrams, tool labels, counters, comparisons, icons, and semantic emphasis.

If the user has no caption preference, analyze the locked edit and recommend `subtitles` or `motion-copy` before rough-cut approval. Accepting that review also accepts the stated caption, reference-script, and visual-axis recommendations. A late caption-mode change at or after planning returns to `motion-plan`.

For `subtitles` mode:

- treat `docs/subtitle-segmentation-standard.md` as the binding wording, grouping, timing, and single-line specification;
- treat `docs/subtitle-mg-standard.md` as the binding MG selection and review specification;
- use white 得意黑;
- inherit `captions.fontWeight`, which defaults to `400`; do not use `700` or synthetic bold unless a confirmed brand requirement changes the design system;
- use a soft downward black shadow, not an opaque subtitle bar;
- render exactly one line per cue. Segment by complete lexical units, syntax, clauses, breath, and reading rhythm before applying width constraints. Never split a protected word or fixed phrase, isolate a function word or particle, or create a cue merely to satisfy a raw character count;
- allow `?` or `？` only as the final character of a cue; replace every other punctuation mark, including internal commas and enumeration commas, with a single space;
- target 4–10.5 measured display units and 0.8–2.5 seconds per cue; allow up to 11.8 measured units with cue-level fitting between 88–96px. A meaningful short closing phrase may be an explicit exception, but a one-character cue is always invalid;
- keep captions centered in the lower safe zone;
- do not repeat the same sentence as a large motion headline;
- use the reconciled recording-backed transcript as wording authority; reference scripts and ASR are evidence only;
- retain `captions/chatcut-pages.json` as raw timing evidence, but do not preserve its `/` pagination blindly. Build `captions/caption-review-plan.json` by aligning the approved wording to word timestamps and authoring semantic one-line groups;
- run `scripts/check-caption-review-plan.mjs` before presenting the plan. After `motion-plan-review` approval, promote that exact plan to `captions/captions.json`, then run `scripts/check-captions.mjs` and `scripts/install-captions.mjs`;
- start with a caption-only HyperFrames delivery. Add MG only after that baseline is viable and only at selected semantic nodes. Never cover captions, PiP, product evidence, or protected UI; face coverage follows the brief-semantic-only A-axis rule below. Global MG is forbidden in `subtitles` mode.
- default to A-axis overlays in `subtitles` mode: keep the talking-head video full-frame beneath localized MG. A full-screen MG stage with a reduced speaker PiP requires explicit user approval.

## Visual axis modes

Use these user-facing names; do not call them A-roll and B-roll:

- **A-axis overlay mode:** the talking-head video remains full-frame and localized MG appears above it.
- **B-axis stage mode:** motion design owns the full frame and the speaker may remain in a protected live PiP.

Infer the axis recommendation from the locked edit, content-display needs, and available supporting media. The rough-cut review states the recommendation and its reason; approval records it without another prompt. The creative-confirmation package still defines both modes. Any later B-axis stage or material speaker-visibility change requires explicit user approval. Record decisions in `state/project.json` and `state/creative-confirmation.json`.

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

The `subtitles` mode cannot proceed past rough cut without ChatCut; `motion-copy` may use the recorded FFmpeg fallback. HyperFrames requires no global install: `install-job` reuses an exact `_npx` cache entry when available and otherwise installs the pinned npm dependency inside the job.

### 1. Intake and probe

1. Create a job with `scripts/scaffold-project.sh`.
2. Copy or link the source into `input/`; never modify it.
3. Ask once for optional caption, reference-script, and visual-axis preferences. Record supplied choices; otherwise keep them deferred and continue.
4. Probe duration, dimensions, frame rate, codecs, sample rate, and rotation with FFprobe.
5. Normalize the project timeline to the source frame rate unless the user specifies another rate, then save the resolved inputs and defaults.

### 2. Transcript and alignment

1. Transcribe the recording through ChatCut when available; use local ASR only as fallback.
2. Reconcile that result with the optional reference script: remove unspoken script text, restore spoken omissions, and accept reference wording only when audio supports it.
3. When the reference contains `【】`, preserve the immutable original, use only `speechText` from `state/reference-script-annotations.json` for wording reconciliation, and retain every visual note separately.
4. Store timestamps in `state/transcript.json` and evidence in `state/transcript-reconciliation.json`; run the reconciliation checker.
5. Preserve uncertainty. Release-impact ambiguity is shown in the creative package and must be resolved before its approval.

### 3. Shared edit lock

1. Create or target a ChatCut project and import the source.
2. Build an editable talking-head timeline before effects.
3. Remove clear false starts, duplicated takes, and long empty sections. Use the non-blocking editorial heuristics in `docs/talking-head-trim-standard.md`; preserve complete meaning, intentional repetition or self-correction, natural breath, and comic or rhetorical timing.
4. Before rough-cut review, complete the precision-trim procedure below. Transcript meaning selects the take, multi-threshold acoustic evidence locates speech, and visible performance distinguishes a natural pause from a reading or reset pause.
5. When a cut, take, supporting visual, or axis recommendation remains ambiguous, run `node scripts/inspect-media-window.mjs <job> <job-relative-media> <start> <end>` on the smallest useful window, normally one to two seconds around the decision. It creates a filmstrip-plus-waveform diagnostic under `checkpoints/diagnostics/`. Never batch-scan every utterance.
6. Verify every seam individually and write the audited `state/trim-plan.json`. There must be no clipped phoneme, unintended gaze or body reset, black gap, frozen item, overlap, or detached audio.
7. Promote the explicit ChatCut export with `scripts/promote-job-media.mjs <job> roughcut <export> --consume-source`. It atomically replaces `roughcut/a-roll.mp4`, refreshes the HyperFrames input through a hard link when possible, and leaves only the canonical rough cut. User approval locks this exact media and trim-plan fingerprint.
8. Before presenting the rough cut, record any deferred caption and axis recommendations with `set-caption-mode` and `set-axis-mode` using `--actor agent --note <reason>`. Base axis choice on speaking-versus-demonstration content and usable supporting media; use an on-demand diagnostic when visual value or face continuity is uncertain.
9. Present the locked edit and recommendations together. Approval locks the edit and accepts the stated caption mode, reference-script status, and axis strategy in one interaction.
10. For `subtitles`, refresh ChatCut captions against the locked edited-audio timeline as raw timing and wording evidence, disable its render track, and inspect the clean export for residual pixels. Released wording is approved only in the creative confirmation package.

The shared baseline for both caption modes is: protected regions take precedence over decoration; protect the face, PiP, product evidence, UI, and any active caption; check text wrapping, entrance/peak/hold/exit bounds, and audio continuity before adding decorative motion. Caption mode changes only how speech is represented and how much motion is appropriate, not the rough-cut, source-lock, safe-area, or QA discipline.

If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and perform only conservative silence and false-start removal. Never pretend the ChatCut stage ran.

### 4. Edit-lock precision procedure

This procedure is an internal part of `rough-cut`; it is not a second production state or user review.

1. Run `scripts/detect-silence.sh` at `-30`, `-35`, and `-40 dB`; use the median detected speech boundary instead of trusting one threshold or an ASR word endpoint.
2. Convert candidates into `state/trim-plan.json`; record `trimProfile`, a `seams` entry for every actual edit boundary, and `verification`. Each seam must include semantic and visual evidence, the three acoustic boundary frames, applied frame, classification, reason, confidence, actual audio-transition frames, and completed picture/audio audit.
3. For the default `tight-talking-head` profile, trim asymmetrically: retain about 20 ms after outgoing speech and 50 ms before incoming speech, quantized to source frames. Tighten the outgoing decay independently; never move the incoming boundary later merely to make both sides equally tight. These are safety handles, not a target pause duration.
4. Preserve a pause when meaning and visible delivery remain continuous. Remove it when the speaker looks at a script, stops articulating, resets posture or gaze, or prepares a restart. A topic boundary alone does not justify keeping extra dead air.
5. After the physical cut is correct, inspect the first two to three incoming frames and restore one or two source frames when the onset sounds shaved; do not restore the whole discarded pause. Then apply zero to two frames of audio transition only when it neither attenuates the incoming onset nor restores discarded tail noise. Two frames is a ceiling, not a requirement.
6. Run the structural trim-plan check, apply the plan, and record the picture/audio seam audit. Advancing `rough-cut` automatically measures each seam against the final media at `-30`, `-35`, and `-40 dB`; removable resets and false starts may retain at most 80ms, quantized down to source frames. Natural pauses are exempt.
7. Re-align every later transcript word and animation cue by the cumulative removed duration. Use `scripts/shift-timestamps.sh` when a late cut changes existing state files.

Natural pauses inside continuous delivery remain at their performed length; they are not normalized to an arbitrary 80 ms. A cut is invalid if it clips a phoneme, removes a breath needed for comprehension, retains a visible reading/reset action, or creates a mismatched jump. A low-confidence boundary falls back to 50–120 ms of conservative padding and must be marked for review.

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
- motion family and transition family when motion is approved;
- micro-event timestamps and topology roles; connector/container events share a `revealGroup`;
- supporting components;
- entrance, hold, and exit timing;
- measured typography and layout bounds;
- collision, face-cover, and safe-area notes.

Run `scripts/check-visual-plan.mjs` before authoring. A beat map that fails is incomplete even if it is valid JSON.

For `subtitles`, write exact one-line segmentation to `docs/caption-plan.md`; for `motion-copy`, review complete designed-speech coverage in the beat map and motion plan without a caption plan. Bundle the applicable artifacts with reconciliation, MG mappings, copy, information gain, style, timing, axis, and intentional no-MG passages in one creative confirmation package.

If `state/reference-script-annotations.json` contains visual notes, bind each note to the locked recording timeline and list it in the creative confirmation package as `adopted`, `adjusted`, or `rejected`, with its resolved local scope, final treatment, reason, and relevant beat IDs. Plan every unannotated passage normally. Correct or reject a note that conflicts with the recording, available evidence, visual-value rules, protected regions, or coherent axis behavior.

Any later change to caption segmentation, the MG node set or count, on-screen copy, support role, visual style, or axis mode is a plan change. Use `replan` to return to `motion-plan` and regenerate the package. Require renewed user approval only when the regenerated package still meets a creative-review trigger. Only parameter-only corrections that preserve the approved nodes, copy, meaning, style family, and axis—such as a small position, size, or easing adjustment—may return directly to implementation.

In `motion-copy` mode, do not add a separate subtitle band; spoken wording appears inside the designed effects. In `subtitles` mode, the ChatCut-derived caption file carries complete transcript coverage and the beat map contains only supplemental visuals. The first subtitle-mode deliverable is caption-only; continue into local MG only where the creative confirmation package identifies a semantic node and a protected-region-safe placement. English may support Chinese copy, but cannot replace essential Chinese meaning.

Every subtitle-mode local MG must close one documented viewer cognition gap and follow `docs/subtitle-mg-standard.md`. Record its viewer question, support role, concrete removal loss, visual encoding, still-frame value, attention cost, factual-claim sources, and plain-language term explanations in `state/beat-map.json`. New information without sufficient editorial value is not a reason to add MG.

For `subtitles`, preserve ChatCut viewer pages as timing evidence, align the approved wording to word timestamps, and write the proposed semantic segmentation to `captions/caption-review-plan.json`. Validate it for transcript completeness, protected terms, function-word isolation, duration, overlap, and measured single-line width. Only after the creative package receives either required user approval or recorded conditional internal approval may that exact plan be promoted to `captions/captions.json` and installed as timed `.clip` layers.

### 6. Visual sample

Create a 3–5 second HyperFrames sample only when explicitly requested or when a motion-bearing plan has no matching approved visual fingerprint. It demonstrates typography, palette, depth, easing, and only the approved axis behavior. Caption-only subtitle work relies on final-preview review unless a caption-layout sample is explicitly requested. Show an A/B transition only for an approved hybrid plan.

When a subtitle sample uses a time window from the approved full caption track, derive it with `scripts/slice-captions.mjs`; do not hand-copy or retime sample cues.

Bind sample static checks to the independent sample HTML source and media checks to the rendered sample video. Approval stores the visual-language fingerprint. Reuse it when later revisions do not change visual language, axis behavior, typography, or high-attention MG.

### 7. HyperFrames composition

1. Use HyperFrames for media ownership, composition timing, checks, preview, and render.
2. Use HTML/CSS for layout and visual components.
3. Use one paused GSAP timeline registered with HyperFrames. All motion must be deterministic and seek-safe.
4. Keep `<video>` and `<audio>` as direct children of the composition root.
5. Use transforms, opacity, color, and border-radius for motion. Avoid runtime layout measurements and nondeterministic values.
6. Keep the A-roll moving when shown in a picture-in-picture window.
7. Embed 得意黑 through `@font-face` and verify the local WOFF2 file with `scripts/check-font.sh`.
8. Measure text in its final font before animation. Reserve room for outline, shadow, rotation, and overshoot at their peak values.
9. Run `scripts/check-information-value.mjs`; visible text below the design-system floor and self-evident labels are blocking failures.
10. Run `scripts/check-layout-constraints.mjs`; a one-character final line and any B-axis content that intrudes into the protected PIP zone are blocking failures.
11. Preserve `data-motion-contract="enforced"` and the browser contract from the scaffold. Generic container borders, non-token connector colors, decorative labels, and caption-offset drift are blocking failures; HyperFrames remains responsible for computed peak-frame bounds.
12. Put every authored visual inside one `data-motion-group` that declares axis, primary/auxiliary role, active time, face-cover policy, primary flow, and topology. Mark connectors with their reveal group and rendered flow axis; the existing browser contract enforces bounds, protected-region separation, A-axis replacement, group lifetime, and primary-flow continuity during timeline updates.

### 8. A/B-axis direction

- The A-axis is the talking-head footage with designed effects layered over it.
- A-axis effects use replacement, not accumulation: one primary information group and at most one auxiliary group may remain visible. The prior group exits before the next group enters.
- Inside an approved subtitles-mode A-axis MG passage, prefer 1.8–3.0 second information groups. Caption-only passages have no MG cadence requirement.
- Prefer one face-safe A-axis zone. Informative MG may briefly cover the face for up to about three seconds, but the previous group must exit first and groups may not accumulate.
- Anchor portrait A-axis MG in the upper-middle region and let it expand downward when needed; do not place the default focal group directly at frame center. For landscape A-axis MG, prefer the upper-left or upper-right region according to face and evidence placement.
- A-axis surfaces may use localized semi-transparent glass with a restrained blur and the existing typography, borders, shadows, palette and easing. Full-frame glass, haze, or blur is forbidden.
- Every MG declares a horizontal or vertical primary flow. The main chain cannot turn 90 degrees; a secondary-axis branch is allowed only from a terminal node.
- Reuse the approved sample or component named by `visualReference` when only copy, timing, or size changes. A changed primary flow, hierarchy, or animation grammar is a new visual plan.
- The B-axis is a full motion-design stage with the speaker optionally retained in a live circular or shaped window.
- B-axis effects may accumulate within one semantic scene, then exit as a group at that scene boundary. The live PIP remains protected and visibly moving.
- The B-axis PIP exclusion zone is fixed by `design-system.json`; no non-PIP component may overlap it at entrance, peak, hold, or exit. Reserve the zone in CSS before adding lower-third content.
- Use B-axis only when a phrase benefits from a full visual stage. Do not switch axes merely to create activity.
- Avoid rapid A/B/A/B alternation. One coherent B-axis passage is usually stronger than many short cuts.
- The effect may cover the face when the effect is the subject, but it must remain intentional and compositionally balanced.

### 9. Timing and density

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

### 9.1 Typography and layout

- For a 1080×1920 vertical video, primary Chinese copy is normally 84–156 px; secondary copy is at least 42 px.
- Display line height stays between 0.92 and 1.12. Body or explanatory copy stays between 1.15 and 1.35.
- Keep at least 54 px horizontal and 88 px vertical canvas clearance. Reserve at least 18 px around outlined or transformed glyphs.
- Panel padding is normally 48–72 px. Never solve crowding by shrinking primary text below the minimum.
- A rendered Chinese line must never end or begin as a single-character orphan. Use a measured single line, balanced multi-line grouping, or an explicit semantic break with at least two visible Chinese characters on each line.
- Primary content should normally sit between 22% and 78% of frame height. The top strip is for small status labels, not the main sentence.
- Empty components are forbidden. A panel must contain copy, an icon, a status, a diagram, or visible animated state.
- Evaluate entrance, peak overshoot, hold, and exit frames. A layout that works only at rest is not valid.

### 10. Validation and delivery

Run all gates in `docs/quality-gates.md`:

1. `npx hyperframes check`.
2. Reuse the hash-bound trim-plan and visual-plan results from edit lock and planning; rerun only checks whose inputs changed.
3. Run the snapshot contract through `scripts/run-validation-check.mjs`. It samples visual scenes only: A-axis MG entrance, resolved information state and exit; B-axis peak states; every A/B transition; and representative opening/closing frames. A caption-only result uses opening/middle/closing frames. Do not expand pure-caption beats into per-beat snapshots or export every video frame. A typical MG job uses about 12–30 snapshots; a larger set needs a corresponding number of high-risk visual scenes.
4. Visual inspection for clipping, overlap, empty cards, off-canvas panels, frozen PIP video, and dirty overlays.
5. Review-grid inspection against `examples/gold-standard/reference-frames` for density, scale, surface cleanliness, and hierarchy.
6. Audio inspection for new silence, clipped syllables, and accumulated sync drift.
7. Run `scripts/run-validation-check.mjs` for every check declared by `config/validation-evidence-contracts.json`; only its implementation-bound, hash-bound receipts are accepted. The reviewed media cannot serve as its own evidence.
8. Render the final preview with `npm run render:preview`, which uses HyperFrames `standard` quality.
9. After approval in `review` mode, render with `npm run render`, which uses HyperFrames `high` quality. It must preserve the approved preview's editorial content.
10. Verify output existence, duration, frame rate, dimensions, and audio stream.

Only canonical large media persists: immutable `input/source.*`, `roughcut/a-roll.mp4`, current visual/final previews, HyperFrames input, and `output/final.mp4`. Use `promote-job-media.mjs` for explicit external exports; it must reject immutable input, escaped directories, and approved artifacts. Never scan download folders or delete unregistered user files.

## Gold-standard visual language

The finished reference is not a fixed template. It is a reusable motion grammar.

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
- Never hide a fallback, skipped gate, or failed assertion.
- Preserve the last known-good rough cut and HyperFrames composition before a major revision.

## Completion definition

A job is complete only when the final file exists, the transcript is fully represented, the animation follows the audio, all quality gates pass, and the artifacts needed to reproduce the render are present.
