# Book Video motion reference

Reusable HyperFrames references extracted from Book Video, without job media, transcript, or private project state. The code under [`hyperframes/`](hyperframes/) is the implementation source.

- [`b-axis-horizon-grid/`](hyperframes/b-axis-horizon-grid/) builds two mirrored perspective grid planes. The upper and lower planes scroll in opposite directions and fade toward a clear center horizon.
- [`mg-annotation-caption/`](hyperframes/mg/mg-annotation-caption/) adds a short annotation below the regular speech caption. It is supplemental copy; the speech caption remains complete and independent.
- [`axis-stage/`](hyperframes/axis-stage/) moves the full-frame speaker into a circular PiP as A switches to B, then expands the PiP back to full frame as B switches to A.

The font family and 1080×1920 PiP defaults follow the Book Video source. Load that font in the destination job, then change the annotation copy, frame dimensions, PiP position, and interval times as needed. Add the helpers to the existing paused composition timeline; they do not create extra timelines.

For the axis transition, load `axis-stage-transitions.js` after GSAP and call it on the shared timeline:

```js
addAxisStageTransitions(timeline, {
  root: document.querySelector("#root"),
  speaker: document.querySelector("#a-roll"),
  intervals: [[12, 34]],
  duration: 0.8
});
```

Each interval is `[B-axis start, B-axis end]`; replace the sample times with the composition's planned ranges.
