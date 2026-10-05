# Workflow Architecture

Use this document as a just-in-time phase router. At the start or resume of a job, read `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then read only the matching route and phase section below. Load later-stage guidance when the job reaches that state. The state machine records transitions; it does not load Agent instructions.

## Delivery time targets

For an ordinary two-minute finished video, target rough-cut handoff within 6 minutes, delivery of the combined three plans within 4 minutes, and composition/export within 8 minutes: total execution within 18 minutes. Exclude only time waiting for the user's review or reply; preparation, tool runtime and recovery count inside the phase budgets. This is an execution preference, not a gate or a proven benchmark. Start the clean A-roll export during plan preparation. If a phase stalls, report its impact and next step, then continue useful independent work.

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
- If a required integration or dependency is missing, follow [Environment preflight](agent-setup.md#environment-preflight). Reuse or install pinned HyperFrames/GSAP in the repository's ignored `node_modules/` without asking; global/system dependency installs, global Agent configuration changes, and OAuth require user approval. Client-specific ChatCut instructions are in that guide.
- Once ChatCut Script is available, continue with [Rough cut](#rough-cut). Use `review-cut` for the handoff; local transcription artifacts need not be created merely to advance through the intermediate state labels.

## Transcript and alignment

- Use ChatCut for transcription and timing; do not substitute local ASR. Local silence analysis may support a targeted seam review but does not provide transcript or speech authority.
- Preserve a supplied reference script unchanged under `input/reference-scripts/` and record its SHA-256 in `state/workflow.json` and `state/reference-script-annotations.json`. The recording determines what was spoken; reconcile omissions and additions before release. ChatCut transcription and timing are provisional audio-derived evidence for the rough cut.
- In a reference script, `【】` contains medium-strength visual notes scoped to the immediately preceding semantic clause unless the note specifies another range. Keep notes separate from speech; only reconciled `speechText` can enter released wording. Ordinary `[]` is spoken text. Reject empty, nested, unclosed, or unmatched `【】` during intake.
- Edit from ChatCut's transcription and timing directly. Local transcript conversion and reconciliation are deferred until after rough-cut approval. If `state/transcript.json` already exists, the normal transcription transition locks it without requiring reconciliation. Preserve any established source-transcript lock.

## Rough cut

- Follow the [Talking-Head Trim Standard](talking-head-trim-standard.md): one semantic edit, one internal-pause cleanup, one edge tightening, then deliver. `prepare-rough-cut.mjs ... tighten` handles index creation, mapping and calculation from saved ChatCut responses. Submit its saved `editItemArgs` directly as one batch; preserve frame counts instead of converting microsecond ranges back into durations.
- Use `node scripts/workflow-state.mjs <job>/state/workflow.json review-cut --project-id <id> --timeline-id <id>` to record and present the cut. No reconciliation, candidate audit or Caption Plan is needed before listening. Existing usable cuts can go straight to review; revisions address the user's reported passages.
- Give the project link and duration immediately after the editing batch is confirmed. Report skipped/blocked operations honestly; further diagnosis follows user feedback.
- If ChatCut is unavailable, record `roughCutEngine: "ffmpeg-fallback"` and use the conservative FFmpeg fallback. `state/trim-plan.json` and its legacy audit apply only to that explicit fallback.

## Rough-cut review, export, and plans

- `rough-cut-review` is the user's normal full playback in ChatCut. Do not ask for a separate item-by-item listening pass. Record the user's explicit approve, revise, or `fallback-auto` decision in `review`; in `auto`, record `automatic-fallback` only when the user selected that mode. Do not infer a decision from silence.
- Record an explicit decision with `node scripts/workflow-state.mjs <job>/state/workflow.json approve`, `revise --note "..."`, or the user-selected `fallback-auto --actor user --note "..."`.
- While the user reviews the stable cut, prepare MG content/template choices and real wording exceptions in `state/planning-inputs.json`; after approval, bind `sourceSegmentIds` and entry/exit anchors to generated `main-001`, `main-002`, etc. in the approved preview's entry order. These are generated transcript IDs, not ChatCut item IDs or Script row numbers.
- After explicit approval, start or resume one clean A-roll export immediately. Reuse only media or exports belonging to this job's project and approved timeline; if the render ID is unavailable, check the job's local output and call `track_export` with `latest=false`. Include the job ID in a new export's filename. Save the returned `renderId`, project ID, timeline ID and filename in `<job>/state/roughcut-export.json`; submit a new export only when no usable output or running task exists.
- On completion, identify this render's actual download by its returned filename (allowing a browser collision suffix) and match `outputSizeBytes` when reported. An incomplete download or a similarly named older file is not usable. If the file is missing, check the current download once and use the integration's supported download recovery; re-export only when the completed output cannot be recovered. Record the confirmed local path, then run `node scripts/promote-job-media.mjs <job> roughcut <source-media>` before `node scripts/workflow-state.mjs <job>/state/workflow.json advance --artifact roughcut/a-roll.mp4`. Do not advance with an unconfirmed file or repair a media lock by editing workflow JSON directly.
- In parallel, call ChatCut `preview_timeline({views:["transcript"]})` once on the approved active timeline. Save the complete returned pages, in order, in `<job>/state/chatcut-main-timeline.json`; follow `nextOffset` with the same timeline, range and filters. The helpers unwrap structured or text JSON. Entry text and frame ranges are the plan authority; coverage counts transcript-bearing items, not Script rows. Author wording and design once in `state/planning-inputs.json`: use `corrections` for confirmed terminology and `captionEdits` short phrase arrays only for entries needing splits. The generator derives cue times; explicit timed cues remain available for intentional boundary changes. Use shared reconciliation defaults and author only actual exceptions. If a CaptionProgram already exists, reuse saved cards/tokens or call `read_captions({json:JSON.stringify({words:true,limit:100})})` on this project's approved timeline, retaining revision and filters for continuation pages. Set `captionTimingPath` to reuse that data; do not create ChatCut captions to obtain timing. See [Subtitle segmentation](subtitle-segmentation-standard.md). Run `node scripts/generate-plan.mjs <job> --write` once to derive all three plans and corrected wording together, then deliver while export runs. Correct an input error in that one input and rerun; no dry-run, manual derived-file synchronization or regeneration for explanatory prose edits is needed.
- In `review`, deliver all three plans together as soon as they are generated and wait for one package approval before composition. While export or download recovery is pending, keep the job at `rough-cut-export`; after confirmed media is promoted and locked, advance to `motion-plan`. A package approval received before media readiness remains valid; do not regenerate, redeliver or request approval again merely because the export finishes. Composition requires both package approval and the A-roll media lock. Explicitly selected `auto` skips the package wait but still requires that lock. Stream end-duration differences alone do not mean A/V desynchronization and do not require trimming; the media check compares stream start offsets.

## Motion plan

- The three plans are generated and delivered during `rough-cut-export`. At `motion-plan`, reuse that package and any explicit approval already received. In `review`, wait for approval if it is still pending before running `compose-job.mjs`; in `auto`, continue only if the user explicitly selected Auto. Regenerate only when the transcript or an intentional plan decision changes.
- For discrete MG nodes, use the [MG cadence target](density-and-layout.md#mg-cadence-target) to select meaningful processes, relationships, contrasts and results; ordinary speech stays caption-only. Choose the semantic relationship before styling: inputs followed by a named result use `converge-sources`, not a parallel card exposing the result in its initial heading.
- Default A-roll MG to the upper-middle area: content templates start at 280px on the 1080×1920 canvas. Keep the overall MG and background card horizontally centered; internal rows may align left or right. Adjust height and width to avoid captions; eyes and mouth do not need clearance; move tall lists upward with compact rows inside a centered card rather than shifting the whole card to a corner. Template sample counts and directions must fit the spoken items and causal relationship; adapt or use a custom module rather than merging items to fill fixed slots.
- Place each MG from its relevant main-timeline entry range. The generated `:word-001` anchor represents the whole entry. For multi-element MGs, bind internal reveals to actual keyword timestamps using [existing ChatCut word timing](mg-speech-timing.md); collect only the needed phrases during composition preparation, without delaying routine plan delivery or adding a transcription call by default.
- Reuse the saved caption mode, visual axis and design system. Select existing MG templates; caption-only beats need no MG rationale. The Creative Confirmation is part of the three-plan package; ask for one package decision, not separate approvals for each document.

## Composition

- Resolve multi-element `templateData.revealCues` using [existing ChatCut timing](mg-speech-timing.md). Saved measured caption tokens already use timeline frames and need no source-window conversion. Otherwise query only the MG keywords, reuse the snapshot confirming the approved edit, and run `prepare-rough-cut.mjs <job> windows <snapshot>` for source-to-timeline mapping. Refresh a snapshot only after further edits. Each spoken item, including a result or tool name in a heading, enters on its own onset; neutral headings/decorations may use relative delays. Keep the resolved state readable and design the exit. This stays inside composition without an extra approval or state.
- When composition begins, check the job-linked pinned CLI with `test -x <job>/hyperframes/node_modules/.bin/hyperframes`. If missing, run `./scripts/check-environment.sh install-job <job-directory>`; it reuses the root `node_modules/` first. This project-local setup needs no approval and does not delay plan delivery.
- Run `node scripts/compose-job.mjs <job-directory>` after plan approval in `review`, or after plan generation in explicitly selected `auto`. It advances planning, assembles MG, installs captions and builds composition, then prints the ready batch snapshot and render commands. Follow that summary; no manual status edit, build, source-code inspection or standalone checker run is needed.
- For a local update, use `assemble-mg.mjs --beat <id>` or edit the affected custom module, then advance composition normally. The builder preserves authored files; the render entrypoint rebuilds before rendering.
- Caption transcript/timing checks and a successful composition build remain required because they affect the rendered file. Fingerprint audits are optional diagnostics via `verify`; they do not block routine composition or delivery.

## Delivery

- Before encoding the full video, perform [MG final-state self-review](#mg-final-state-self-review) on the built HTML.
- Use the job package's `npm run render` or `npm run render:revision` entrypoint for the normal one-render delivery path. The final MP4 must be readable, contain audio and video, and have a positive duration with aligned stream starts.
- Both initial deliveries and revisions write directly to `output/final.mp4`. On successful render, run `node scripts/workflow-state.mjs <job>/state/workflow.json advance --artifact output/final.mp4`, then give that actual output path to the user. The renderer and transition already probe media; no additional full audit or post-export preview cycle is needed for routine delivery.
- Review the rendered MP4 as the user's editorial handoff; that review is not another workflow state or gate. Claim automatic-validation completion only when `auto` was explicitly selected and its listed checks passed.

### MG final-state self-review

After HTML assembly, choose one timestamp per MG after its last content reveal finishes and before its exit starts, using the authored timeline and delivery frame grid. The target is the complete expanded state, not the last frame of the MG interval. Capture all requested times in one batch from the job's `hyperframes/` directory:

```bash
./node_modules/.bin/hyperframes snapshot --at <t1,t2,...> --no-end --describe false --output ../previews/mg-final-state
```

The Agent must open the images and inspect complete phrases, one-character orphan lines, overflow, layout spacing, horizontal centering and caption clearance. Fit the actual copy by adjusting card width, column/node space or arrangement before shrinking text. Template reuse does not replace this inspection.

Review every MG on the first delivery; after a local revision, review only affected MGs. Fix issues and recapture those final states before full export. Routine review covers only the complete state; inspect entrance, intermediate or exit motion only for a reported animation issue. If HTML snapshots cannot show a specific MG correctly, use a short 2–3 second affected-window preview to inspect that same complete state.

This is an Agent visual task, not an automated pass/fail validator. It adds no code-level blocking checks, review receipts, workflow state or user approval. Other standalone validators and full-video audits remain optional diagnostics.

## Revisions

For a completed job, reopen the earliest affected state with `scripts/workflow-state.mjs`; use [`revision-standard.md`](revision-standard.md) to scope and document the revision. Keep the settled motion plan and creative-confirmation package as the baseline for local composition edits; use motion planning for global creative changes.
