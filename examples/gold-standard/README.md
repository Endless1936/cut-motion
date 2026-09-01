# Gold-standard example

This example preserves the source composition and design logic of the successful 33.9-second `motion-copy` reference video.

For `captionMode: subtitles`, use [`examples/traework-reference`](../traework-reference/) and [`recipes/traework-subtitles.json`](../../recipes/traework-subtitles.json) instead. This example intentionally keeps the high-density motion-copy behavior: spoken wording is designed into the animation and there is no separate subtitle layer.

It is included to prevent visual drift, not to become a universal template. New projects should reuse its motion grammar and quality thresholds while redesigning each sentence for the new meaning.

## Included

- HyperFrames HTML and timing sidecar.
- Scene map and visual breakdown.
- Four compressed reference frames.

## Excluded

- Original talking-head footage and audio.
- Final rendered MP4.
- GSAP binary and font files.

To run the composition, provide `hyperframes/assets/input-video.mp4`, `hyperframes/assets/gsap.min.js`, and the licensed font named in `hyperframes/assets/README.md`.

The reference frames contain the original creator's likeness and are included with permission as visual QA material.
