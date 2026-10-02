timeline.set(root, { autoAlpha: 1 }, beat.start);

const progress = select(".rail-progress")[0];
timeline.set(progress, { scaleY: 0, transformOrigin: "top center" }, beat.start);

const steps = select(".step");
steps.forEach((step, index) => {
  const at = beat.start + Number(step.dataset.at);
  timeline.fromTo(step,
    { x: -22, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.42, ease: "power3.out" },
    at);
  if (index > 0) {
    timeline.to(progress,
      { scaleY: index / (steps.length - 1), duration: 0.3, ease: "power1.out" },
      at - 0.18);
  }
});
