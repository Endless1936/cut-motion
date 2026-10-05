timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const strike = select(".correction-strike")[0], at = beat.start + Number(strike.dataset.at);
timeline.fromTo(strike, { scaleX: 0, transformOrigin: "left" }, { scaleX: 1, duration: duration(at), ease: "power2.out", immediateRender: false }, at);
