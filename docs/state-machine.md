# Workflow State Machine

`state/workflow.json` is authoritative. The only approval gate is `rough-cut-review`; every other step advances after its artifact or check is complete.

The state machine records and checks workflow transitions; it does not load Agent instructions. `workflow-state.mjs status` preserves JSON on stdout and prints the matching section link to stderr; successful state changes print the destination section link. Use that section in [`workflow.md`](workflow.md) as the stage guide.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` keeps the editable ChatCut timeline as its artifact and completes [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) before `rough-cut-review`. `chatcut-roughcut.json` records project and timeline evidence; captions, MG, and B-axis composition are authored in HyperFrames. After manual approval or explicit automatic fallback, export once to `roughcut/a-roll.mp4` and run the basic media lock.

For ChatCut, local transcription records are optional before listening. While the user reviews the stable cut, prepare only key MG beats and real exceptions; use generated caption segmentation. After explicit approval, retrieve missing source words once, start A-roll export and generate the three plans concurrently. No separate plan approval is required. From intake, transcription or rough-cut, record the editable cut and enter the existing review gate directly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json review-cut --project-id <id> --timeline-id <id>
```

This writes the project/timeline record, preserves existing source-transcript locks and requests the user's decision. It does not claim to validate listening quality or require cleanup history. If source words are missing, retrieve them once after approval for plan generation. The `ffmpeg-fallback` path keeps its existing trim-plan audit.

At `composition`, `workflow-state.mjs` rebuilds `hyperframes/index.html` from `index.template.html`, the Beat Map, transcript, and MG modules, then records that build's hash. Those authored files are the editing source; generated HTML is disposable and the render entrypoint rebuilds from the same source before rendering.

Only when the user explicitly selects automatic fallback, record that choice with `fallback-auto --actor user --note ...`; otherwise pause at `rough-cut-review` for the user's decision.

## Preferences and recorded artifacts

Honor supplied caption, reference-script, and visual-axis preferences. If omitted, keep the job defaults without asking a separate question round. The recording is authoritative for spoken wording; ChatCut/ASR supplies timing, while HyperFrames owns released captions and motion graphics.

Transitions check only the artifacts needed for the next operation. They do not block on plan/document or upstream build fingerprints; `verify` is an optional diagnostic. Composition is built from `index.template.html`, the Beat Map, transcript and MG modules.

## Modes

`review` is the default: wait at `rough-cut-review`; the normal phase checks are stated in [`workflow.md`](workflow.md).

`auto` resolves the existing `rough-cut-review` state with `automatic-fallback` and uses the same minimal checks stated in [`workflow.md`](workflow.md). Passing checks do not replace the user's aesthetic decision.

## Revisions

Use `reopen` from the earliest affected state for completed jobs. During an active job, localized `composition`/`render` revisions are supported only in `review` mode before an automatic-fallback decision. Revision routing for completed jobs, including Auto authority changes, follows [`revision-standard.md`](revision-standard.md):

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: broad or ambiguous changes to caption segmentation, MG structure, style, story, or axis;
- `composition`: explicit localized MG/caption implementation changes and parameter adjustments;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion.
