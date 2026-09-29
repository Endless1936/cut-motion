# Workflow Architecture

Each job owns its source, state, previews, logs, and output under `jobs/<job-id>/`. Never overwrite the source or place generated media in the repository root.

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

ChatCut is only the rough-cut editor. Do not add released subtitles or motion graphics there. HyperFrames owns captions, B-axis treatment, MG, composition timing, and final rendering so caption timing and MG remain bound to one timeline.

In `review` mode, the user is the quality gate: inspect the ChatCut timeline before export, then inspect the rendered file. The default path does not render a standard preview, run a full visual QA pass, or compare two encodes.

## Automatic path

`auto` follows the same ChatCut Golden Standard through rough-cut. At the existing `rough-cut-review` state, it records `automatic-fallback` and runs the validations enabled for auto; it adds no intermediate approval state. The legacy trim-plan audit runs only when `roughCutEngine` is explicitly set to `ffmpeg-fallback`, never on ChatCut timelines. Optional reports or `previews/final-preview.mp4` may be generated when the user explicitly asks for an audit or preview.

## Wording and visual axis

The recording remains authoritative for spoken content. A supplied reference script is preserved and reconciled; it can provide release wording only where the recording supports it. ASR and ChatCut are timing evidence.

`subtitles` uses HyperFrames subtitle layers for the settled wording and reserves MG for supplemental meaning. `motion-copy` puts spoken wording inside designed motion. A-axis keeps the talking head full-frame with localized overlays; B-axis makes motion design the stage with a protected live PiP. B-axis and hybrid require explicit user choice.

## Revisions

Use `reopen rough-cut|motion-plan|composition|delivery` for completed jobs. Parameter-only changes should use an affected-window preview before a full delivery render. Delivery revisions render to `output/final.candidate.mp4` and are promoted by the workflow after media verification.

See [Editorial revisions](revision-standard.md) for preserving user decisions, repairing a whole feedback family, sizing evidence, and applying a shared frame edit after a late cut. A timing candidate or a flattened-master edit is not a rebuilt editable composition; keep the current delivery and its reproducible source explicit.
