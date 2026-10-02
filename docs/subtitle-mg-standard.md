# Subtitle-Mode MG Standard

Captions carry the spoken wording. MG adds a useful relationship, evidence, scale, structure or action aid. Choose a template from the [catalog](../templates/motion-graphics/README.md); use a custom module when the content requires a different structure.

## Author once

In `planning-inputs.json`, each local MG needs:

- its interval, source segment IDs, spoken entry/exit anchors and exact `templateData.copy`;
- a template ID, one short `intent` and a `supportRole`;
- A/B placement, bounds and a face-placement note for this recording;
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

- Use a short A-axis annotation for one fact; a compact diagram for a simple relation; a coherent B-axis stage for dependent elements or a demonstration.
- Preserve the approved template's structure and animation. Change copy, assets, anchors and placement for the current recording.
- Keep captions, speaker PiP and evidence legible. Use actual layout bounds and a concise face-placement note; a boolean declaration cannot establish safety.
- In A-axis mode, groups normally replace one another after 1.8–3.0 seconds. A brief face overlap must remain within the documented limit and cannot accumulate across groups. Explicit user instructions can override face placement.
- In B-axis mode, related elements can accumulate within one scene and exit together.
- Reveal in reading/causal order, keep labels next to their objects, and hold the resolved state long enough to read. Containers awaiting a spoken label retain meaningful content or a dim preview.
- Bind the entrance and exit to the spoken passage. The template handles its internal choreography; custom modules follow the [composition contract](technology.md#hyperframes-composition-contract).
- Only exact `onScreenCopy` strings may appear in the frame. Production notes and explanations of what the animation is doing stay out of the video.
- Prefer the real evidence asset to an invented card. Label reconstructions and estimates; keep claims traceable and avoid implying more than the source supports.

## Assembly and review

`compose-job.mjs` instantiates templates and installs captions in order. For a specific local revision, use `assemble-mg.mjs --beat <id>`; preserve manually edited modules.

The rendered video is the visual handoff. Inspect a short preview or a still for a specific uncertainty or requested change, rather than making every template repeat a five-part written review. Keep readability, synchronization, protected regions and source accuracy as the acceptance criteria.
