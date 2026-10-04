# Workflow Architecture

Use this document as a just-in-time phase router. At the start or resume of a job, read `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then read only the matching route and phase section below. Load later-stage guidance when the job reaches that state. The state machine records transitions; it does not load Agent instructions.

## Delivery time targets

Budget the workflow as three consecutive stages: rough cut and project handoff within 30 minutes of receiving the source; aim to deliver the three plans in about 10 minutes and within 15 minutes after explicit rough-cut approval; final composition and export within a further 15 minutes. The total target is 60 minutes, excluding time waiting for the user's review or reply. These are execution targets, not workflow gates. Start the clean A-roll export in the background during plan preparation so its runtime does not delay plan delivery. If a phase stalls, report the current stage, impact and next step, then continue useful work without extended probing.

## Active-state route

| `currentState` | Read for this state |
| --- | --- |
| `intake` | [Intake](#intake) |
| `transcription` | [Transcript and alignment](#transcript-and-alignment) |
| `rough-cut` | [Rough cut](#rough-cut) and [Talking-head trim standard](talking-head-trim-standard.md) |
| `rough-cut-review` | [Rough-cut review, export, and plans](#rough-cut-review-export-and-plans) |
| `rough-cut-export` | [Rough-cut review, export, and plans](#rough-cut-review-export-and-plans) |
| `motion-plan` | [Motion plan](#motion-plan); consult custom-design guidance only for a custom MG |
| `composition` | [Composition](#composition); templates already implement the shared animation contract. Custom modules use [the composition contract](technology.md#hyperframes-composition-contract) |
| `render` | [Delivery](#delivery) |
| `complete` | Read [Editorial revisions](revision-standard.md) only when making a revision |

The phase steps below contain routine commands and checks. Read [`state-machine.md`](state-machine.md) only for recovery, mode changes, or revision routing.

## Intake

- Require a local talking-head recording. If it is missing, request its path and stop. Honor any supplied caption, reference-script, and visual-axis preferences; otherwise use the job defaults without a separate question round.
- Use `scripts/scaffold-project.sh`, put the source in the job's `input/`, and probe it with FFprobe. Use a 30 fps project timeline by default, recording the source rate separately. The once-per-job ChatCut and local dependency preflight is specified in `AGENTS.md`.
- The original source is immutable. Create a new artifact for edits and update `state/project.json` for destructive-looking operations. Keep job media, generated state, previews, and logs in that job directory.
- If a required integration or dependency is missing, follow [Environment preflight](agent-setup.md#environment-preflight). Install pinned HyperFrames/GSAP into the shared repository cache without asking; global/system dependency installs, global Agent configuration changes, and OAuth require user approval. Client-specific ChatCut instructions are in that guide.
- Once ChatCut Script is available, continue with [Rough cut](#rough-cut). Use `review-cut` for the handoff; local transcription artifacts need not be created merely to advance through the intermediate state labels.

## Transcript and alignment

- Use ChatCut for transcription and timing; do not substitute local ASR. Local silence analysis may support a targeted seam review but does not provide transcript or speech authority.
- Preserve a supplied reference script unchanged under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. The recording determines what was spoken; reconcile omissions and additions before release. ChatCut transcription and timing are provisional audio-derived evidence for the rough cut.
- In a reference script, `【】` contains medium-strength visual notes scoped to the immediately preceding semantic clause unless the note specifies another range. Keep notes separate from speech; only reconciled `speechText` can enter released wording. Ordinary `[]` is spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.
- Edit from ChatCut's transcription and timing directly. Local transcript conversion and reconciliation are deferred until after rough-cut approval. If `state/transcript.json` already exists, the normal transcription transition locks it without requiring reconciliation. Preserve any established source-transcript lock.

## Rough cut

- Follow the [Talking-Head Trim Standard](talking-head-trim-standard.md): one semantic edit, one internal-pause cleanup, one edge tightening, then deliver. `prepare-rough-cut.mjs ... tighten` handles index creation, mapping conversion and calculation from saved ChatCut responses.
- Use `node scripts/workflow-state.mjs <job>/state/workflow.json review-cut --project-id <id> --timeline-id <id>` to record and present the cut. No reconciliation, candidate audit or Caption Plan is needed before listening. Existing usable cuts can go straight to review; revisions address the user's reported passages.
- Give the project link and duration immediately after the editing batch is confirmed. Report skipped/blocked operations honestly; further diagnosis follows user feedback.
- If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative FFmpeg fallback. `state/trim-plan.json` and its legacy audit apply only to that explicit fallback.

## Rough-cut review, export, and plans

- `rough-cut-review` is the user's normal full playback in ChatCut. Do not ask for a separate item-by-item listening pass. Record the user's explicit approve, revise, or `fallback-auto` decision in `review`; in `auto`, record `automatic-fallback` only when the user selected that mode. Do not infer a decision from silence.
- Record an explicit decision with `node scripts/workflow-state.mjs <job>/state/workflow.json approve`, `revise --note "..."`, or the user-selected `fallback-auto --actor user --note "..."`.
- While the user reviews the stable cut, prepare MG content/template choices and real wording exceptions in `state/planning-inputs.json`; after approval, bind `sourceSegmentIds` and entry/exit anchors to generated `main-001`, `main-002`, etc. in the approved preview's entry order. These are generated transcript IDs, not ChatCut item IDs or Script row numbers.
- After explicit approval, start or resume one clean A-roll export immediately. Reuse `roughcut/a-roll.mp4`, a known completed render, or a running export; if its ID is unavailable, check the local output and call `track_export` with `latest=false`. Save the active `renderId`, project ID and timeline ID in `<job>/state/roughcut-export.json`; submit a new export only when no usable output or running task exists.
- In parallel, call ChatCut `preview_timeline({views:["transcript"]})` once on the approved active timeline. Save each page's `structuredContent`, in order, as an element of the JSON array in `<job>/state/chatcut-main-timeline.json`; when a response contains `nextOffset`, request the next page with `offset: nextOffset`, the returned `state.id`, and the same range and filters, then append it. Use each entry's text and frame range with the returned FPS as the source for plan wording and timing. Coverage counts transcript-bearing timeline items, not Script rows. In `state/planning-inputs.json`, author `captionCues` with `segmentId`, `text`, `start` and `end` in seconds; use natural phrase boundaries and keep each time range inside its parent main-timeline entry. Then run `node scripts/generate-plan.mjs <job> --write` once to generate Caption Plan, Motion Plan and Creative Confirmation together, and deliver them while export runs; plans do not wait for export or HyperFrames setup. If generation reports an input error, correct that job's `planning-inputs.json` and rerun; do not dry-run first or regenerate for explanatory prose edits.
- In `review`, deliver all three plans together and wait for one user approval before composition; keep the job at `motion-plan` while waiting. Explicitly selected `auto` continues after plan generation. When export finishes, promote it before locking or advancing: `node scripts/promote-job-media.mjs <job> roughcut <source-media>`. Stream end-duration differences alone do not mean A/V desynchronization and do not require trimming; the media check compares stream start offsets.

## Motion plan

- The three plans are created during `rough-cut-export`. At `motion-plan`, reuse and deliver them as one review package. In `review`, wait for the user's approval before running `compose-job.mjs`; in `auto`, continue only if the user explicitly selected Auto. Regenerate only when the transcript or an intentional plan decision changes.
- For discrete MG nodes, use the [MG cadence target](density-and-layout.md#mg-cadence-target) to estimate the count from the finished runtime and distribute nodes across meaningful sections.
- Default A-roll MG to the upper-middle area: content templates start at 280px on the 1080×1920 canvas. Keep the overall MG and background card horizontally centered; internal rows may align left or right. Adjust height and width to avoid captions; eyes and mouth do not need clearance; move tall lists upward with compact rows inside a centered card rather than shifting the whole card to a corner. Template sample counts and directions must fit the spoken items and causal relationship; adapt or use a custom module rather than merging items to fill fixed slots.
- Place each MG from its relevant main-timeline entry range. The generated `:word-001` anchor represents the whole entry. For multi-element MGs, bind internal reveals to actual keyword timestamps using [existing ChatCut word timing](mg-speech-timing.md); collect only the needed phrases during composition preparation, without delaying routine plan delivery or adding a transcription call by default.
- Reuse the saved caption mode, visual axis and design system. Select existing MG templates; caption-only beats need no MG rationale. The Creative Confirmation is part of the three-plan package; ask for one package decision, not separate approvals for each document.

## Composition

- On the first composition, refresh source windows from the final approved clip snapshot with `prepare-rough-cut.mjs <job> windows <snapshot>`, then resolve multi-element `templateData.revealCues` from existing keyword timestamps as described in [MG speech timing](mg-speech-timing.md). Reuse the snapshot confirming the last editing batch; refresh it only after further edits. Each spoken item enters on its own onset; only context/decorations use explicit relative delays. Let speech determine the intervals, keep the resolved state readable, and design the exit. This preparation stays inside composition and adds no approval, review round or workflow state.
- When composition begins, check the job-linked pinned CLI with `test -x <job>/hyperframes/node_modules/.bin/hyperframes`. If it is missing, run `./scripts/check-environment.sh install-job <job-directory>`; it checks the repository cache first and installs the pinned packages there if needed. Do not ask for approval for this project-local setup. Plan delivery does not wait for runtime setup.
- Run `node scripts/compose-job.mjs <job-directory>` after plan approval in `review`, or after plan generation in explicitly selected `auto`. It advances planning, assembles MG, checks and installs captions, then builds and advances composition. No manual status edit, build or standalone checker run is needed.
- For a local update, use `assemble-mg.mjs --beat <id>` or edit the affected custom module, then advance composition normally. The builder preserves authored files; the render entrypoint rebuilds before rendering.
- Caption transcript/timing checks and a successful composition build remain required because they affect the rendered file. Fingerprint audits are optional diagnostics via `verify`; they do not block routine composition or delivery.

## Delivery

- Use the job package's `npm run render` or `npm run render:revision` entrypoint for the normal one-render delivery path. The final MP4 must be readable, contain audio and video, and have a positive duration with aligned stream starts.
- On successful render, run `node scripts/workflow-state.mjs <job>/state/workflow.json advance --artifact output/final.mp4` (use `output/final.candidate.mp4` for a revision), then give the output path to the user. The renderer and transition already probe media; do not add another full audit or preview cycle without a specific failure or request.
- Review the rendered MP4 as the user's editorial handoff; that review is not another workflow state or gate. Claim automatic-validation completion only when `auto` was explicitly selected and its listed checks passed.

## Revisions

For a completed job, reopen the earliest affected state with `scripts/workflow-state.mjs`; use [`revision-standard.md`](revision-standard.md) to scope and document the revision. Keep the settled motion plan and creative-confirmation package as the baseline for local composition edits; use motion planning for global creative changes.
