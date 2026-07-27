# Workflow Architecture

Each invocation owns one isolated `jobs/<job-id>/` directory. Generated media, state, previews, checkpoints, and logs never share mutable paths with another job.

## Stage contracts

| State | Reads | Writes or decision |
| --- | --- | --- | --- |
| `intake` | source video, optional preferences | media probe and recorded or deferred preferences |
| `transcription` | source audio, optional reference script | timestamped transcript and reconciliation evidence |
| `rough-cut` | source, transcript | semantically selected ChatCut timeline, audited precision trim, and locked A-roll |
| `rough-cut-review` | A-roll and deferred recommendations | edit lock plus one-step preference acceptance, or revision |
| `motion-plan` | approved wording, aligned word timestamps, design tokens, raw ChatCut timing evidence | beat map, motion plan, creative package, and a semantic caption plan only for `subtitles` |
| `motion-plan-review` | creative confirmation package | conditional user approval or recorded skip |
| `visual-sample` | approved plan, recipes | conditional 3–5 second selected-MG or approved-axis preview |
| `visual-sample-review` | visual sample | conditional user approval or recorded skip |
| `composition` | A-roll, approved plan | deterministic HyperFrames project |
| `qa` | composition, audio | QA report and final preview |
| `final-preview` | final preview | user approval or revision request |
| `render` | approved composition | final MP4 |
| `complete` | final MP4 and state | completed record that may be reopened for a scoped revision |

## Why the stages are separate

Structural editing changes every later timestamp. ChatCut selection, precision trimming, seam audit, and final A-roll export therefore complete before one locked-edit review. If another cut is made later, the Agent must migrate the transcript and every later animation cue by the removed duration.

Material understanding remains inside transcription and edit lock. At ambiguous cuts, take choices, supporting-media decisions, or axis recommendations, the Agent may generate a small filmstrip-plus-waveform view under `checkpoints/diagnostics/`; routine passages are not scanned and no extra user gate is added.

`final-preview` is intentionally not the delivery file. `npm run render:preview` uses HyperFrames `standard` quality so the user can approve picture, timing, copy, and audio; after approval, `npm run render` uses `high` quality for the editorially identical `output/final.mp4`. Resolution, frame rate, timeline and audio remain unchanged, and the state machine verifies the media match. The Agent must explain this handoff both when presenting the preview and when delivering the final file.

## Caption-mode route

| Boundary | User interaction | Durable state | Result |
| --- | --- | --- | --- |
| Intake | Agent asks once for optional caption, script, and axis preferences | Supplied choices are recorded; omitted choices remain deferred | Resolved source media is the only blocker. |
| Locked-edit review | Agent presents the rough cut with reasoned recommendations for deferred choices | Approval locks the media and accepts the stated choices | No separate preference gate is added. |
| Creative confirmation | Shown for MG, `motion-copy`, B-axis or hybrid treatment, release-impact ambiguity, or explicit request | One package fingerprints every authoritative plan | Required approval or recorded conditional skip authorizes that exact package. |
| Visual sample | Shown for first or changed motion language, or an explicit caption-layout precheck | Source HTML and rendered video are independently fingerprinted | Caption-only or unchanged approved visual language proceeds directly to composition. |
| Late change | User switches mode before composition | State machine returns to `motion-plan` | Storyboard, density, and sample are rebuilt only when they actually depend on the mode. |
| Composition | No second mode prompt | `captionMode` selects validators and composition behavior | The shared edit and QA pipeline remains unchanged. |

## Visual-axis route

| Mode | Meaning | Default and confirmation |
| --- | --- | --- |
| A-axis overlay | Talking head stays full-frame; localized MG overlays it. | Default for `subtitles`. State it in creative confirmation; no extra prompt is needed when every beat remains A-axis. |
| B-axis stage | MG owns the full frame; the speaker may remain in a protected live PiP. | Requires explicit user approval in every caption mode. |
| Hybrid | The storyboard uses both modes at named semantic passages. | Present the exact B-axis passages and ask the user to choose before motion-plan approval. |

These are visual-axis modes, not A-roll/B-roll. A-roll is the primary recorded footage; B-roll is supporting recorded footage.

For A-axis composition, portrait video anchors MG in the upper-middle region and may expand downward without defaulting to the exact frame center. Landscape video prefers the upper-left or upper-right region, selected around the face and protected evidence.

There is one state machine, not two parallel workflows. Both modes share ChatCut rough cut, precision trim inside edit lock, protected-region review, layout checks, and delivery QA. They diverge only after the edit lock:

| Mode | Speech layer | Default production scope | MG rule |
| --- | --- | --- | --- |
| `subtitles` | Recording-backed semantic cue plan rendered by HyperFrames; ChatCut pages remain timing evidence | A caption-only result is publishable; a separate sample is optional | Optional local MG must close a documented cognition gap under `docs/subtitle-mg-standard.md`; never global or over a protected region. |
| `motion-copy` | Designed motion typography | Full motion-design composition | Motion carries speech; no separate caption layer. |

## Agent state

The Agent should be able to resume from the last completed state file. It must not infer that a stage completed merely because an output filename exists; the matching state record and validation result are required.

Completed jobs remain editable. `reopen rough-cut|motion-plan|composition|delivery` returns the same job to the earliest affected stage, supersedes only dependent approvals, and preserves history plus the last known-good delivery until its replacement passes validation.

Canonical large media uses fixed paths and atomic replacement. `scripts/promote-job-media.mjs` validates an explicitly named source, rejects immutable input and escaped directories, and never scans user download folders. Delivery revisions render to `output/final.candidate.mp4`; the state machine promotes that file only after final validation. A job retains one current rough cut, one current preview of each kind, one current final, and the immutable source.

## Review versus automatic mode

Both modes execute the same pipeline. `review` always waits at locked-edit and final-preview review, plus only the conditional gates triggered by the plan. `auto` may accept recorded Agent recommendations but still validates every artifact.

In `review`, implementation permission is scoped to the approved package. Caption segmentation, MG node selection or count, on-screen copy, support role, visual style, and axis mode are plan fields. Changing any of them requires `replan` and a regenerated package; user reapproval occurs only when the new package still triggers creative review. Small parameter corrections that preserve those fields may return directly to the producing stage.

Caption mode is orthogonal: `motion-copy` puts reconciled speech into designed motion; `subtitles` renders the approved semantic cue plan while the beat map carries supplemental information. The creative confirmation package is the single approval surface for wording, segmentation and MG.
