timeline.set(root, { autoAlpha: 1 }, beat.start);

const progress = select(".flow-line-progress")[0];
timeline.set(progress, { scaleX: 0, transformOrigin: "left center" }, beat.start);

const nodes = select(".flow-node");
nodes.forEach((node, index) => {
  const at = beat.start + Number(node.dataset.at);
  timeline.fromTo(node,
    { y: 18, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.4, ease: "back.out(1.5)" },
    at);
  if (index > 0) {
    timeline.to(progress,
      { scaleX: index / (nodes.length - 1), duration: 0.3, ease: "power1.out" },
      at - 0.18);
  }
});
