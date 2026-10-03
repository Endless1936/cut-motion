# Minimal Delivery Checks

This is a maintainer reference. Routine agents follow the active phase in [`workflow.md`](workflow.md) and do not load or run a separate full audit.

In `review` mode, the user approves the complete ChatCut rough cut, then reviews the three-plan package once before composition. The rough-cut decision is recorded in workflow state; the agent waits at `motion-plan` for plan approval. Explicitly selected `auto` mode continues after plan generation without that pause.

Keep only checks that prevent an unusable or materially incorrect file:

- The source and ChatCut project/timeline exist; explicit reference-script conflicts are handled against the recording.
- The A-roll and final MP4 are readable, contain audio and video, and their stream start offsets differ by no more than `max(0.1s, 2/fps)`. Different stream end durations alone do not establish desynchronization.
- Caption cues cover the locked transcript, preserve protected terms, use valid ordered timing, and install successfully. Caption width and natural Chinese phrase breaks are editorial guidance, not machine gates.
- The selected MG modules assemble and the HyperFrames composition builds successfully.
- An explicit FFmpeg fallback keeps its trim-plan/media audit. Normal ChatCut edits do not run it.

An unknown ChatCut caption-rendering flag only warns that the final MP4 may need a duplicate-caption glance. Render receipts and upstream Beat Map, HTML, creative-document, and large-media fingerprint comparisons are bookkeeping or diagnostics; they do not block the routine path. `workflow-state.mjs ... verify`, visual-plan checks, previews, and standalone validators are optional when a specific issue needs investigation.

`auto` uses the same minimal media, caption, and build checks; it skips both review pauses only when the user explicitly selected automatic operation. No additional full-audit checks run merely because the mode is `auto`.

The recording is authoritative for spoken wording. ChatCut supplies editable timing; HyperFrames owns released captions and motion graphics. The user makes the final editorial and visual judgment.
