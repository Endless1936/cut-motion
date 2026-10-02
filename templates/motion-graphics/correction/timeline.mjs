const at = (selector) => {
  const element = select(selector)[0];
  return beat.start + Number(element?.dataset.at ?? 0);
};

const reveal = (selector, offsetY = 16, duration = 0.42) => {
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
reveal(".correction-old", 12, 0.38);
const strike = select(".correction-strike");
timeline.fromTo(strike, { autoAlpha: 1, scaleX: 0 }, {
  autoAlpha: 1,
  scaleX: 1,
  duration: 0.32,
  ease: "power2.inOut",
}, at(".correction-strike"));
reveal(".correction-new", 20, 0.5);
