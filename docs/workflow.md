# Workflow Architecture

Use this document as a just-in-time phase router. At the start or resume of a job, read `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then read only the matching route and phase section below. Load later-stage guidance when the job reaches that state. The state machine records transitions; it does not load Agent instructions.

## Active-state route

| `currentState` | Read for this state |
| --- | --- |
| `intake` | [Intake](#intake) and [Environment preflight](agent-setup.md#environment-preflight) |
| `transcription` | [Transcript and alignment](#transcript-and-alignment) |
| `rough-cut` | [Rough cut](#rough-cut) and [Talking-head trim standard](talking-head-trim-standard.md) |
| `rough-cut-review` | [Rough-cut review and export](#rough-cut-review-and-export), [State machine](state-machine.md), and [Quality checks](quality-gates.md) |
| `rough-cut-export` | [Rough-cut review and export](#rough-cut-review-and-export) and [State machine](state-machine.md) |
| `motion-plan` | [Motion plan](#motion-plan) and [planning inputs](../templates/planning-inputs.README.md); consult segmentation or custom-design guidance only for that decision |
| `composition` | [Composition](#composition); templates already implement the shared animation contract. Custom modules use [the composition contract](technology.md#hyperframes-composition-contract) |
| `render` | [Delivery](#delivery), [Render commands](agent-setup.md#render-commands), and [Quality checks](quality-gates.md) |
| `complete` | Read [Editorial revisions](revision-standard.md) only when making a revision |

Use [`state-machine.md`](state-machine.md) for transition commands, mode decisions, and revision routing. A generated artifact alone does not advance workflow state.

## Intake

- Require a local talking-head recording. If it is missing, request its path and stop. Ask once for optional caption, reference-script, and visual-axis preferences; record supplied choices and leave unanswered choices deferred.
- Before scaffolding, inspect the active Agent's ChatCut tools and run `./scripts/check-environment.sh check`. Use `scripts/scaffold-project.sh`, put the source in the job's `input/`, and probe it with FFprobe. Use a 30 fps project timeline by default, recording the source rate separately.
- The original source is immutable. Create a new artifact for edits and update `state/project.json` for destructive-looking operations. Keep job media, generated state, previews, and logs in that job directory.
- If a required integration or dependency is missing, follow [Environment preflight](agent-setup.md#environment-preflight). Installation, global Agent configuration changes, and OAuth require user approval; client-specific ChatCut instructions are in that guide.
- Once ChatCut Script is available, continue with [Rough cut](#rough-cut). Use `review-cut` for the handoff; local transcription artifacts need not be created merely to advance through the intermediate state labels.

## Transcript and alignment

- Use ChatCut for transcription and timing; do not substitute local ASR. Local silence analysis may support a targeted seam review but does not provide transcript or speech authority.
- Preserve a supplied reference script unchanged under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. The recording determines what was spoken; reconcile omissions and additions before release. ChatCut transcription and timing are provisional audio-derived evidence for the rough cut.
- In a reference script, `【】` contains medium-strength visual notes scoped to the immediately preceding semantic clause unless the note specifies another range. Keep notes separate from speech; only reconciled `speechText` can enter released wording. Ordinary `[]` is spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.
- Edit from ChatCut's transcription and timing directly. Local transcript conversion and reconciliation are deferred until after rough-cut approval. If `state/transcript.json` already exists, the normal transcription transition locks it without requiring reconciliation. Preserve any established source-transcript lock.

## Rough cut

- Follow the [Talking-Head Trim Standard](talking-head-trim-standard.md): one semantic edit, one internal-pause cleanup, one edge tightening, then deliver. `prepare-rough-cut.mjs ... tighten` handles index creation, mapping conversion and calculation from saved ChatCut responses.
- Use `workflow-state.mjs ... review-cut --project-id <id> --timeline-id <id>` to record and present the cut. No reconciliation, candidate audit or Caption Plan is needed before listening. Existing usable cuts can go straight to review; revisions address the user's reported passages.
- Give the project link and duration immediately after the editing batch is confirmed. Report skipped/blocked operations honestly; further diagnosis follows user feedback.
- If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative FFmpeg fallback. `state/trim-plan.json` and its legacy audit apply only to that explicit fallback.

## Rough-cut review and export

- `rough-cut-review` is the only approval gate and the user's normal full playback in ChatCut. Do not ask for a separate item-by-item listening pass. Record the user's explicit approve, revise, or `fallback-auto` decision in `review`; in `auto`, record `automatic-fallback` only when the user selected that mode. Do not infer a decision from silence.
- After the decision, disable ChatCut caption rendering and export clean A-roll. Promote it once with `scripts/promote-job-media.mjs` to `roughcut/a-roll.mp4` and run the basic media lock before advancing. Record the disabled-caption export setting in `planning-inputs.json` as `cleanExport.captionRenderDisabled`; keep the last known-good rough cut available.
- For an export with excess trailing audio, run `scripts/align-export.sh <exported.mp4>`. Its stdout is the usable media path: the original when already aligned, otherwise the verified stream-copy output. Promote that path.

## Motion plan

- After rough-cut approval, save the source asset's `inspect_asset` transcript responses (all ranges) and run `node scripts/prepare-rough-cut.mjs <job> transcript <saved-pages.json>...`. It converts and locks source words. Reuse an existing locked transcript; if a local transcript already exists, use `workflow-state.mjs ... lock-transcript`. Reuse the successfully applied source mapping from rough-cut editing, or collect the final timeline once if absent or changed. This is the first phase that needs local words for captions.
- Use `node scripts/generate-plan.mjs <job> --outline` to obtain released-time segment IDs and word indices before authoring cue ranges. It uses the production mapper; no temporary transcript-conversion script is needed.
- Author content decisions in `state/planning-inputs.json` using the [input example](../templates/planning-inputs.README.md), then run `node scripts/generate-plan.mjs <job-directory> --write`. It derives the released transcript, captions, source mapping, reconciliation, Beat Map and readable plans as one batch. Existing decisions/conflicts are preserved; edited generated files are protected. Use `--replace-existing` only when deliberately replacing/importing existing outputs after preserving their decisions in the inputs; the command backs them up.
- Choose MG from the [motion template catalog](../templates/motion-graphics/README.md). Record template ID (or `custom` with a reason), Beat ID, copy, assets, layout and spoken anchors in that input. Metadata and repeated document fields are derived, not re-authored per job.
- Write content, cue ranges, chosen templates, anchors and placement once in `planning-inputs.json`. The generator produces Beat Map, shared template metadata, caption mappings and documents; caption-only beats need no MG rationale. Use [MG guidance](subtitle-mg-standard.md) for a content/design decision, not a per-node checklist.
- The three Global-direction lines that describe the design system (caption mode, typography, palette) are rendered from `state/design-system.json`, not authored; writing them into `planning-inputs.json` is an error. Which axes the film uses, and how it ends, remain authored.
- Start from `assets/design-system.default.json`; change it only for a user request or supplied brand. For `subtitles`, prepare captions from reconciled speech and reserve MG for supplemental meaning. For `motion-copy`, place all spoken wording in the designed motion. Choose A-axis overlay or B-axis stage from the phrase's meaning and record the recommendation and reason with the rough-cut decision; record the resolved choice in workflow and creative-confirmation state.
- If the reference script has visual notes, bind each to the locked recording timeline and record it as `adopted`, `adjusted`, or `rejected`, with local scope and relevant beat IDs. Plan unannotated passages normally.
- The creative-confirmation package records settled wording, captions, MG, style, timing, axis, and intentional no-MG choices. It is the baseline for production, not a new approval gate.

## Composition

- Run `node scripts/compose-job.mjs <job-directory>` after plan generation. It advances planning, assembles MG, promotes and installs captions, then builds and advances composition. It performs the existing release checks in order; no separate approval, manual status edit, build or standalone checker run is needed.
- For a local update, use `assemble-mg.mjs --beat <id>` or edit the affected custom module, then advance composition normally. The builder preserves authored files; the render entrypoint rebuilds before rendering.
- State transitions check consumed dependencies. In `review`, a scoped visual revision updates the Beat Map and module, rebuilds, and refreshes those bindings without rewriting earlier plan documents. `auto` retains its plan-authority checks. Use explicit `verify` for a full fingerprint audit, not on every step.

## Delivery

- Use the job package's `npm run render` or `npm run render:revision` entrypoint for the normal one-render delivery path. Follow [`quality-gates.md`](quality-gates.md) for the selected mode's checks.
- On successful render, run `node scripts/workflow-state.mjs <job>/state/workflow.json advance --artifact output/final.mp4` (use `output/final.candidate.mp4` for a revision), then give the output path to the user. The renderer and transition already probe media; do not add another full audit or preview cycle without a specific failure or request.
- Review the rendered MP4 as the user's editorial handoff; that review is not another workflow state or gate. Claim automatic-validation completion only when `auto` was explicitly selected and its listed checks passed.

## Revisions

For a completed job, reopen the earliest affected state with `scripts/workflow-state.mjs`; use [`revision-standard.md`](revision-standard.md) to scope and document the revision. Keep the settled motion plan and creative-confirmation package as the baseline for local composition edits; use motion planning for global creative changes.
