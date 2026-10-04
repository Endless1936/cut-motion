# Subtitle-Mode MG Standard

Captions carry the spoken wording. MG adds a useful relationship, evidence, scale, structure or action aid. Choose a template from the [catalog](../templates/motion-graphics/README.md); use a custom module when the content requires a different structure.

## Author once

In `planning-inputs.json`, each local MG needs:

- its interval, source segment IDs, spoken entry/exit anchors and exact template content (`templateData.items` or legacy `copy`);
- a template ID, one short `intent` and a `supportRole`;
- A/B placement and bounds that keep the caption region clear;
- source references for added claims or evidence, and explanations for newly introduced terms.

The generator derives caption cue IDs, shared template style, topology, flow, motion families and the readable documents. Do not duplicate template copy in `onScreenCopy` or hand-fill derived metadata. `viewerQuestion`, `removalLoss`, `visualEncoding` and `stillFrameValue` are optional legacy notes, not required essays. Geometry is checked from bounds; `safeAreaPass` and `captionSafeZonePass` declarations are unnecessary.

| Support role | Use |
| --- | --- |
| evidence | A real source, interface or clearly labelled reconstruction |
| explanation | A causal relationship or state change |
| calibration | A baseline, range or comparison |
| organization | A group, sequence or hierarchy |
| action | A decision or next step |
| consequence | A before/after result |

Caption-only intervals need no MG rationale. Select meaningful passages instead of targeting a fixed MG count or cadence.

## Visual rules

Background cards use their final width and height from the first frame; internal content may reveal progressively, but the card must not grow or resize in response. A visible element must already be supported by its background.

- Use a short A-axis annotation for one fact; a compact diagram for a simple relation; a coherent B-axis stage for dependent elements or a demonstration.
- Preserve the template's visual grammar while adapting copy, item count, flow and placement to the recording. Do not merge separate spoken items or reverse a relationship to fit sample slots; use a custom module when the structure needs it.
- Default A-roll overlays to the upper-middle area (280px from the top on a 1080×1920 canvas). Keep the overall MG and its background card horizontally centered on the video's vertical midline. Internal text and rows may align left or right; this does not move the card. Fit its height and width to avoid captions; eyes and mouth do not need clearance; tall sequences may start higher. A centered compact card can have a centered heading and left-aligned rows without a wide empty panel.
- Keep captions and evidence legible. Use actual layout bounds to keep MG clear of captions; a boolean declaration cannot establish clearance.
- In A-axis mode, groups normally replace one another after 1.8–3.0 seconds. Face overlap has no separate duration limit or approval requirement; use spoken meaning and readability to set the hold.
- In B-axis mode, related elements can accumulate within one scene and exit together.
- Reveal in spoken and causal order, keep labels next to their objects, and hold the resolved state long enough to read. Keep background cards at their final size while revealing content; context headings may precede the content, but future spoken items must not be visible early.
- From the first composition, bind each independent spoken element to its own [keyword onset](mg-speech-timing.md), not the whole-entry anchor or a fixed stagger. A single isolated note may enter directly. Use the passage's exit anchor for a unified or staged exit; custom modules follow the [composition contract](technology.md#hyperframes-composition-contract).
- Only exact `onScreenCopy` strings may appear in the frame. Production notes and explanations of what the animation is doing stay out of the video.
- Prefer the real evidence asset to an invented card. Label reconstructions and estimates; keep claims traceable and avoid implying more than the source supports.

## Assembly and review

`compose-job.mjs` instantiates templates and installs captions in order. For a specific local revision, use `assemble-mg.mjs --beat <id>`; preserve manually edited modules.

The rendered video is the visual handoff. Inspect a short preview or a still for a specific uncertainty or requested change, rather than making every template repeat a five-part written review. Keep readability, synchronization, caption clearance and source accuracy as the acceptance criteria.
