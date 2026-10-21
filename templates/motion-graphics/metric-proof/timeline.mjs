timeline.set(root, { autoAlpha: 1 }, beat.start);
// Fit long readings once, before animation; the panel never changes its bounds.
const metricValue = select(".proof-value")[0];
const metricUnit = select(".proof-unit")[0];
const glyphWidth = text => [...text].reduce((sum, char) => sum + (/[\u2e80-\uffff]/u.test(char) ? 1 : /[MW@]/u.test(char) ? .82 : .57), 0);
if (metricValue) {
  const available = (root.clientWidth || 950) - 82 - (metricUnit ? Math.min(260, glyphWidth(metricUnit.textContent) * 44) + 18 : 0);
  const size = Math.max(48, Math.min(126, available / Math.max(1, glyphWidth(metricValue.textContent))));
  root.style.setProperty("--proof-value-size", `${size}px`);
}
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
