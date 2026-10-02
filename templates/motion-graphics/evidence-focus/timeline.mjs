timeline.set(root, { autoAlpha: 1 }, beat.start);
timeline.fromTo(select(".evidence-surface"), { y: 24, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, beat.start);
const focusRegions = select(".evidence-focus");
focusRegions.forEach((region, index) => {
  const at = beat.start + Number(region.dataset.at);
  timeline.fromTo(region, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power2.out", immediateRender: false }, at);
  if (index > 0) timeline.to(focusRegions[index - 1], { opacity: 0, duration: 0.18 }, at);
});
