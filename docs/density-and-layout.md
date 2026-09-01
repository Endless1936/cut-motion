# Density and Layout Specification

This document converts the mode-appropriate reference into measurable planning constraints. Use `examples/traework-reference` for subtitle-led work and `examples/gold-standard` for motion-copy work. It does not replace visual judgment.

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

Record bounds for entrance, maximum overshoot, hold, and exit. Rotation, outline, shadow, blur, and scale all count toward occupied space. A scene fails when transformed glyphs clip even if the resting frame is clean.

Runtime layout checks must use the rendered DOM, not only planned dimensions. They also enforce the caption safe-zone ratio, forbid generic outlined containers and decorative labels, and keep synchronized connector/container reveals within the design-system frame tolerance.

## Review matrix

For every visual scene, inspect the states required by `docs/quality-gates.md`. Do not expand pure-caption beats into per-beat snapshot sets.

Compare the grid with the mode-appropriate reference. For subtitle-led work use `examples/traework-reference`; for motion-copy work use `examples/gold-standard`. Reject scenes that are materially smaller, emptier, dirtier, or more crowded without a semantic reason.
