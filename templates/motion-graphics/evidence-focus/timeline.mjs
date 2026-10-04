timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  // Keep the focus region anchored to image coordinates, including during entry.
  timeline.fromTo(element, { autoAlpha: 0 }, { autoAlpha: 1, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const surface = select(".evidence-surface")[0], canvas = select(".evidence-canvas")[0], regions = select(".evidence-focus");
regions.forEach((region, index) => {
  const at = beat.start + Number(region.dataset.at);
  const center = (parseFloat(region.style.top) + parseFloat(region.style.height) / 2) / 100 * canvas.offsetHeight;
  const y = -Math.min(Math.max(0, center - surface.clientHeight / 2), Math.max(0, canvas.offsetHeight - surface.clientHeight));
  timeline.to(canvas, { y, duration: .28, ease: "power2.inOut" }, at);
  if (index) timeline.to(regions[index - 1], { autoAlpha: 0, duration: .16 }, at);
});
