# Density and Layout Specification

This document gives measurable layout guidance for the available references and each job's creative plan. Use `examples/traework-reference/` for subtitle-led structure and [`templates/motion-graphics/`](../templates/motion-graphics/README.md) for reusable modules; [`examples/book-video-reference/`](../examples/book-video-reference/) documents the original case and integration. Motion-copy is planned per job; the repository does not maintain a complete motion-copy reference composition.

## Three rhythm layers

1. **Speech response:** every semantic phrase is covered by captions or designed motion.
2. **Micro-events:** meaningful changes occur every 0.35–0.9 seconds in `motion-copy`; subtitle-mode cadence applies only inside approved local MG.
3. **Major scenes:** layouts normally remain coherent for 1.8–3.5 seconds before a major change.

The layers prevent both failure modes: a static scene with too little happening and a sequence that replaces the entire layout on every phrase.

## Density envelope

Use one focal group and one to four supporting elements. The focal group should occupy 28–65% of the vertical canvas after padding. Support elements should carry meaning: icon, label, live status, track, diagram, progress, or particle response.

If the frame feels empty, enrich the focal idea before adding decoration. If it feels crowded, remove low-priority support before shrinking copy.

## Vertical composition

- Metadata zone: 5–16% of frame height.
- Primary stage: 22–78%.
- Finale and support zone: 72–94% when it does not conflict with playback controls in the target platform.

These are planning zones, not rigid rows. Primary text should not default to the metadata zone.

## Peak-state measurement

Approved templates reuse their implemented bounds. For a custom or resized layout, account for entrance overshoot, rotation, outline and shadows; inspect the affected moment if clipping is uncertain. Separate measurement reports for every animation phase are not required.

## Timing and typography bounds

- Begin phrase motion within three frames of its acoustic onset; anchor the first meaningful event to a spoken word within 400ms. Connected elements in one reveal group start within two frames.
- In subtitle mode, use 0.8–1.8 seconds as a spacing guide for meaningful micro-events inside approved local MG; trigger each event from speech or meaning, not a fixed timer. Caption-only passages need no animation.
- Reuse the selected template's transition family consistently; vary it when the content benefits, without a repetition quota or reuse justification.
- For 1080×1920 vertical video, primary Chinese copy is normally 84–156 px and secondary copy at least 42 px. Use 0.92–1.12 display line height and 1.15–1.35 body-copy line height.
- Keep 54 px horizontal and 88 px vertical canvas clearance, with 18 px around outlined or transformed glyphs. Panel padding is normally 48–72 px.
- Set Chinese line breaks around complete phrases; keep at least two visible characters on each line when a semantic break is needed.
- Give every panel meaningful copy, an icon, status, diagram, or animated state. Check the entrance, peak, hold, and exit at the rendered size.

The on-demand `scripts/check-layout-constraints.mjs` is a static source diagnostic. It checks declared layout settings, motion-group and role metadata, connector/container markers, and caption placement/style declarations; it does not measure rendered DOM or judge visual quality. Motion groups use the boolean `data-motion-group` marker and `data-topology` attribute from the authoring contract.

## Visual review guidance

Use the code-backed examples for the components they demonstrate. The rendered MP4 is the review handoff; capture a still or window only for a specific visual question. `auto` runs only the checks listed in `docs/quality-gates.md`.

Keep meaningful content at the intended scale and remove excess decoration before reducing its clarity.
