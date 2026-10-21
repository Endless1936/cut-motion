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
  timeline.to(marker,{backgroundColor:"rgba(169,189,255,.2)",borderColor:"rgba(169,189,255,.6)",duration:.2},at);
  if(index)timeline.to(steps[index-1].querySelector(".step-number"),{backgroundColor:"rgba(169,189,255,.08)",borderColor:"rgba(169,189,255,.28)",duration:.2},at);
});
