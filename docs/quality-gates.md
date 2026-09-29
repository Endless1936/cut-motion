# Quality Checks

The default path is human-reviewed and intentionally light. Machine checks establish structure and media integrity; they do not establish semantic correctness, aesthetics, or release readiness.

## Default `review` path

- Keep the original source unchanged.
- Complete the Golden Standard's terminal-tail and candidate checks, spoken-content coverage, and one original-source waveform batch lookup before the existing ChatCut review gate. Use targeted seam review only when candidate or waveform evidence raises a specific concern; exhaustive per-seam playback is not required.
- After approval, export once and run only the basic rough-cut/media lock.
- Build the HyperFrames composition, render once, and verify that the delivery has readable video/audio, dimensions, frame rate, duration, and a non-empty file.
- Let the user judge the final captions, MG, timing, semantics, and visual quality.

Do not run the optional full automatic audit, standard-preview comparison, or second encode by default. The source-waveform batch lookup is part of the default ChatCut rough-cut pass. The legacy full trim-plan audit applies only when `roughCutEngine` is explicitly set to `ffmpeg-fallback`; it never applies to ChatCut timelines.

## Explicit `auto` / `fallback-auto` checks

These checks run only when the user selects the automatic path or explicitly asks for the relevant audit:

- rough-cut: media probe, source-transcript lock, wording reconciliation, and the Golden Standard checks; only a trim-plan export from a project explicitly marked `roughCutEngine: "ffmpeg-fallback"` runs the legacy trim-plan audit;
- transcript/captions: reconciliation, semantic one-line caption plan, caption installation, and timing checks;
- motion: beat-map, visual-plan, HyperFrames contract, font, layout, and information-value checks;
- delivery: detailed render/media receipt when the renderer produces one, plus FFprobe integrity.

Optional snapshots and reports are evidence artifacts, not approval gates. A short preview can be rendered for a specific visual question without changing the workflow state.

## Authority

The recording is authoritative for spoken content. A supplied reference script is immutable reference evidence and must be reconciled before use. ChatCut/ASR supplies timing; HyperFrames owns released captions and motion graphics.

The user owns the final editorial and aesthetic decision. Never summarize passing automated checks as “the video is good.”
