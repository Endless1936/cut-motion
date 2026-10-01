# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

Every state change prints the brief to load for the state it lands on:

```text
Workflow state: rough-cut
Stage brief — read before working: docs/stages/rough-cut.md
```

Work from that file. It carries only what applies to the current stage — its entry conditions, required steps with their evidence, that stage's prohibitions, and its exit artifact — so the whole contract does not have to be held in context at once. Detailed policy stays in the documents each brief points to; the briefs index and constrain, they do not duplicate.

A `revise` returns to `rough-cut` and prints that brief again. Work it from the top rather than resuming from memory: one revision shipped without re-running a mandatory step because the agent continued from recollection instead of reloading.

`rough-cut` keeps the editable ChatCut timeline as its artifact and completes [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) before `rough-cut-review`. `chatcut-roughcut.json` records project and timeline evidence; captions, MG, and B-axis composition are authored in HyperFrames. After approval, export once to `roughcut/a-roll.mp4` and run the basic media lock.

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
