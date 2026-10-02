const at = (selector) => {
  const element = select(selector)[0];
  return beat.start + Number(element?.dataset.at ?? 0);
};

const reveal = (selector, offsetY = 18, duration = 0.48) => {
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
const rule = select(".quote-rule");
timeline.fromTo(rule, { autoAlpha: 1, scaleY: 0 }, {
  autoAlpha: 1,
  scaleY: 1,
  duration: 0.46,
  ease: "power2.out",
}, at(".quote-rule"));
reveal(".quote-copy", 14, 0.55);
reveal(".quote-credit", 10, 0.36);
