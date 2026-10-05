# Caption Modes

## Motion-copy mode

Every spoken phrase appears as motion typography. There is no separate caption layer, and the beat map must cover every transcript segment exactly. Plan the visual treatment for the current job; the repository has no complete motion-copy reference composition.

## Subtitles mode

This is the default release path. Captions carry the complete reconciled spoken content. ChatCut viewer pages provide raw timing evidence; `captions/caption-review-plan.json` is the approved wording, grouping, and boundary authority, but it is a semantic draft rather than an installable caption file. Promote it to `captions/captions.json` before checking or installing released captions.

Default 1080×1920 caption treatment:

- 得意黑, embedded when available, with the sans-serif fallback used otherwise;
- white `#FFFFFF`;
- 96 px;
- line height 1.15;
- centered;
- 330 px above the bottom edge;
- soft black shadow offset downward;
- exactly one rendered line; keep each line to at most 10 display units, counting one Chinese character as 1 and about 3 English characters as 1;
- lexical units and fixed phrases are protected; particles and conjunctions may not stand alone;
- target one short clause or breath per cue, normally 0.8–2.5 seconds and never below 0.5 seconds;
- no opaque subtitle bar.

For normal production use the combined assembly entry point after generating the plan:

```bash
node scripts/compose-job.mjs jobs/<job-id>
```

Promotion checks the approved semantic plan and the exact generated caption file before replacing `captions/captions.json`. Run the standalone checkers only for early feedback, after changing a promoted file, or during an explicit audit.

The generator marks settled cue plans `approved` by default; use `captionStatus: proposed` only for an intentional draft. This records Agent preparation, not user approval. Promotion checks transcript freshness, wording coverage, protected terms, timing and renderer-compatible cues. ChatCut caption-rendering status is recorded when known; an unknown status warns but does not block. Disable ChatCut caption rendering for clean A-roll when available; inspect the delivered video for duplicate captions if status was unknown. Auto uses the same caption checks and has no extra creative-authority gate. The combined command installs the promoted cues after MG assembly and builds once.

Caption-only HyperFrames is the composition baseline, not a required separate export or approval. Only add MG when a selected semantic node has room outside the caption, face, PiP, and evidence regions; it must be local, brief, and supplemental. Keep the talking-head video full-frame beneath MG by default. A full-screen MG stage with speaker PiP follows the saved axis preference, defaulting to A-axis overlay when unspecified. It adds no approval gate. Never add a global MG treatment in this mode.

Creative confirmation calls these treatments **A-axis overlay mode** and **B-axis stage mode** and defines the selected treatment. An omitted preference uses the saved default; do not request a separate confirmation.

Use `docs/subtitle-mg-standard.md` for selection and placement. One concise `intent` explains the MG's use; duplicate written justifications are unnecessary.

### Default subtitle-led treatment

Use `recipes/traework-subtitles.json` and the reusable motion templates as the default visual treatment for subtitle-led talking-head work. The talking head remains full-frame on the A-axis, captions carry the complete wording, real evidence is shown at its original aspect ratio, and B-axis staging is reserved for a coherent demonstration range with a protected moving speaker window.
