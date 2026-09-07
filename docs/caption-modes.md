# Caption Modes

## Motion-copy mode

This is the high-density style demonstrated by the legacy `examples/gold-standard` video. Every spoken phrase appears as motion typography. There is no additional caption layer. The beat map must cover every transcript segment exactly.

## Subtitles mode

This is the default release path. Captions carry the complete reconciled spoken content. ChatCut viewer pages provide raw timing evidence; `captions/caption-review-plan.json` is the approved wording, grouping, and boundary authority.

Default 1080×1920 caption treatment:

- 得意黑, locally embedded;
- white `#FFFFFF`;
- 96 px;
- line height 1.15;
- centered;
- 330 px above the bottom edge;
- soft black shadow offset downward;
- exactly one rendered line; target 4–10.5 measured display units and allow up to 11.8 only with the approved 88–96px cue-level fit range;
- lexical units and fixed phrases are protected; particles and conjunctions may not stand alone;
- target one short clause or breath per cue, normally 0.8–2.5 seconds and never below 0.5 seconds;
- no opaque subtitle bar.

Use this sequence:

```bash
node scripts/check-caption-review-plan.mjs jobs/<job-id>/captions/caption-review-plan.json
node scripts/promote-caption-review-plan.mjs jobs/<job-id>
node scripts/check-captions.mjs jobs/<job-id>/captions/captions.json jobs/<job-id>/captions/chatcut-pages.json jobs/<job-id>/state/design-system.json
node scripts/install-captions.mjs jobs/<job-id>/captions/captions.json jobs/<job-id>/hyperframes/index.html jobs/<job-id>/state/design-system.json
```

Before promotion, lock the ChatCut rough cut, reconcile wording against the recording, and mark the settled semantic cue plan `status: approved`. This records the Agent's completed preparation, not a new user gate. Promotion validates transcript freshness, complete semantic coverage, timing, and clean-export evidence before replacing captions; `auto` and `fallback-auto` additionally retain the full creative-package authority check. Disable ChatCut caption rendering before exporting clean A-roll. The installer uses only the approved promoted cues and replaces prior generated clips idempotently.

Caption-only HyperFrames is the composition baseline, not a required separate export or approval. Only add MG when a selected semantic node has room outside the caption, face, PiP, and evidence regions; it must be local, brief, and supplemental. Keep the talking-head video full-frame beneath MG by default. A full-screen MG stage with speaker PiP follows the axis decision accepted at rough-cut review, including a recorded decision on the explicitly authorized automatic path; it adds no approval gate. Never add a global MG treatment in this mode.

Creative confirmation calls these treatments **A-axis overlay mode** and **B-axis stage mode**, defines both for the user, and records any accepted B-axis or hybrid choice before implementation.

`docs/subtitle-mg-standard.md` is the binding selection rule. A local MG must close a documented viewer cognition gap; merely adding a new fact, technical term, visual stimulus, or subtitle paraphrase is insufficient.

### Preferred subtitle-led reference

Use `examples/traework-reference/` and `recipes/traework-subtitles.json` as the default visual reference for subtitle-led talking-head work. The talking head remains full-frame on the A-axis, captions carry the complete wording, real evidence is shown at its original aspect ratio, and B-axis staging is reserved for a coherent demonstration range with a protected moving speaker window.
