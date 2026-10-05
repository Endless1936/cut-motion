# Editing and text

## Rough cut

Use the clearest complete argument as the spine. Remove failed takes, self-correction, repeated information and reading gaps; retain connective speech and purposeful pauses. Do not delete every hesitation mechanically.

Keep duration-changing content edits in ChatCut. After editorial lock, the clean exported rough cut is the timing authority for finishing. If its edit changes, refresh the media and timing before using the existing plan.

The targeted edge pass removes audible or visible dead margins near actual cuts. Apply one calculated batch and listen to the complete cut; do not introduce item-by-item user listening, a waveform inventory or a separate approval.

## Reference-script correction

Before presenting the combined plan, reconcile every retained passage with the supplied script. Correct recognition mistakes, names, products and technical terms in `plan.captions`. Preserve genuine spoken deviations and omitted/reordered material rather than copying reference lines with old timestamps. Visual notes in `【】` never enter captions.

Retain measured boundaries while changing display wording. If a correction changes token count, align the corrected phrase to its observed range; do not manufacture per-word timing. Use the corresponding raw keyword or a locally verified onset for MG. Listen to the affected audio window when evidence is ambiguous; do not ask for a new approval for each word.

Raw ASR and tool pages are timing evidence, not a competing publication text. Generated captions and HTML always come from the same corrected plan. No reconciliation table or manually synchronized transcript file is needed.

Adjacent clips may each reference the same complete ASR word after a cut inside it. Treat joined fragments of that source word as one spoken unit; preserve genuine repeated speech and intentional replay.

## Caption grouping

Use one short clause or breath per regular cue, complete across all speech. Keep lexical units together and avoid isolated particles or conjunctions. Aim for at most 10 Chinese-equivalent display units per line; roughly three English letters or digits count as one. Prefer semantic splitting at observed word boundaries to shrinking or clipping text.

Default captions are centered white text with a soft dark shadow and no opaque bar. At 1080×1920, use 96 px Smiley Sans where available, 384 px above the bottom. Scale with the canvas. Missing fonts use sans-serif rather than blocking production.

For Motion Copy, group a complete thought into a paragraph and plan readable semantic lines; `lines[].at` is an actual phrase onset and `lines[].text` is the displayed wording. With lines present, omit the redundant full `caption.text`. Keep all spoken text in this single treatment. Do not introduce another subtitle layer or duplicate it as supplementary MG.

## Motion decisions

Read the retained [template catalog](../assets/motion-graphics/README.md) when choosing a structure. Choose by meaning: sequence, parallel points, relationship, comparison, result, evidence, quotation, code or note. Example item counts are not limits.

Use a connected process as one group, revealing each step with speech and keeping previous content available. For many inputs leading to one result, inputs appear first and the result appears afterward in the stated direction. Preserve four named items as four items.

A-roll overlay is the default. A/B stage helpers remain available for a supported full-stage explanation; use them only when that treatment helps. Do not impose a minimum MG count, fixed switching frequency or additional B-axis approval.

At snapshot review, look at the complete expanded card: readable text, sensible internal padding, no clipping, centered container and no caption collision. Fix the affected layout rather than rebuilding every group.
