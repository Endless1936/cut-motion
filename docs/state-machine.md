# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` records the ChatCut project and timeline only. ChatCut does not author released captions, MG, or B-axis scenes. After the user approves the timeline, export once to `roughcut/a-roll.mp4` and run only the basic media lock.

To abandon the manual review explicitly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note "Skip manual ChatCut review"
```

The command warns that export, three-threshold seam checking, and repair may take a long time.

## Preferences and transcript

Ask once for caption, reference-script, and visual-axis preferences. If omitted, record an Agent recommendation before rough-cut approval. A reference script is immutable wording evidence; reconcile it with the recording. ChatCut/ASR supplies timing, while HyperFrames owns released captions and all motion graphics.

Use `set-caption-mode` and `set-axis-mode` so changes are recorded. A caption or axis change at or after planning returns to `motion-plan`.

## Modes

`review` is the default: wait at `rough-cut-review`, export once after approval, build HyperFrames, render once, and let the user judge the result.

`auto` uses the same states, automatically selects the rough-cut fallback when the rough-cut reaches review, and runs the explicit structural/technical checks during planning and delivery. It is slower by design; passing checks is not an aesthetic approval.

## Revisions

Use `reopen` for completed jobs:

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: caption segmentation, MG structure/copy, style, or axis;
- `composition`: parameter-only visual changes;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion.
