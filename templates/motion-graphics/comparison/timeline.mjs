const at = (selector) => {
  const element = select(selector)[0];
  return beat.start + Number(element?.dataset.at ?? 0);
};

const reveal = (selector, offsetY = 18, duration = 0.42) => {
  const elements = select(selector);
  if (!elements.length) return;
  timeline.fromTo(elements, { autoAlpha: 0, y: offsetY }, {
    autoAlpha: 1,
    y: 0,
    duration,
    ease: "power3.out",
  }, at(selector));
};

timeline.set(root, { autoAlpha: 1 }, beat.start);
reveal(".compare-topic", 12, 0.34);
reveal(".compare-left", 20, 0.44);
reveal(".compare-right", 20, 0.44);
reveal(".compare-left .compare-value", 12, 0.34);
reveal(".compare-right .compare-value", 12, 0.34);
