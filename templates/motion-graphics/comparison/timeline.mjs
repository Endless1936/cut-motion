timeline.set(root, { autoAlpha: 1 }, beat.start);
// Shared grid rows align corresponding values even when one side wraps.
const comparisonGrid = select(".compare-grid")[0];
const comparisonSides = select(".compare-side");
comparisonGrid?.style.setProperty("--compare-rows", Math.max(2, ...comparisonSides.map(side => side.children.length)));
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
