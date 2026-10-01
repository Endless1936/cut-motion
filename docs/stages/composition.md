# Stage: composition

Load this when `workflow-state.mjs` enters `composition`.

## Enters with

- `state/beat-map.json`, `state/design-system.json`, the creative-confirmation package, and `roughcut/a-roll.mp4`.

## Do

1. Build layout in HTML/CSS and register **one** paused, seek-safe GSAP timeline. Keep `<video>` and `<audio>` as direct children of the composition root.
2. Animate with transforms, opacity, color, and border-radius only. Keep motion deterministic and keep PiP footage moving.
3. Embed 得意黑 when available; otherwise use the sans-serif fallback and measure text in the rendered font at peak bounds.
4. Author each beat under `hyperframes/mg/<beat-id>/` as `fragment.html`, `style.css`, and `timeline.mjs`.
5. Tag the DOM the builder reads: one `data-motion-group` per visual with axis, kind, time, face policy, flow, and topology; `data-information-role` matching the beat map's `supportRole`; `data-motion-role="connector"` with `data-reveal-group`, `data-flow-axis`, `data-color-token`, `data-color-property`; `data-motion-role="indicator"` for icons and status; `data-collision-unit` on composite boxes; `data-overlap-policy="intentional"` on deliberately overlapping units.
6. Start beat roots hidden and reveal them on the shared timeline. Keep shared styles in `index.template.html`.
7. Run `scripts/build-composition.mjs` to generate `hyperframes/index.html`. Add a motion sidecar only when it matches checked HTML and real selectors.
8. Apply the axis rules from [`visual-language.md`](../visual-language.md) and the cadence, typography, spacing, and safe-area rules from [`density-and-layout.md`](../density-and-layout.md).

## Do not

- Put cut-motion diagnostics inside rendered composition HTML or frame capture.
- Install HyperFrames globally — the job-local CLI is the required renderer.
- Use visual failures as a separate validation pass. They are authoring cues; correct the composition.

## Exits with

- `hyperframes/index.html` built by `build-composition.mjs`, recorded as the stage artifact with its hash.

The authored files are the editing source; generated HTML is disposable and the render entrypoint rebuilds from the same source before rendering.
