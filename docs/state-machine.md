# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

The state machine records and checks workflow transitions; it does not load Agent instructions. `workflow-state.mjs status` preserves JSON on stdout and prints the matching section link to stderr; successful state changes print the destination section link. Use that section in [`workflow.md`](workflow.md) as the stage guide.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` keeps the editable ChatCut timeline as its artifact and completes [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) before `rough-cut-review`. `chatcut-roughcut.json` records project and timeline evidence; captions, MG, and B-axis composition are authored in HyperFrames. After manual approval or explicit automatic fallback, export once to `roughcut/a-roll.mp4` and run the basic media lock.

The `rough-cut → rough-cut-review` transition for a ChatCut rough cut also validates the gap-candidate record, because steps 3-5 of the standard used to be unverifiable prose. It requires both `state/timeline-source-windows.pre-cleanup.json` (the retained structure before cleanup) and a passing `state/gap-candidates.json`, produced by `scripts/classify-gaps.mjs` and validated by `scripts/check-gap-candidates.mjs`:

```bash
cp jobs/<job-id>/state/timeline-source-windows.json jobs/<job-id>/state/timeline-source-windows.pre-cleanup.json
node scripts/classify-gaps.mjs jobs/<job-id> --write   # then classify every candidate
node scripts/check-gap-candidates.mjs jobs/<job-id>/state/gap-candidates.json
```

The check fails when a retained pause has no recorded disposition, when a pause is marked removed but is still on the timeline, when a pause excised from the pre-cleanup structure is unrecorded, when the artifact is stale for the timeline it describes, when the required dB sweep is missing, or when edge tightening was computed on a different item set than the locked timeline. The legacy `ffmpeg-fallback` path is unaffected and keeps its trim-plan audit.

At `composition`, `workflow-state.mjs` rebuilds `hyperframes/index.html` from `index.template.html`, the Beat Map, transcript, and MG modules, then records that build's hash. Those authored files are the editing source; generated HTML is disposable and the render entrypoint rebuilds from the same source before rendering.

To abandon the manual review explicitly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note "Skip manual ChatCut review"
```

The command records the fallback decision and skips the manual review state. The post-export media and wording checks do not rewrite ChatCut's actual clip in/out points.

## Preferences and transcript

Ask once for caption, reference-script, and visual-axis preferences. If omitted, record an Agent recommendation before rough-cut approval. A reference script is immutable wording evidence; reconcile it with the recording. ChatCut/ASR supplies timing, while HyperFrames owns released captions and all motion graphics.

Use `set-caption-mode` and `set-axis-mode` so changes are recorded. A caption or axis change at or after planning returns to `motion-plan`.

## Modes

`review` is the default: wait at `rough-cut-review`, then follow [Quality Checks](quality-gates.md) for the delivery path.

`auto` resolves the existing `rough-cut-review` state with `automatic-fallback` and runs the checks listed in [Quality Checks](quality-gates.md). Passing checks do not replace the user's aesthetic decision.

## Revisions

Use `reopen` from the earliest affected state for completed jobs. During an active job, localized `composition`/`render` revisions are supported only in `review` mode before an automatic-fallback decision. Revision routing for completed jobs, including Auto authority changes, follows [`revision-standard.md`](revision-standard.md):

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: broad or ambiguous changes to caption segmentation, MG structure, style, story, or axis;
- `composition`: explicit localized MG/caption implementation changes and parameter adjustments;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion.
