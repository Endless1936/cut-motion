timeline.set(root, { autoAlpha: 1 }, beat.start);
const tableGrid = select(".table-grid")[0];
if (tableGrid) root.dataset.columns = tableGrid.style.getPropertyValue("--columns").trim() || "2";
// Whole rows appear together; a separately timed result row can reveal cells left to right.
select("[data-at]").forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  const duration = Math.min(.28, Math.max(.04, beat.end - at));
  timeline.fromTo(element, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration, ease: "power3.out", immediateRender: false }, at);
});
