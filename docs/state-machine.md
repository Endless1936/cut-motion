# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

The state machine records and checks workflow transitions; it does not load Agent instructions. `workflow-state.mjs status` preserves JSON on stdout and prints the matching section link to stderr; successful state changes print the destination section link. Use that section in [`workflow.md`](workflow.md) as the stage guide.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` keeps the editable ChatCut timeline as its artifact and completes [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) before `rough-cut-review`. `chatcut-roughcut.json` records project and timeline evidence; captions, MG, and B-axis composition are authored in HyperFrames. After manual approval or explicit automatic fallback, export once to `roughcut/a-roll.mp4` and run the basic media lock.

For ChatCut, local transcription records are optional before listening. From intake, transcription or rough-cut, record the editable cut and enter the existing review gate directly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json review-cut --project-id <id> --timeline-id <id>
```

This writes the project/timeline record, preserves existing source-transcript locks and requests the user's decision. It does not claim to validate listening quality or require cleanup history. After approval, import source words for planning and bind them with `lock-transcript`; subsequent changes to that snapshot are still rejected. The `ffmpeg-fallback` path keeps its existing trim-plan audit.

At `composition`, `workflow-state.mjs` rebuilds `hyperframes/index.html` from `index.template.html`, the Beat Map, transcript, and MG modules, then records that build's hash. Those authored files are the editing source; generated HTML is disposable and the render entrypoint rebuilds from the same source before rendering.

To abandon the manual review explicitly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json fallback-auto --actor user --note "Skip manual ChatCut review"
```

The command records the fallback decision and skips the manual review state. The post-export media and wording checks do not rewrite ChatCut's actual clip in/out points.

## Preferences and transcript

Ask once for caption, reference-script, and visual-axis preferences. If omitted, record an Agent recommendation before rough-cut approval. A reference script is immutable wording evidence; reconcile it with the recording. ChatCut/ASR supplies timing, while HyperFrames owns released captions and all motion graphics.

Use `set-caption-mode` and `set-axis-mode` so changes are recorded. A caption or axis change at or after planning returns to `motion-plan`.

## Recorded fingerprints

`advance` checks the dependencies consumed by its phase. Source transcript locking and media identity remain enforced; large media is not rehashed at every intermediate transition. Delivery checks the media and settled composition. `node scripts/workflow-state.mjs <workflow.json> verify` additionally audits recorded documents and the previous delivery when diagnosing drift.

During `composition`, rebuilt HTML is an in-progress output. In `review`, scoped visual changes may update the Beat Map and its binding at the composition transition; the original plan documents remain the baseline. `verify` also treats these current editing outputs as drafts. In `auto`, plan-authority changes still return through `replan --note ...`; completed jobs use `reopen motion-plan --actor user --note ...`. These are existing routes, not new approvals.

After a successful build, changed Beat IDs, fields and before/after values are recorded automatically as `visual-plan-change` in workflow history. `state/visual-plan-baseline.json` holds the latest comparison snapshot; no manual revision document is needed. Older jobs without a usable snapshot record that prior values are unavailable and establish the current baseline.

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
