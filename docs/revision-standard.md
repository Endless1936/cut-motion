# Editorial revisions

Use this standard for revisions to an existing job. It adds no approval gate or full-video audit. The user's settled wording, visual direction, face-coverage preference, and requested frame rate remain authoritative across turns.

## Start from the delivered revision

Read `state/project.json`, `state/workflow.json`, the latest delivery receipt, and the affected authored sources. Identify the actual file the user reviewed. A new asset with the same filename is a new input: inspect its current pixels, dimensions, and crop, then rebuild affected output. Do not reuse a cached result based on its path alone.

Resolve frame rate once from the user's delivery choice, otherwise the source default. Keep that rate in the project, frame calculations, composition, and render flags. A 29.97 fps source does not override a requested 30 fps delivery; do not add conversion stages merely to preserve the source's fraction.

Use `workflow-state.mjs reopen` at the earliest affected stage. If workflow state and delivered evidence disagree, report and reconcile that discrepancy; do not fabricate state completion or silently run a second workflow in an ad hoc script.

## Diagnose a feedback family

When the user reports repeated defects, identify all Beats sharing the faulty layout, timing rule, or motion treatment. Correct that family while preserving accepted decisions elsewhere. Distinguish a source-code fix, a built composition, a rendered file, and a visually inspected frame in progress reports.

For a visual correction, inspect the affected entrance, readable hold, and exit in the rebuilt composition, including the first frame after the intended exit. A 1–3 second local window is normally enough. Use a temporary window containing the actual motion when its behavior needs longer to assess. This is targeted evidence for the reported defect, not another approval gate or mandatory full-video review. A successful media probe does not establish visual quality.

## Evidence layout and timing

Use the existing Beat fields rather than a second planning document:

- `captionCueIds` and entry/exit word anchors bind the exact spoken clause. A material named after one phrase does not inherit the rest of the paragraph. Check the resolved render end, including exit motion; changing `beat.end` alone does not change an old word anchor.
- `evidenceSource`/`assets` identify the current material. `visualEncoding` describes the region that needs to remain legible and any crop. Keep units, labels, and source context needed to understand the evidence.
- `visualStyle` describes the reference behavior being reused and the adaptation for this material. `layout` records placement and any user-approved face coverage.

Size the display to the material's aspect ratio and reading needs. A tall image normally gets a tall display; do not center it inside a wide empty plate. A background card is optional and follows the visible content. Before reducing scale or cropping useful information, use available vertical space and the user's permitted face coverage. Captions remain protected.

For source-video proof, retain enough of the original frame, including the speaker when relevant, to establish that it came from the prior video. Do not crop it into a standalone replay of the MG unless that is the intended evidence. Remove phone status bars or other irrelevant chrome only when they do not carry the claim.

For spotlight emphasis, keep one source image inside one fixed viewport. Darken the surroundings, move the clear region to the named target, and optionally pan/scale the image around that target inside the same viewport. Do not add a second enlarged panel unless comparison is the purpose. Keep title and associated value visible together. Computed bounds should measure the clipped visible image, not the offscreen area created by the zoom.

For multiple covers, a direct fan reveal is one available grammar. Avoid preparatory shuffling or extra bounces without a semantic reason. References supply relationships and choreography, not compulsory coordinates, durations, or templates.

When the user explicitly permits longer face coverage, record `layout.faceCoverApproval: "user"` and the instruction in `layout.faceSafetyNote`. The builder derives `data-face-cover-approval="user"` for that Beat's A-axis groups and rejects an authored permission without the matching record. This overrides the default face-duration limit only, not caption protection, replacement behavior, or canvas bounds.

## Captions and small text revisions

The Agent authors semantic segmentation. Code aligns and checks it; it does not repaginate approved wording. Treat missing, null, or blank times as requests for word alignment. Preserve explicit zero times. When the user changes a split, rebind its word range to the edited text before resolving timestamps.

Record user-specific counting and punctuation exceptions in the job's caption plan/rules and lexicon. Preserve official project-name case and version notation. Do not convert this episode's terms or character-count preference into a repository-wide default.

All captions use half-open integer windows `[startFrame, endFrame)` on the delivery frame grid. Adjacent cues may touch but never overlap, including fade tails. Installation and composition building reject an overlapping sequence; HTML times derive from those frames. Do not animate a caption beyond its clip lifetime.

For a requested size increase, scale the settled size, retain the chosen segmentation, and measure the longest lines in the loaded final font. Keep one line centered in the safe zone. Any exceptional fitting belongs to the affected cue and must be recorded; do not silently undo a global increase by shrinking every line. Use stable `data-caption-id` selectors for cue-specific CSS, not positional IDs that change after deletions.

## Late cuts

Choose one half-open deletion range on the declared delivery frame grid. Derive removed seconds from its frame count. Use the same edit for video, audio, captions, MG windows, micro-events, and directly owned supporting video/audio. Do not shift asset-local `data-media-start` values as if they were composition time.

`scripts/shift-timestamps.sh <input.json> <cut-start-seconds> <cut-end-seconds> <new-output.json> [fps]` generates a candidate caption document or Beat Map. It reads the document fps or the explicit fps, requires frame-aligned boundaries, removes wholly deleted items, updates caption frame/second fields together, and rejects partial intersections. It preserves wording and IDs. It deliberately does not alter transcript words, HTML/GSAP, source media, or unrelated nested timestamps.

For an editable revision, re-align the current transcript from immutable source evidence, reconcile surviving word/cue references, apply the candidate timing, rebuild media and HyperFrames, and refresh the creative package/render manifest. Include direct media children and raw absolute GSAP times in the affected scope. Candidate JSON alone is not a synchronized job. Do not clamp a cut-through word, caption, or animation to a zero-length item; resolve the new local meaning first.

For a final removal after visuals are settled, precision trimming a completed HyperFrames master can preserve all layers as one picture. Record the parent file/hash, kept source frame intervals, new frame count, and revised subtitle/motion timing in a delivery edit map. Keep the editable parent intact and identify the edit map as an additional reproducible delivery step. Do not claim the parent composition now uses the shorter timeline. Avoid repeated lossy trims by returning to the same parent master for later cut revisions.

Export to a new candidate, verify frame count/rate, dimensions and audio, then update the delivery pointer. When asked to stop, stop the owned render process if still active; if it already completed, report that accurately and do not start another render.
