timeline.fromTo(root,
  { y: 8, autoAlpha: 0 },
  { y: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out", immediateRender: false },
  beat.start);
timeline.to(root, { autoAlpha: 0, duration: 0.12, ease: "power1.in" }, beat.end - 0.12);
