timeline.set(root, { autoAlpha: 1 }, beat.start);
const elements = select("[data-at]");
const duration = at => Math.min(.28, Math.max(.04, beat.end - at));
elements.forEach(element => {
  const at = beat.start + Number(element.dataset.at);
  timeline.fromTo(element, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration(at), ease: "power3.out", immediateRender: false }, at);
});
const rectIn = element => {
  const base = root.getBoundingClientRect(), r = element.getBoundingClientRect();
  return { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
};
const svg = select("svg")[0];
const makePath = (d, at, parent = svg) => {
  const path = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d); path.setAttribute("fill", "none"); path.setAttribute("pathLength", "1");
  path.dataset.linkAt=String(at-beat.start);
  Object.assign(path.style,{opacity:"0",visibility:"hidden",strokeDasharray:"1",strokeDashoffset:"1"});
  parent.appendChild(path);
  timeline.fromTo(path, { strokeDasharray: 1, strokeDashoffset: 1, autoAlpha: 0 }, { strokeDashoffset: 0, autoAlpha: 1, duration: duration(at), ease: "power2.out", immediateRender: false }, at);
};
svg.setAttribute("viewBox", `0 0 ${root.offsetWidth} ${root.offsetHeight}`);
select(".converge-branches, .converge-collector").forEach(node => node.remove());
const inputs = select(".converge-inputs h3"), result = select(".converge-result")[0];
const r = rectIn(result), cx = r.x + r.width / 2;
const railY = Math.max(...inputs.map(node => { const b = rectIn(node); return b.y + b.height; })) + 40;
inputs.forEach(node => {
  const b = rectIn(node), x = b.x + b.width / 2, y = b.y + b.height;
  const rowBottom=Math.max(...inputs.map(rectIn).filter(other=>Math.abs(other.y-b.y)<5).map(other=>other.y+other.height));
  const route=inputs.some(other=>rectIn(other).y>b.y+5)
    ? `M ${x} ${y} V ${rowBottom+9} H ${root.offsetWidth-4} V ${railY} H ${cx}`
    : `M ${x} ${y} V ${railY} H ${cx}`;
  makePath(route, beat.start + Number(node.dataset.at));
});
makePath(`M ${cx} ${railY} V ${r.y - 12} m -8 -8 l 8 8 8 -8`, beat.start + Number(result.dataset.at));
