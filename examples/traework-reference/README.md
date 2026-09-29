# TraeWork subtitle-led style kit

This is the preferred code-backed reference for `captionMode: subtitles` talking-head edits. It distills the approved TraeWork episode into reusable HyperFrames modules without copying its project media, transcript, or full job state.

The implementation source is under [`hyperframes/mg/`](hyperframes/mg/). Each module contains `fragment.html`, `style.css`, and `timeline.mjs`. Use [`manifest.json`](manifest.json) for the module inventory, [`recipes/traework-subtitles.json`](../../recipes/traework-subtitles.json) for authoring rules, and `visual-breakdown.md` for the scene decisions that made the reference readable. `timeline-map.json` lists representative patterns, not a timeline to paste into a new job.

The existing `examples/gold-standard` remains a runnable `motion-copy` reference: its full-stage typography and embedded speech are useful for that mode, but should not be used as the default subtitle-led treatment.

## Reference contract

- Keep complete captions separate from supplemental MG.
- Keep the talking head full-frame on the A-axis unless a local evidence scene earns a different treatment.
- Preserve every real screenshot or video at its original aspect ratio.
- Use masks, shading, replacement, and vertical hierarchy to direct attention; do not solve legibility with arbitrary zoom or crop.
- Reserve B-axis staging for coherent demonstrations and keep the live speaker window protected and moving.
- Reuse the module's visual grammar, not its project-specific copy, timings, or asset paths.
