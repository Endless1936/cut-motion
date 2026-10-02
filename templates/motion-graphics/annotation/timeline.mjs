timeline.fromTo(root,
  { y: 8, autoAlpha: 0 },
  { y: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out", immediateRender: false },
  beat.start);
// Set exitFrames to 4 at 30fps for the original short exit; builder owns it.
