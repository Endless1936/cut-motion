# Faithful reproduction guide

When a user asks for the Book Video look, copy the implementation in this directory. Do not reinterpret it or rebuild it from a screenshot. The CSS, markup, and timeline files are the source of truth; only adapt the destination job's media, beat IDs, copy, and planned times.

## B-axis horizon grid

Copy all three files in [`hyperframes/b-axis-horizon-grid/`](hyperframes/b-axis-horizon-grid/) into `hyperframes/mg/<beat-id>/` as one HyperFrames MG module. Rename the folder and update the fragment's `data-beat-id` to the same ID used by the Beat Map. The `timeline.mjs` expects the builder-provided `root`, `select`, `beat`, and shared paused `timeline` bindings. Keep the fragment's two-plane structure and both standard and WebKit masks.

This is the approved 1080×1920 look. Preserve these values from `style.css`:

- Grid cells: 100px wide by 42px high; lines are 4px, gray `rgba(150, 150, 150, 0.78)`.
- Horizontal phase: `calc(50% + 50px)`, giving a half-cell offset.
- Perspective: `perspective(1500px)` with top `rotateX(-64deg)` and bottom `rotateX(64deg)`.
- The upper and lower planes mirror around the center; the mask fades each toward a clear horizontal horizon band.
- Keep the opposing linear scroll from `timeline.mjs`: 810px over 45.7 seconds (about 17.72px/s). The timeline scales travel with the beat duration to preserve that speed. Do not slow it, blur the lines, increase grid density, or change the row/column periods.

This module provides the background only. Put B-axis content above it and the circular speaker PiP above both; the sample layer order is grid `z-index: 12`, stage content `18`, PiP `40`.

## A-axis ↔ B-axis stage transition

The files in [`hyperframes/axis-stage/`](hyperframes/axis-stage/) implement the speaker move, not the B-axis content or grid. `markup.example.html` is illustrative: merge `.axis-stage-root` and `data-stage="false"` onto the template's existing `#root`, and merge `.axis-stage-speaker` and `data-picture-in-picture="false"` onto its existing direct-child `#a-roll` video. Use `.axis-stage-content` on the existing B-axis content layer. Do not copy the sample wrapper or video, because the template already defines these IDs and media must remain direct children of the composition root. Load the CSS in the shared composition stylesheet, point the existing speaker video to that job's A-axis media, and load `axis-stage-transitions.js` after GSAP. Call it on the existing shared paused timeline:

```js
const compositionRoot = document.querySelector("#root");
const speakerVideo = document.querySelector("#a-roll");
const bAxisIntervals = [[12, 34]];

addAxisStageTransitions(timeline, {
  root: compositionRoot,
  speaker: speakerVideo,
  intervals: bAxisIntervals,
  duration: 0.8,
  frame: { width: 1080, height: 1920 },
  pip: { left: 46, bottom: 184, size: 222 }
});
```

Each interval is `[B-axis start, B-axis end]` in composition seconds. The first 0.8 seconds shrink the full-frame A-axis into the lower-left circular PiP; the final 0.8 seconds reverse the same move. Keep the default `power2.inOut` easing and the same interval for both directions. Compose the B-axis visuals underneath the PiP while `data-stage="true"`.

## Annotation caption

Copy [`hyperframes/mg/mg-annotation-caption/`](hyperframes/mg/mg-annotation-caption/) into `hyperframes/mg/<beat-id>/` once per annotation MG. For each copy, give the module and `data-beat-id` a unique ID, replace the sample wording, and bind its beat to the intended local clause. Keep it separate from the complete spoken caption.

Preserve the one-line centered treatment in `style.css`: 80px Smiley Sans, full composition width, `white-space: nowrap`, warm white, soft shadow, no panel or outline. Keep the 0.18-second upward fade-in and 0.12-second fade-out in `timeline.mjs`. Adjust only the copy and beat timing; avoid narrowing the text box or allowing a final orphaned character to wrap.

## Integrating into a new job

Use the destination job's 1080×1920 composition and its local Smiley Sans font when available (`font-family: "Smiley Sans"`, asset used by Book Video: `assets/fonts/SmileySans-Oblique.ttf`); if that font is unavailable, keep the sans-serif fallback and continue. Use that job's actual media. Add the grid and annotation as MG modules; add the axis transition helper to the shared composition timeline. Resolve intervals from the new edit rather than reusing Book Video timestamps. Then rebuild with `node scripts/build-composition.mjs jobs/<job-id>/hyperframes` and inspect the generated `index.html` to confirm the modules and shared timeline are included before rendering.
