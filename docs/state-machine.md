# Workflow State Machine

`state/workflow.json` is authoritative. In `review`, the user approves the rough cut at `rough-cut-review` and the three-plan package at `motion-plan` before composition. The rough-cut decision is recorded in state; the agent waits at `motion-plan` for the plan decision. Explicitly selected `auto` mode continues after plan generation.

The state machine records and checks workflow transitions; it does not load Agent instructions. `workflow-state.mjs status` preserves JSON on stdout and prints the matching section link to stderr; successful state changes print the destination section link. Use that section in [`workflow.md`](workflow.md) as the stage guide.

## State route

```text
intake → transcription → rough-cut → rough-cut-review → rough-cut-export
       → motion-plan → composition → render → complete
```

`rough-cut` keeps the editable ChatCut timeline as its artifact and completes [the Talking-Head Trim Standard](talking-head-trim-standard.md) before `rough-cut-review`. `chatcut-roughcut.json` records project and timeline evidence; captions, MG, and B-axis composition are authored in HyperFrames. After manual approval or explicit automatic fallback, export once to `roughcut/a-roll.mp4` and run the basic media lock.

For ChatCut, local transcription records are optional before listening. While the user reviews the stable cut, prepare only MG content/template choices and real exceptions. After explicit approval, start or resume one clean A-roll export and, in parallel, call `preview_timeline({views:["transcript"]})` once on the approved timeline. Save each page's `structuredContent` in order; only when a page returns `nextOffset`, request the next page with `offset: nextOffset`, the returned timeline ID and the same range and filters. Generate the three plans from that snapshot while export runs. Bind source and anchor references to generated `main-001`, `main-002`, etc. IDs in preview order, not ChatCut item IDs or Script rows. Plan MG windows from entry ranges; `:word-001` represents the whole entry. During the first composition, bind multi-element reveals to existing keyword timestamps following [MG speech timing](mg-speech-timing.md), using source windows from the final approved cut rather than a pre-edit snapshot. Author natural phrase-level subtitle cues in `state/planning-inputs.json` within each parent entry's time range, following the [subtitle segmentation standard](subtitle-segmentation-standard.md); do not use an automatic Chinese sentence splitter. Routine ChatCut plan generation does not need source-word retrieval. In `review`, deliver the three plans together and wait at `motion-plan` for the user's package approval; explicitly selected `auto` continues after plan generation. Archived ChatCut jobs that already use locked source-word timing can pass `--legacy-source-timing`; the FFmpeg fallback keeps its existing route. From intake, transcription or rough-cut, record the editable cut and enter the existing review gate directly:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json review-cut --project-id <id> --timeline-id <id>
```

This writes the project/timeline record, preserves existing source-transcript locks and requests the user's decision. It does not claim to validate listening quality or require cleanup history. The `ffmpeg-fallback` path keeps its existing trim-plan audit; use the `prepare-rough-cut.mjs ... transcript` source-word import only for that explicit fallback or an existing legacy source-word job. An archived ChatCut job without a main-timeline snapshot can use its already locked source-word timing with `generate-plan.mjs <job> --legacy-source-timing`.

At `composition`, `workflow-state.mjs` rebuilds `hyperframes/index.html` from `index.template.html`, the Beat Map, transcript, and MG modules, then records that build's hash. Those authored files are the editing source; generated HTML is disposable and the render entrypoint rebuilds from the same source before rendering.

Only when the user explicitly selects automatic fallback, record that choice with `fallback-auto --actor user --note ...`; otherwise pause at `rough-cut-review` for the user's decision.

## Preferences and recorded artifacts

Honor supplied caption, reference-script, and visual-axis preferences. If omitted, keep the job defaults without asking a separate question round. The recording is authoritative for spoken wording; ChatCut/ASR supplies timing, while HyperFrames owns released captions and motion graphics.

Transitions check only the artifacts needed for the next operation. They do not block on plan/document or upstream build fingerprints; `verify` is an optional diagnostic. Composition is built from `index.template.html`, the Beat Map, transcript and MG modules.

## Modes

`review` is the default: wait at `rough-cut-review`, then wait at `motion-plan` after delivering the three plans. Resume composition after the user's package approval. The normal phase checks are stated in [`workflow.md`](workflow.md).

`auto` resolves the existing `rough-cut-review` state with `automatic-fallback` and continues after plan generation, using the same minimal checks stated in [`workflow.md`](workflow.md). The user must have explicitly selected Auto; passing checks do not replace the user's aesthetic decision.

## Revisions

Use `reopen` from the earliest affected state for completed jobs. During an active job, localized `composition`/`render` revisions are supported only in `review` mode before an automatic-fallback decision. Revision routing for completed jobs, including Auto authority changes, follows [`revision-standard.md`](revision-standard.md):

- `rough-cut`: editorial cuts and transcript timing;
- `motion-plan`: broad or ambiguous changes to caption segmentation, MG structure, style, story, or axis;
- `composition`: explicit localized MG/caption implementation changes and parameter adjustments;
- `delivery`: encoding-only changes.

Use a short affected-window preview for parameter changes when useful. Preserve the source and use `output/final.candidate.mp4` for a delivery revision so the last delivery remains available until promotion.
