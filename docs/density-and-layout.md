# Density and Layout Specification

This document gives measurable layout guidance for the current job's creative plan. Use [`templates/motion-graphics/`](../templates/motion-graphics/README.md) for reusable modules and [caption modes](caption-modes.md) for subtitle-led composition. Motion-copy is planned per job.

## Three rhythm layers

1. **Speech response:** every semantic phrase is covered by captions or designed motion.
2. **Micro-events:** meaningful changes occur every 0.35–0.9 seconds in `motion-copy`; subtitle-mode cadence applies only inside approved local MG.
3. **Major scenes:** layouts normally remain coherent for 1.8–3.5 seconds before a major change.

The layers prevent both failure modes: a static scene with too little happening and a sequence that replaces the entire layout on every phrase.

## Density envelope

Use one focal group and one to four supporting elements. In motion-copy or a B-axis stage, the focal group should occupy 28–65% of the vertical canvas after padding. A-roll overlays stay compact enough to protect the speaker and captions; that occupancy range is not a minimum for a local MG. Support elements should carry meaning: icon, label, live status, track, diagram, progress, or particle response.

## MG cadence target

For subtitle-led plans with discrete MG nodes, start with about six to eight meaningful nodes in a two-minute video, spread across its argument. Add a node when a process, relationship, contrast or result benefits from visualization; ordinary narration can remain caption-only. Keep related phrases in one scene instead of automatically making a new card for each subtitle. This is a content planning target, not a quota, fixed interval or validation threshold. Motion Copy remains one continuous treatment rather than a reason to add separate MG nodes.

If the frame feels empty, enrich the focal idea before adding decoration. If it feels crowded, remove low-priority support before shrinking copy.

## Vertical composition

Calculate the complete background card bounds before playback and keep them fixed during the MG. Progressive speech-bound reveals affect internal content, not the background's width, height or clipping.

- Metadata zone: 5–16% of frame height.
- Primary stage: 22–78%.
- Finale and support zone: 72–94% when it does not conflict with playback controls in the target platform.

These are planning zones for motion-copy and B-axis stages, not rigid rows. A-roll overlays use an upper-middle starting position: 280px (14.58%) on the 1080×1920 canvas. The overall MG and background card remain horizontally centered (`x + width / 2 = 0.5` for normalized bounds); internal alignment is independent. Adjust height and width to avoid captions; eyes and mouth do not need clearance. Tall lists can move upward with compact left-aligned rows inside a centered card; short cards need no full-width empty surface. Templates provide a starting position; adjust the card around the actual caption region.

## Peak-state measurement

Approved templates reuse their implemented bounds. For a custom or resized layout, account for entrance overshoot, rotation, outline and shadows; inspect the affected moment if clipping is uncertain. Separate measurement reports for every animation phase are not required.

## Timing and typography bounds

- Begin each spoken element's entrance on the first frame at or after its keyword onset, using actual word timing. Connected decorations in the same semantic reveal may start together; separate spoken items follow their own onsets.
- In subtitle mode, 0.8–1.8 seconds is only a pacing reference for nonspoken embellishments. Speech determines content intervals even when they are shorter or longer; do not mechanically stagger items, rush ahead of narration or prolong the hold after its meaning ends. Caption-only passages need no animation.
- Reuse the selected template's transition family consistently; vary it when the content benefits, without a repetition quota or reuse justification.
- For 1080×1920 vertical video, primary Chinese copy is normally 84–156 px and secondary copy at least 42 px. Use 0.92–1.12 display line height and 1.15–1.35 body-copy line height.
- Keep 54 px horizontal and 88 px vertical canvas clearance, with 18 px around outlined or transformed glyphs. Panel padding is normally 48–72 px.
- Set Chinese line breaks around complete phrases; keep at least two visible characters on each line when a semantic break is needed.
- Give every panel meaningful copy, an icon, status, diagram, or animated state. Inspect the fully expanded final state at the intended size using [MG final-state self-review](workflow.md#mg-final-state-self-review); inspect other motion phases only for a specific animation issue.

The on-demand `scripts/check-layout-constraints.mjs` is a static source diagnostic. It checks declared layout settings, motion-group and role metadata, connector/container markers, and caption placement/style declarations; it does not measure rendered DOM or judge visual quality. Motion groups use the boolean `data-motion-group` marker and `data-topology` attribute from the authoring contract.

## Visual review guidance

Use the reusable motion templates for their supported content relationships. HTML final-state snapshots support the Agent's routine MG self-review before export; the rendered MP4 is the user handoff. Additional windows or full audits address specific visual questions. `auto` follows the same self-review and the checks listed in `docs/quality-gates.md`.

Keep meaningful content at the intended scale and remove excess decoration before reducing its clarity.
