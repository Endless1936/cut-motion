# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` keeps the editable ChatCut timeline as its artifact. Complete semantic selection, the terminal-tail trim, remaining candidate classification, spoken-content coverage, and one original-source waveform batch lookup according to the sole [`talking-head-trim-standard.md`](talking-head-trim-standard.md) before `rough-cut-review`. Use targeted seam review only when candidate or waveform evidence raises a specific concern; exhaustive per-seam playback is not required. This work stays inside the existing state and adds no gate. `chatcut-roughcut.json` records the project and timeline; it is not a second seam gate. ChatCut does not author released captions, MG, or B-axis scenes. After the user approves the closed timeline, export once to `roughcut/a-roll.mp4` and run the basic media lock.

To abandon the manual review explicitly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note "Skip manual ChatCut review"
```

The command records the fallback decision and skips the manual review state. The post-export media and wording checks do not rewrite ChatCut's actual clip in/out points.

## Preferences and transcript

Ask once for caption, reference-script, and visual-axis preferences. If omitted, record an Agent recommendation before rough-cut approval. A reference script is immutable wording evidence; reconcile it with the recording. ChatCut/ASR supplies timing, while HyperFrames owns released captions and all motion graphics.

Use `set-caption-mode` and `set-axis-mode` so changes are recorded. A caption or axis change at or after planning returns to `motion-plan`.

## Modes

`review` is the default: wait at `rough-cut-review`, export once after approval, build HyperFrames, render once, and let the user judge the result.

In `auto`, the existing `rough-cut-review` state is resolved with the `automatic-fallback` decision; no parallel state or approval gate is added. The same ChatCut Golden Standard applies before that resolution, and selected structural/technical checks run during planning and delivery. The legacy trim-plan audit runs only when `roughCutEngine` is explicitly set to `ffmpeg-fallback`; it never runs on ChatCut timelines. Passing checks is not an aesthetic approval.

## Revisions

Use `reopen` for completed jobs:

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: caption segmentation, MG structure/copy, style, or axis;
- `composition`: parameter-only visual changes;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion.
