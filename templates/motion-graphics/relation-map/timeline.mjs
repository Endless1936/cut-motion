timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const rectIn = element => {
  let x=0,y=0;
  for(let node=element;node&&node!==root;node=node.offsetParent){x+=node.offsetLeft;y+=node.offsetTop;}
  return { x,y,width:element.offsetWidth,height:element.offsetHeight };
};
const svg = select(".map-wiring")[0];
const makePath = (d, at, parent = svg) => {
  const path = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("pathLength", "1");
  path.dataset.linkAt=String(at-beat.start);
  Object.assign(path.style,{opacity:"0",visibility:"hidden",strokeDasharray:"1",strokeDashoffset:"1"});
  parent.appendChild(path);
  timeline.fromTo(path, { strokeDasharray: 1, strokeDashoffset: 1, autoAlpha: 0 }, { strokeDashoffset: 0, autoAlpha: 1, duration: duration(at), ease: "power2.out", immediateRender: false }, at);
};
svg.setAttribute("viewBox", `0 0 ${root.offsetWidth} ${root.offsetHeight}`);
select(".map-path").forEach(path => path.remove());
const source = rectIn(select(".map-source")[0]);
const targets=select(".map-target"), boxes=targets.map(rectIn);
const firstRow=Math.min(...boxes.map(b=>b.y));
targets.forEach((target,index) => {
  const t = boxes[index], sx = source.x + source.width / 2, sy = source.y + source.height;
  const tx = t.x + t.width / 2, y = sy + 38;
  const vertical=root.dataset.layout==="vertical", left=t.x-24, ty=t.y+t.height/2;
  const route=vertical
    ? `M ${sx} ${sy} V ${y} H ${left} V ${ty} H ${t.x-7} m -6 -6 l 6 6 -6 6`
    : t.y>firstRow+5
      ? `M ${sx} ${sy} V ${y} H 20 V ${t.y-10} H ${tx} V ${t.y-7} m -6 -6 l 6 6 6 -6`
      : `M ${sx} ${sy} V ${y} H ${tx} V ${t.y - 7} m -6 -6 l 6 6 6 -6`;
  makePath(route, beat.start + Number(target.dataset.at));
});
