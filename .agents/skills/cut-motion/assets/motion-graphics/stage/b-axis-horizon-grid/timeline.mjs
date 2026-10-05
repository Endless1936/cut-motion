const top = select(".book-video-grid-top");
const bottom = select(".book-video-grid-bottom");
const travel = (810 / 45.7) * beat.duration;

timeline.fromTo(root, { autoAlpha: 0 }, { autoAlpha: 0.82, duration: 0.8, ease: "power2.out", immediateRender: false }, beat.start);
timeline.fromTo(top,
  { "--grid-scroll-offset": "0px" },
  { "--grid-scroll-offset": `${travel}px`, duration: beat.duration, ease: "none", immediateRender: false },
  beat.start);
timeline.fromTo(bottom,
  { "--grid-scroll-offset": "0px" },
  { "--grid-scroll-offset": `${-travel}px`, duration: beat.duration, ease: "none", immediateRender: false },
  beat.start);
// The composition builder supplies the final exit from the Beat Map.
