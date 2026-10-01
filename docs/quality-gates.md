# Quality Checks

The default path is human-reviewed and intentionally light. Machine checks establish structure and media integrity; they do not establish semantic correctness, aesthetics, or release readiness.

## Default `review` path

- Keep the original source unchanged.
- Complete [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) before the existing ChatCut review gate.
- Before that gate, confirm every mandatory Golden Standard step actually ran and is recorded in `state/chatcut-roughcut.json` — the terminal-tail pass and the residual-take scan included. A rough cut whose own record says a mandatory step was skipped does not advance; fix it and re-record instead of reporting it as a known omission.
- After approval, export once and run only the basic rough-cut/media lock.
- Build the HyperFrames composition, render once, and verify that the delivery has readable video/audio, dimensions, frame rate, duration, and a non-empty file.
- Let the user judge the final captions, MG, timing, semantics, and visual quality.

Run an optional audit, preview, or standalone validator only for a specific question. Caption promotion includes its release checks. The legacy trim-plan audit applies only to an explicit `ffmpeg-fallback` job.

## Explicit `auto` / `fallback-auto` checks

These machine checks run only when the user selects the automatic path or explicitly asks for the relevant audit:

- rough-cut: media probe, source-transcript lock, and wording reconciliation; the Agent still follows the Golden Standard procedure before advancing. Only an explicit `roughCutEngine: "ffmpeg-fallback"` trim-plan export runs the legacy trim-plan audit;
- transcript/captions: reconciliation, semantic one-line caption plan, caption installation, and timing checks;
- motion: beat-map/visual-plan and creative-confirmation checks at the existing state transitions. Font, layout, information-value, and standalone HyperFrames diagnostics remain explicit, on-demand commands;
- delivery: detailed render/media receipt when the renderer produces one, plus FFprobe integrity.

Optional snapshots and reports are evidence artifacts, not approval gates. A short preview can be rendered for a specific visual question without changing the workflow state.

## Authority

The recording is authoritative for spoken content. A supplied reference script is immutable reference evidence and must be reconciled before use. ChatCut/ASR supplies timing; HyperFrames owns released captions and motion graphics.

The user owns the final editorial and aesthetic decision.
