# Stage: transcription

Load this when `workflow-state.mjs` enters `transcription`.

## Enters with

- A job with a probed source and an immutable copy in `input/`.

## Do

1. Transcribe with **ChatCut**. Do not substitute local ASR. If ChatCut is unavailable, defer transcript-dependent edits rather than guessing.
2. If a reference script was supplied, persist the immutable original under `input/reference-scripts/` and record its SHA-256 in both `state/workflow.json` and `state/reference-script-annotations.json`.
3. Reconcile the reference against the recording: remove text that was never spoken, restore spoken omissions, and use the confirmed wording for release. The recording remains authoritative for what was actually spoken.
4. When the reference contains `【】`, use only `speechText` for released wording and keep every visual note as separate planning evidence. Visual notes never replace whole-video analysis and never count as final axis or motion approval.
5. Write timestamps to `state/transcript.json` and evidence to `state/transcript-reconciliation.json`, then run the reconciliation checker.
6. Advancing this stage snapshots the source-timeline word timings to **immutable** `state/source-transcript.json`. Its hash survives later rough-cut revisions, which is what makes the terminal-tail pass reproducible after a revision.

## Do not

- Treat local silence detection as a substitute for ASR. It is a separate audio-only step; the original audio may still be indexed locally for a targeted seam audit.
- Silently resolve a wording conflict that affects release. Preserve the uncertainty and resolve it against the recording before release.
- Let reference-script visual notes leak into released wording.

## Exits with

- `state/transcript.json`, `state/transcript-reconciliation.json`, and the reconciliation checker passing.
- `state/source-transcript.json` snapshotted by the advance.
- `state/reference-script-annotations.json` when a reference script exists.
