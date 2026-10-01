# Default Technology Stack

- **ChatCut** — editable rough cut and preferred transcription surface.
- **FFmpeg / FFprobe** — media probing, silence diagnosis, precision trims, and delivery verification.
- **HyperFrames** — HTML composition timing, validation, preview, and rendering.
- **HTML / CSS** — visual structure, typography, panels, diagrams, and decorative systems.
- **GSAP** — seek-safe timeline choreography, transforms, easing, stagger, and depth.

Remotion and Vibe Motion are optional adapters, not default dependencies.

## HyperFrames composition contract

- Build the composition in HTML/CSS and register one paused, seek-safe GSAP timeline. Keep `<video>` and `<audio>` as direct children of the composition root; keep PiP footage moving.
- Embed 得意黑 when its local font file is available; otherwise use the sans-serif fallback. Measure text in the font that will render.
- Author each beat in `hyperframes/mg/<beat-id>/` with `fragment.html`, `style.css`, and `timeline.mjs`. Use one `data-motion-group` per visual and declare its axis, kind, time, face policy, flow, and topology.
- Mark labels with their `data-information-role`; connectors with `data-motion-role="connector"`, reveal group, flow axis, and color token/property; indicators and collision units with their roles. Mark only the exact intentional overlap with `data-overlap-policy="intentional"`.
- Start beat roots hidden and reveal them on the shared timeline. Keep shared styles in `index.template.html`; run `scripts/build-composition.mjs` to rebuild `hyperframes/index.html` before rendering.
