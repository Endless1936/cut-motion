timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});

// The backplate uses its final bounds from the first frame; only content reveals.
select(".step-link").forEach(link => {
  link.dataset.linkAt=link.closest("[data-at]").dataset.at;
  const at = beat.start + Number(link.closest("[data-at]").dataset.at);
  timeline.fromTo(link, { scaleY: 0, transformOrigin: "top" }, { scaleY: 1, duration: duration(at), immediateRender: false }, at);
});
select(".step").forEach((step,index,steps)=>{
  const marker=step.querySelector(".step-number"),at=beat.start+Number(step.dataset.at);
  timeline.to(marker,{color:"#FFD15C",borderColor:"#FFD15C",duration:.18},at);
  if(index)timeline.to(steps[index-1].querySelector(".step-number"),{color:"#7DF2C4",borderColor:"#7DF2C4",duration:.18},at);
});
