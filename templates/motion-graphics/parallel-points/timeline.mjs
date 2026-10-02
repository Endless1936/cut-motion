timeline.set(root, { autoAlpha: 1 }, beat.start);

select(".point").forEach((point) => {
  const at = beat.start + Number(point.dataset.at);
  timeline.fromTo(point,
    { x: -18, autoAlpha: 0 },
    { x: 0, autoAlpha: 1, duration: 0.4, ease: "power3.out" },
    at);
});
