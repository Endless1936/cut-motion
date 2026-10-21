timeline.set(root, { autoAlpha: 1 }, beat.start);
// Numeric text receives a stable size before the reveal, without a count-up.
const weightedWidth = text => [...text].reduce((sum, char) => sum + (/[\u2e80-\uffff]/u.test(char) ? 1 : /[MW@]/u.test(char) ? .82 : .57), 0);
select(".metric-row").forEach(row => {
  const reading = row.querySelector(".metric-reading");
  const value = row.querySelector(".metric-value");
  const unit = row.querySelector(".metric-unit");
  if (!reading || !value) return;
  const emphasized = row.classList.contains("metric-emphasis");
  const baseSize = emphasized ? 72 : 58;
  const unitSize = emphasized ? 32 * 72 / 58 : 32;
  const budget = (reading.clientWidth || 600) - (unit ? Math.min(280, weightedWidth(unit.textContent) * unitSize) + 10 : 0);
  const size = Math.max(38, Math.min(baseSize, budget / Math.max(1, weightedWidth(value.textContent))));
  row.style.setProperty("--metric-value-size", `${size}px`);
});
select("[data-at]").forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  const duration = Math.min(.28, Math.max(.04, beat.end - at));
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration, ease: "power3.out", immediateRender: false }, at);
});
