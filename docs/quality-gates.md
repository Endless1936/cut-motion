# Minimal Delivery Checks

This is a maintainer reference. Routine agents follow the active phase in [`workflow.md`](workflow.md) and do not load or run a separate full audit.

The only user approval gate is the complete ChatCut rough-cut review. Plans need no separate approval. Agents deliver the rough cut promptly, prepare key motion inputs while the user listens, and generate the three plans once alongside A-roll export after approval.

Keep only checks that prevent an unusable or materially incorrect file:

- The source and ChatCut project/timeline exist; explicit reference-script conflicts are handled against the recording.
- The A-roll and final MP4 are readable, contain audio and video, and have plausible synchronized durations.
- Caption cues cover the locked transcript, preserve protected terms, use valid ordered timing, and install successfully. Caption width and natural Chinese phrase breaks are editorial guidance, not machine gates.
- The selected MG modules assemble and the HyperFrames composition builds successfully.
- An explicit FFmpeg fallback keeps its trim-plan/media audit. Normal ChatCut edits do not run it.

An unknown ChatCut caption-rendering flag only warns that the final MP4 may need a duplicate-caption glance. Render receipts and upstream Beat Map, HTML, creative-document, and large-media fingerprint comparisons are bookkeeping or diagnostics; they do not block the routine path. `workflow-state.mjs ... verify`, visual-plan checks, previews, and standalone validators are optional when a specific issue needs investigation.

`auto` uses the same minimal media, caption, and build checks; it skips the user gate only when the user explicitly selected automatic operation. No additional full-audit checks run merely because the mode is `auto`.

The recording is authoritative for spoken wording. ChatCut supplies editable timing; HyperFrames owns released captions and motion graphics. The user makes the final editorial and visual judgment.
