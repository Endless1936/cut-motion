const at = (selector) => {
  const element = select(selector)[0];
  return beat.start + Number(element?.dataset.at ?? 0);
};

const reveal = (selector, duration = 0.48) => {
  const elements = select(selector);
  if (!elements.length) return;
  timeline.fromTo(elements, { autoAlpha: 0, y: 18, scale: 0.97 }, {
    autoAlpha: 1,
    y: 0,
    scale: 1,
    duration,
    ease: "power3.out",
  }, at(selector));
};

timeline.set(root, { autoAlpha: 1 }, beat.start);
reveal(".proof-source", 0.34);
reveal(".proof-reading", 0.58);
reveal(".proof-caption", 0.38);
