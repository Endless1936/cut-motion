# Quality Checks

The default path is human-reviewed and intentionally light. Machine checks establish structure and media integrity; they do not establish semantic correctness, aesthetics, or release readiness.

## Default `review` path

- Keep the original source unchanged.
- Open the ChatCut timeline and wait for the user's rough-cut decision before exporting.
- After approval, export once and run only the basic rough-cut/media lock.
- Build the HyperFrames composition, render once, and verify that the delivery has readable video/audio, dimensions, frame rate, duration, and a non-empty file.
- Let the user judge the final captions, MG, timing, semantics, and visual quality.

Do not run the three-threshold rough-cut audit, full snapshot/layout/font/information-value audit, standard-preview comparison, or second encode by default.

## Explicit `auto` / `fallback-auto` checks

These checks run only when the user selects the automatic path or explicitly asks for the relevant audit:

- rough-cut: three silence thresholds, canonical trim finalization, seam checks, and transcript lock;
- transcript/captions: reconciliation, semantic one-line caption plan, caption installation, and timing checks;
- motion: beat-map, visual-plan, HyperFrames contract, font, layout, and information-value checks;
- delivery: detailed render/media receipt when the renderer produces one, plus FFprobe integrity.

Optional snapshots and reports are evidence artifacts, not approval gates. A short preview can be rendered for a specific visual question without changing the workflow state.

## Authority

The recording is authoritative for spoken content. A supplied reference script is immutable reference evidence and must be reconciled before use. ChatCut/ASR supplies timing; HyperFrames owns released captions and motion graphics.

The user owns the final editorial and aesthetic decision. Never summarize passing automated checks as “the video is good.”
