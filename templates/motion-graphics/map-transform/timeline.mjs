timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const source = select(".transform-source")[0], result = select(".transform-result")[0], link = select(".transform-link")[0];
link.dataset.linkAt=result.dataset.at;
Object.assign(link.style,{opacity:"0",visibility:"hidden"});
const panel = select(".transform-panel")[0];
const rectInPanel = element => {
  let x=0,y=0;
  for(let node=element;node&&node!==panel;node=node.offsetParent){x+=node.offsetLeft;y+=node.offsetTop;}
  return {left:x,top:y,right:x+element.offsetWidth,bottom:y+element.offsetHeight};
};
const s = rectInPanel(source), r = rectInPanel(result);
const horizontal = root.dataset.primaryFlowAxis === "horizontal";
Object.assign(link.style, horizontal
  ? { left: (s.right + 8) + "px", right: "auto", top: ((s.top + s.bottom) / 2) + "px", bottom: "auto", width: Math.max(0,r.left - s.right - 16) + "px", height: "3px" }
  : { left: ((s.left + s.right) / 2) + "px", right: "auto", top: (s.bottom + 8) + "px", bottom: "auto", width: "3px", height: Math.max(0,r.top - s.bottom - 16) + "px" });
timeline.fromTo(link, { autoAlpha: 0, [horizontal ? "scaleX" : "scaleY"]: 0, transformOrigin: horizontal ? "left" : "top" }, { autoAlpha: 1, [horizontal ? "scaleX" : "scaleY"]: 1, duration: .24, immediateRender: false }, beat.start + Number(result.dataset.at));
