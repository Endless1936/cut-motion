# Workflow Architecture

Use this document as a just-in-time phase router. At the start or resume of a job, read `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then read only the matching route and phase section below. Load later-stage guidance when the job reaches that state. The state machine records transitions; it does not load Agent instructions.

## Active-state route

| `currentState` | Read for this state |
| --- | --- |
| `intake` | [Intake](#intake) and [Environment preflight](agent-setup.md#environment-preflight) |
| `transcription` | [Transcript and alignment](#transcript-and-alignment) |
| `rough-cut` | [Rough cut](#rough-cut) and [Talking-head trim standard](talking-head-trim-standard.md); read [source-audio index mechanics](source-audio-silence-index.md) when building the index or handling user-requested seam diagnosis |
| `rough-cut-review` | [Rough-cut review and export](#rough-cut-review-and-export), [State machine](state-machine.md), and [Quality checks](quality-gates.md) |
| `rough-cut-export` | [Rough-cut review and export](#rough-cut-review-and-export) and [State machine](state-machine.md) |
| `motion-plan` | [Motion plan](#motion-plan), then only the applicable [caption](caption-modes.md), [subtitle segmentation](subtitle-segmentation-standard.md), [subtitle MG](subtitle-mg-standard.md), [visual language](visual-language.md), and [density/layout](density-and-layout.md) guides |
| `composition` | [Composition](#composition), [HyperFrames composition contract](technology.md#hyperframes-composition-contract), [visual language](visual-language.md), and [density/layout](density-and-layout.md) |
| `render` | [Delivery](#delivery), [Render commands](agent-setup.md#render-commands), and [Quality checks](quality-gates.md) |
| `complete` | Read [Editorial revisions](revision-standard.md) only when making a revision |

Use [`state-machine.md`](state-machine.md) for transition commands, mode decisions, and revision routing. A generated artifact alone does not advance workflow state.

## Intake

- Require a local talking-head recording. If it is missing, request its path and stop. Ask once for optional caption, reference-script, and visual-axis preferences; record supplied choices and leave unanswered choices deferred.
- Before scaffolding, inspect the active Agent's ChatCut tools and run `./scripts/check-environment.sh check`. Use `scripts/scaffold-project.sh`, put the source in the job's `input/`, and probe it with FFprobe. Use a 30 fps project timeline by default, recording the source rate separately.
- The original source is immutable. Create a new artifact for edits and update `state/project.json` for destructive-looking operations. Keep job media, generated state, previews, and logs in that job directory.
- If a required integration or dependency is missing, follow [Environment preflight](agent-setup.md#environment-preflight). Installation, global Agent configuration changes, and OAuth require user approval; client-specific ChatCut instructions are in that guide.

## Transcript and alignment

- Use ChatCut for transcription and timing; do not substitute local ASR. Local silence analysis may support a targeted seam review but does not provide transcript or speech authority.
- Preserve a supplied reference script unchanged under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. The recording determines what was spoken; reconcile omissions and additions before release. ChatCut transcription and timing are provisional audio-derived evidence for the rough cut.
- In a reference script, `【】` contains medium-strength visual notes scoped to the immediately preceding semantic clause unless the note specifies another range. Keep notes separate from speech; only reconciled `speechText` can enter released wording. Ordinary `[]` is spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.
- Store transcript timings in `state/transcript.json` and reconciliation evidence in `state/transcript-reconciliation.json`. ChatCut transcription and timing guide the rough cut; the user's complete playback and explicit decision happen at the existing `rough-cut-review`. On the transcription transition, snapshot source-timeline word timings to immutable `state/source-transcript.json`; preserve its hash across rough-cut revisions.

## Rough cut

When `revise` or `reopen rough-cut` returns the job here, reread this section and the linked standard from the top. Reassess the revised timeline; do not rely on memory of the prior pass.

- ChatCut owns the editable talking-head timeline. Use the [Talking-Head Trim Standard](talking-head-trim-standard.md) as the sole detailed policy for semantic editing, candidate cleanup, speech coverage, and clip-edge closure. Keep valid recorded speech or record its editorial disposition.
- Before cleanup, save the current ChatCut mapping to `state/timeline-source-windows.json`, run the standard's silence scan, then `node scripts/classify-gaps.mjs <job-directory> --write`. It saves the starting structure once and combines ASR gaps with retained dB candidates. In `state/gap-candidates.json`, set `classification` and a short `reasonCode` or `reason`, then apply removals in ChatCut. Preserve ambiguous sound for the user's full rough-cut review; no item-by-item listening is required.
- Refresh the mapping and candidate record after editing. Run the clip-edge calculator on the cleaned timeline and apply its frame plan, then refresh those records for the final structure. Reuse the source waveform index. Record project/timeline IDs and measured timings in `state/chatcut-roughcut.json`; targeted seam lookup is for a reported problem.
- Follow the standard's numbered sequence. If an operation cannot be completed, report it as skipped or blocked instead of saying it ran.
- If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative FFmpeg fallback. `state/trim-plan.json` and its legacy audit apply only to that explicit fallback.

## Rough-cut review and export

- `rough-cut-review` is the only approval gate and the user's normal full playback in ChatCut. Do not ask for a separate item-by-item listening pass. Record the user's explicit approve, revise, or `fallback-auto` decision in `review`; in `auto`, record `automatic-fallback` only when the user selected that mode. Do not infer a decision from silence.
- After the decision, disable ChatCut caption rendering and export clean A-roll. Promote it once with `scripts/promote-job-media.mjs` to `roughcut/a-roll.mp4` and run the basic media lock before advancing. Record the disabled-caption export setting in `planning-inputs.json` as `cleanExport.captionRenderDisabled`; keep the last known-good rough cut available.
- For an export with excess trailing audio, run `scripts/align-export.sh <exported.mp4>`. Its stdout is the usable media path: the original when already aligned, otherwise the verified stream-copy output. Promote that path.

## Motion plan

- Author content decisions in `state/planning-inputs.json` using the [input example](../templates/planning-inputs.README.md), then run `node scripts/generate-plan.mjs <job-directory> --write`. It derives the released transcript, captions, source mapping, reconciliation, Beat Map and readable plans as one batch. Existing decisions/conflicts are preserved; edited generated files are protected. Use `--replace-existing` only when deliberately replacing/importing existing outputs after preserving their decisions in the inputs; the command backs them up.
- Choose MG from the [motion template catalog](../templates/motion-graphics/README.md). Record template ID (or `custom` with a reason), Beat ID, copy, assets, layout and spoken anchors in that input. Metadata and repeated document fields are derived, not re-authored per job.
- Create `state/beat-map.json` before animation code. Every spoken sentence must be represented; split long sentences into meaningful phrases. For each beat, record its exact interval, source transcript IDs, intent/emphasis, axis, coverage, timing, and layout/safety notes.
- For motion-approved beats, record one primary recipe, flow axis and visual reference, semantic topology, word-level entry and exit anchors, motion and transition families, micro-event timing/roles, supporting components, and entrance/hold/exit timing. Subtitle-only beats use `mgScope: "none"` with empty motion fields; `motion-copy` covers all speech. The fields a beat shares with its MG component are derived from that component's metadata (see [`subtitle-mg-standard.md`](subtitle-mg-standard.md#component-library)) — write them only when the beat deliberately differs.
- The three Global-direction lines that describe the design system (caption mode, typography, palette) are rendered from `state/design-system.json`, not authored; writing them into `planning-inputs.json` is an error. Which axes the film uses, and how it ends, remain authored.
- Start from `assets/design-system.default.json`; change it only for a user request or supplied brand. For `subtitles`, prepare captions from reconciled speech and reserve MG for supplemental meaning. For `motion-copy`, place all spoken wording in the designed motion. Choose A-axis overlay or B-axis stage from the phrase's meaning and record the recommendation and reason with the rough-cut decision; record the resolved choice in workflow and creative-confirmation state.
- If the reference script has visual notes, bind each to the locked recording timeline and record it as `adopted`, `adjusted`, or `rejected`, with local scope and relevant beat IDs. Plan unannotated passages normally.
- The creative-confirmation package records settled wording, captions, MG, style, timing, axis, and intentional no-MG choices. It is the baseline for production, not a new approval gate.

## Composition

- Run `node scripts/assemble-mg.mjs <job-directory> --write` to instantiate the selected templates with their planned copy/assets/timing. Use `--beat <id>` for a targeted update; manually edited modules are protected. Custom MG remains available for content that needs a different structure.
- Author captions, MG, axis composition, and timing in HyperFrames. Follow the linked composition contract and applicable visual-language and layout guides. Build `hyperframes/index.html` from its sources with `scripts/build-composition.mjs`; the render entrypoint rebuilds from the same source before rendering.
- State transitions check consumed dependencies. In `review`, a scoped visual revision updates the Beat Map and module, rebuilds, and refreshes those bindings without rewriting earlier plan documents. `auto` retains its plan-authority checks. Use explicit `verify` for a full fingerprint audit, not on every step.

## Delivery

- Use the job package's `npm run render` or `npm run render:revision` entrypoint for the normal one-render delivery path. Follow [`quality-gates.md`](quality-gates.md) for the selected mode's checks.
- Review the rendered MP4 as the user's editorial handoff; that review is not another workflow state or gate. Claim automatic-validation completion only when `auto` was explicitly selected and its listed checks passed.

## Revisions

For a completed job, reopen the earliest affected state with `scripts/workflow-state.mjs`; use [`revision-standard.md`](revision-standard.md) to scope and document the revision. Keep the settled motion plan and creative-confirmation package as the baseline for local composition edits; use motion planning for global creative changes.
