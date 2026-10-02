timeline.set(root, { autoAlpha: 1 }, beat.start);

const source = select(".map-source")[0];
timeline.fromTo(source,
  { y: -14, autoAlpha: 0 },
  { y: 0, autoAlpha: 1, duration: 0.38, ease: "power3.out" },
  beat.start + Number(source.dataset.at));

const stem = select(".map-stem")[0];
const branch = select(".map-branch")[0];
const sourceAt = beat.start + Number(source.dataset.at);
timeline.set(stem, { scaleY: 0, transformOrigin: "top center" }, beat.start);
timeline.set(branch, { scaleX: 0, transformOrigin: "center" }, beat.start);
timeline.to(stem, { scaleY: 1, duration: 0.24, ease: "power2.out" }, sourceAt + 0.34);
timeline.to(branch, { scaleX: 1, duration: 0.34, ease: "power2.out" }, sourceAt + 0.54);

const drops = select(".map-drop");
const targets = select(".map-target");
targets.forEach((target, index) => {
  timeline.set(drops[index], { scaleY: 0, transformOrigin: "top center" }, beat.start);
  const at = beat.start + Number(target.dataset.at);
  timeline.to(drops[index], { scaleY: 1, duration: 0.22, ease: "power2.out" }, at - 0.22);
  timeline.fromTo(target,
    { y: 14, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.38, ease: "power3.out" },
    at);
});
