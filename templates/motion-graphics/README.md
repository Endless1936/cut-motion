# Motion Graphics templates

Reusable HyperFrames implementations for a 1080×1920 talking-head composition. Start with the template matching the information being explained; sample wording and numbers are placeholders.

## Choose a template

| ID / source | Use | Motion / sample layout |
| --- | --- | --- |
| [ordered-steps](ordered-steps/) | Ordered actions, rankings, stages | Four numbered rows; a vertical rail advances with each reveal |
| [parallel-points](parallel-points/) | Independent benefits, conditions, features | Four unnumbered rows; restrained stagger without directional connectors |
| [linear-flow](linear-flow/) | Input → processing → output | Four horizontal nodes; the connecting line advances with the spoken sequence |
| [relation-map](relation-map/) | One source producing several outputs | One source branches into three destinations |
| [converge-sources](converge-sources/) | Several inputs combining into one result | Four aligned source labels join a shared collector and reveal the result |
| [map-transform](map-transform/) | One input transformed into one output | Two broad labels connected by a short descending arrow |
| [comparison](comparison/) | Before/after or two alternatives | Two large columns; labels first, contrasting statements next |
| [metric-proof](metric-proof/) | One measured result | Source label, large value and unit, then explanation |
| [evidence-focus](evidence-focus/) | Show proof inside a screenshot | Preserve the image, dim its surroundings and move between focus regions |
| [quote](quote/) | Quotation, definition, key statement | Large text introduced by a short rule; attribution follows |
| [code-snippet](code-snippet/) | Command, prompt, short code example | Four monospace lines reveal in order; the important line receives emphasis |
| [correction](correction/) | Replace a mistaken expression or approach | Strike through the old phrase, reveal its replacement |
| [annotation](annotation/) | Short supplementary note below spoken captions | Book Video's centered one-line caption, with a small upward fade |
| [stage/b-axis-horizon-grid](stage/b-axis-horizon-grid/) | B-axis stage background | Mirrored upper/lower perspective grids scroll toward the horizon |
| [stage/axis-stage-transition](stage/axis-stage-transition/) | A-axis full frame ↔ B-axis stage | Speaker shrinks into a circular PiP and expands back along the same path |

The paired choices serve different meanings: ordered versus independent lists, sequential versus branching relationships, comparison versus a single result. Use `evidence-focus` when the original interface or document is the evidence.

## Plan → instantiate

1. In the existing Motion Plan and creative confirmation, identify the template ID, BeatID, final copy/assets, position and spoken anchors. A custom implementation remains appropriate when these templates cannot express the content; record the reason briefly.
2. For a content template or grid, copy its `fragment.html`, `style.css`, and `timeline.mjs` to `jobs/<job>/hyperframes/mg/<BeatID>/`. Set the fragment's `data-beat-id` to that BeatID. Replace sample content, set `data-axis` to the intended axis and bind the beat in the existing Beat Map. The builder fills motion-group start and duration from that beat.
3. Set each `data-at` in **seconds relative to the beat start**, using the approved spoken timing. Keep the last reveal before the beat's exit. The builder supplies `root`, scoped `select`, `beat` and the shared paused `timeline`; `select` returns an array. The builder controls the final fade through the Beat Map's exit anchor and `exitFrames`.
4. Rebuild through `scripts/build-composition.mjs` before rendering. This copies source changes into `index.html`; exporting an older build will show older MGs.

For the A/B transition, merge the helper into the composition's existing video and shared timeline instead of creating an MG clip. Each B-axis interval must be at least twice the transition duration (1.6 seconds with the 0.8-second default); intervals on the same speaker track must not overlap. See [stage integration](../../examples/book-video-reference/REPRODUCTION.md#a-axis--b-axis-stage-transition) for the exact call and markup.

## Adapt the content

- Content layouts use roughly 88% of the frame width and large text for phone viewing. Most accept `--mg-top` on the root for vertical placement. Position them against the current face and subtitle locations; a sample position is not face detection.
- Keep the sample's information density. The ordered-step rail is positioned for four rows; keep four or adjust its rail endpoints when changing the count. Parallel rows can vary with matching reveal times. Horizontal flows and branching diagrams require corresponding layout/connector adjustments when changing node counts. Prefer splitting dense material across beats over shrinking text.
- Replace metric values, units and source lines together. For a paraphrase or definition, remove literal-quotation styling/attribution that would imply an exact quote.
- For `evidence-focus`, replace the image URL and alt text, then set each focus rectangle's percentage coordinates against that image. `sample-evidence.svg` is a visibly fictional demo; copy it to `assets/mg-evidence-sample.svg` only for demonstrations.
- The annotation retains the approved Book Video styling. Keep copy short enough for one line and place it below the current spoken subtitle. Its original exit is 4 frames at 30fps.
- Templates inherit the host's local font and GSAP runtime. Use the existing sans-serif fallback when Smiley Sans is unavailable.

## Examples and promotion

[`examples/`](../../examples/) keeps case references and promising designs. When promoting one, move the reusable implementation here, replace case-specific content with parameters/placeholders, and point the case documentation to this canonical source. The approved Book Video grid, annotation and A/B transition have been promoted this way.

The locally exported review set is in `renders/index.html` (ignored by Git). It includes a short MP4 for every entry; reusable sources remain in the directories above.
