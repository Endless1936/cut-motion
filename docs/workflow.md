# Workflow Architecture

Use this document as a just-in-time phase router. At the start or resume of a job, read `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then read only the matching route and phase section below. Load later-stage guidance when the job reaches that state. The state machine records transitions; it does not load Agent instructions.

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
- If a required integration or dependency is missing, follow [Environment preflight](agent-setup.md#environment-preflight). Installation, global Agent configuration changes, and OAuth require user approval; client-specific ChatCut instructions are in that guide.
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

- `rough-cut-review` is the only approval gate and the user's normal full playback in ChatCut. Do not ask for a separate item-by-item listening pass. Record the user's explicit approve, revise, or `fallback-auto` decision in `review`; in `auto`, record `automatic-fallback` only when the user selected that mode. Do not infer a decision from silence.
- Record an explicit decision with `node scripts/workflow-state.mjs <job>/state/workflow.json approve`, `revise --note "..."`, or the user-selected `fallback-auto --actor user --note "..."`.
- Once the cut and time mapping are stable and the ChatCut link is sent for review, prepare only key MG beats, templates, anchors and real wording exceptions in `state/planning-inputs.json`. Use generated caption segmentation; do not run `--outline`, hand-split every caption, or request plan approval.
- After explicit approval, retrieve missing source words once, start clean A-roll export asynchronously, and run `node scripts/generate-plan.mjs <job> --write` once while it runs. Record ChatCut caption-rendering status only when known; an unknown or enabled value warns about possible duplicate captions but does not block plans or delivery. Deliver the three plans as soon as generation finishes. Composition waits for approval and the A-roll media lock.
- Composition must wait for explicit `rough-cut-review` approval and the A-roll media lock. When export finishes, promote it to `roughcut/a-roll.mp4` and run the existing lock. If it has excess trailing audio, use `scripts/align-export.sh <exported.mp4>` before promotion.

## Motion plan

- The three plans are created during `rough-cut-export`. At `motion-plan`, reuse them and continue to composition; regenerate only when the transcript or an intentional plan decision changes. If missing, follow the plan-creation steps above.
- Reuse the saved caption mode, visual axis and design system. Select existing MG templates; caption-only beats need no MG rationale. The Creative Confirmation is the production baseline, not another approval gate.

## Composition

- Run `node scripts/compose-job.mjs <job-directory>` after plan generation. It advances planning, assembles MG, checks and installs captions, then builds and advances composition. No separate approval, manual status edit, build or standalone checker run is needed.
- For a local update, use `assemble-mg.mjs --beat <id>` or edit the affected custom module, then advance composition normally. The builder preserves authored files; the render entrypoint rebuilds before rendering.
- Caption transcript/timing checks and a successful composition build remain required because they affect the rendered file. Fingerprint audits are optional diagnostics via `verify`; they do not block routine composition or delivery.

## Delivery

- Use the job package's `npm run render` or `npm run render:revision` entrypoint for the normal one-render delivery path. The final MP4 must be readable, contain audio and video, and have a positive, synchronized duration.
- On successful render, run `node scripts/workflow-state.mjs <job>/state/workflow.json advance --artifact output/final.mp4` (use `output/final.candidate.mp4` for a revision), then give the output path to the user. The renderer and transition already probe media; do not add another full audit or preview cycle without a specific failure or request.
- Review the rendered MP4 as the user's editorial handoff; that review is not another workflow state or gate. Claim automatic-validation completion only when `auto` was explicitly selected and its listed checks passed.

## Revisions

For a completed job, reopen the earliest affected state with `scripts/workflow-state.mjs`; use [`revision-standard.md`](revision-standard.md) to scope and document the revision. Keep the settled motion plan and creative-confirmation package as the baseline for local composition edits; use motion planning for global creative changes.
