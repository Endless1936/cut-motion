# Book Video motion reference

Reusable HyperFrames references extracted from Book Video, without job media, transcript, or private project state. The code under [`hyperframes/`](hyperframes/) is the implementation source.

For faithful reuse, follow [`REPRODUCTION.md`](REPRODUCTION.md). Treat these source files as the visual baseline; do not redraw the effects from screenshots or substitute a new design.

- [`b-axis-horizon-grid/`](hyperframes/b-axis-horizon-grid/) builds two mirrored perspective grid planes. The upper and lower planes scroll in opposite directions and fade toward a clear center horizon.
- [`mg-annotation-caption/`](hyperframes/mg/mg-annotation-caption/) adds a short annotation below the regular speech caption. It is supplemental copy; the speech caption remains complete and independent.
- [`axis-stage/`](hyperframes/axis-stage/) moves the full-frame speaker into a circular PiP as A switches to B, then expands the PiP back to full frame as B switches to A.

The reference composition is 1080×1920 at 30 fps and uses Smiley Sans (得意黑). The font and footage are intentionally not copied here; use the destination job's local font when available, and keep the sans-serif fallback if it is missing. Keep the reference values unchanged when the user asks for the same look. Change only job-specific copy, media selectors, beat IDs, and timeline intervals. Add motion to the destination's existing paused composition timeline; these examples do not create extra timelines.

For the axis transition, merge the provided classes and stage attributes into the template's existing `#root` and direct-child `#a-roll` video; do not add a second root or video. Load `axis-stage-transitions.js` after GSAP and call it on the shared timeline:

```js
const compositionRoot = document.querySelector("#root");
const speakerVideo = document.querySelector("#a-roll");

addAxisStageTransitions(timeline, {
  root: compositionRoot,
  speaker: speakerVideo,
  intervals: [[12, 34]],
  duration: 0.8
});
```

Each interval is `[B-axis start, B-axis end]`; replace the sample times with the composition's planned ranges.
