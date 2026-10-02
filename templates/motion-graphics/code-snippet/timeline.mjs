const at = (selector) => {
  const element = select(selector)[0];
  return beat.start + Number(element?.dataset.at ?? 0);
};

const reveal = (selector, duration = 0.34) => {
  const elements = select(selector);
  if (!elements.length) return;
  timeline.fromTo(elements, { autoAlpha: 0, x: 14 }, {
    autoAlpha: 1,
    x: 0,
    duration,
    ease: "power2.out",
  }, at(selector));
};

timeline.set(root, { autoAlpha: 1 }, beat.start);
reveal(".code-label", 0.3);
for (const line of select(".code-line")) {
  const lineStart = beat.start + Number(line.dataset.at ?? 0);
  timeline.fromTo(line, { autoAlpha: 0, x: 14 }, {
    autoAlpha: 1,
    x: 0,
    duration: 0.34,
    ease: "power2.out",
  }, lineStart);
}
