# Quality Checks

The default path is human-reviewed and intentionally light. Machine checks establish structure and media integrity; they do not establish semantic correctness, aesthetics, or release readiness.

## Default `review` path

- Keep the original source unchanged.
- Follow [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md) during the rough-cut phase. It is the edit procedure rather than an approval gate, but the `rough-cut → rough-cut-review` transition does validate its gap-candidate record (`state/timeline-source-windows.pre-cleanup.json` plus a passing `state/gap-candidates.json`); an unclassified retained pause blocks the transition. That check covers pauses; spoken coverage is the part a tightened clip edge can still break, so run `scripts/check-spoken-coverage.mjs` after edge tightening and before opening the review.
- After approval, export once and run only the basic rough-cut/media lock.
- Build the HyperFrames composition, render once, and verify that the delivery has readable video/audio, dimensions, frame rate, duration, and a non-empty file.
- Each transition checks its consumed dependencies; composition permits scoped review-mode visual edits and records the rebuilt result. `node scripts/workflow-state.mjs <workflow.json> verify` is the optional full fingerprint audit, including media and prior delivery.
- Let the user judge the final captions, MG, timing, semantics, and visual quality.

Run an optional audit, preview, or standalone validator only for a specific question. Caption promotion includes its release checks. The legacy trim-plan audit applies only to an explicit `ffmpeg-fallback` job.

## Explicit `auto` / `fallback-auto` path

Auto follows the same stages. The Agent performs the stage instructions; state transitions run only the code checks listed here and do not enforce every Agent action:

- rough-cut: media probe, source-transcript lock, wording reconciliation and gap-candidate classification/application checks. No item-by-item listening gate; `audioChecked=false` is valid. The Agent still performs semantic editing and coverage review. Only explicit `ffmpeg-fallback` exports run the legacy trim-plan audit;
- transcript/captions: the Agent prepares and installs the approved caption plan and checks timing. State transitions validate reconciliation, caption-plan authority, and the creative package; they do not run caption installation or timing-check commands;
- motion: beat-map/visual-plan and creative-confirmation checks at the existing state transitions. Font, layout, information-value, and standalone HyperFrames diagnostics remain explicit, on-demand commands; run them together with `scripts/check-composition.sh <job-directory>`, which rebuilds the composition and checks a pruned staging root;
- delivery: detailed render/media receipt when the renderer produces one, plus FFprobe integrity.

Optional snapshots and reports are evidence artifacts, not approval gates. A short preview can be rendered for a specific visual question without changing the workflow state.

## Authority

The recording is authoritative for spoken content. A supplied reference script is immutable reference evidence and must be reconciled before use. ChatCut/ASR supplies timing; HyperFrames owns released captions and motion graphics.

The user owns the final editorial and aesthetic decision.
