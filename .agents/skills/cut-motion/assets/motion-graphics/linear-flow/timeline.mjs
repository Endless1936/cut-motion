timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const vertical = root.dataset.primaryFlowAxis === "vertical";
select(".flow-link").forEach(link => {
  link.dataset.linkAt=link.closest("[data-at]").dataset.at;
  const at = beat.start + Number(link.closest("[data-at]").dataset.at);
  timeline.fromTo(link, { [vertical ? "scaleY" : "scaleX"]: 0, transformOrigin: vertical ? "top" : "left" }, { [vertical ? "scaleY" : "scaleX"]: 1, duration: duration(at), immediateRender: false }, at);
});
select(".flow-node").forEach((node,index,nodes)=>{
  const at=beat.start+Number(node.dataset.at);
  timeline.to(node.querySelector(".flow-orb"),{borderColor:"#FFD15C",duration:.18},at);
  if(index)timeline.to(nodes[index-1].querySelector(".flow-orb"),{borderColor:"#7DF2C4",duration:.18},at);
});
