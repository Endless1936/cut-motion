# Workflow Architecture


## Stage contracts

| State | Contract |
| --- | --- |
| `intake` | Validate source media and record deferred preferences. |
| `transcription` | Reconcile the recording with the optional reference script and lock source word timings. |
| `rough-cut` | Build the editable ChatCut timeline and complete the Golden Standard pass before review. |
| `rough-cut-review` | In `review`, the user approves, revises, or explicitly chooses `fallback-auto`; in `auto`, the workflow records `automatic-fallback`. |
| `rough-cut-export` | Export the approved rough cut and perform the basic media lock; trim-plan exports from projects explicitly marked `roughCutEngine: "ffmpeg-fallback"` also run the legacy trim audit. |
| `motion-plan` | Author wording, captions, beat map, MG, axis, and timing for HyperFrames. |
| `composition` | Build deterministic HyperFrames HTML/CSS/GSAP composition. |
| `render` | Produce the requested delivery and basic media verification. |
| `complete` | Keep the job available for scoped revisions. |

## Human-first path

HyperFrames owns released captions, B-axis treatment, MG, composition timing, and final rendering so caption timing and MG remain bound to one timeline.

In `review` mode, the user reviews the ChatCut timeline before export and the rendered file at delivery. See [Quality Checks](quality-gates.md) for the default checks.

## Automatic path

`auto` follows the same rough-cut standard and state sequence, records `automatic-fallback` at the existing review state, and runs the checks in [Quality Checks](quality-gates.md).

## Wording and visual axis

The recording remains authoritative for spoken content. A supplied reference script is preserved and reconciled; it can provide release wording only where the recording supports it. ASR and ChatCut are timing evidence.

`subtitles` uses HyperFrames subtitle layers for settled wording and reserves MG for supplemental meaning. `motion-copy` puts spoken wording inside designed motion. A-axis keeps the talking head full-frame with localized overlays; B-axis makes motion design the stage with a protected live PiP. Record B-axis or hybrid selection in the rough-cut decision; `review` requires the user's explicit choice, while `auto` may use an authorized automatic axis decision.

## Revisions

Use `reopen rough-cut|motion-plan|composition|delivery` at the earliest affected state for completed jobs. During an active job, localized `composition`/`render` revisions are supported only in `review` mode before an automatic-fallback decision. Keep the motion plan and creative-confirmation package as the baseline for local edits; use `replan` for global creative changes.

See [Editorial revisions](revision-standard.md) for preserving user decisions, repairing a whole feedback family, sizing evidence, and applying a shared frame edit after a late cut. A timing candidate or a flattened-master edit is not a rebuilt editable composition; keep the current delivery and its reproducible source explicit.
