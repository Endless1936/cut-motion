timeline.set(root,{autoAlpha:1},beat.start);
const duration=at=>Math.min(.28,Math.max(.04,beat.end-at));
select("[data-at]").forEach(element=>{
  const at=beat.start+Number(element.dataset.at);
  timeline.fromTo(element,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:duration(at),ease:"power3.out",immediateRender:false},at);
});
const rectIn=element=>{
  let x=0,y=0;
  for(let node=element;node&&node!==root;node=node.offsetParent){x+=node.offsetLeft;y+=node.offsetTop;}
  return{x,y,width:element.offsetWidth,height:element.offsetHeight};
};
const svg=select(".factor-wiring")[0];
svg.setAttribute("viewBox",`0 0 ${root.offsetWidth} ${root.offsetHeight}`);
const draw=(d,at)=>{
  const path=root.ownerDocument.createElementNS("http://www.w3.org/2000/svg","path");
  path.setAttribute("d",d);path.setAttribute("pathLength","1");path.dataset.linkAt=String(at-beat.start);
  Object.assign(path.style,{opacity:"0",visibility:"hidden",strokeDasharray:"1",strokeDashoffset:"1"});svg.appendChild(path);
  timeline.fromTo(path,{autoAlpha:0,strokeDashoffset:1},{autoAlpha:1,strokeDashoffset:0,duration:duration(at),ease:"power2.out",immediateRender:false},at);
};
const core=select(".factor-core")[0],result=select(".factor-result")[0],items=select(".factor-item");
const c=rectIn(core),r=rectIn(result),boxes=items.map(rectIn),sx=c.x+c.width/2,sy=c.y+c.height;
const firstRow=Math.min(...boxes.map(b=>b.y)),splitY=sy+34;
const arrow=select(".factor-arrow")[0],coreAt=beat.start+Number(core.dataset.at);
timeline.fromTo(arrow,{autoAlpha:0,x:-6},{autoAlpha:1,x:0,duration:duration(coreAt),immediateRender:false},coreAt);
items.forEach((item,i)=>{
  const b=boxes[i],tx=b.x+b.width/2;
  const path=b.y>firstRow+5
    ?`M ${sx} ${sy} V ${splitY} H 22 V ${b.y-12} H ${tx} V ${b.y-6}`
    :`M ${sx} ${sy} V ${splitY} H ${tx} V ${b.y-6}`;
  draw(path,beat.start+Number(item.dataset.at));
});
const cx=r.x+r.width/2,railY=Math.max(...boxes.map(b=>b.y+b.height))+32,resultAt=beat.start+Number(result.dataset.at);
boxes.forEach(b=>{
  const x=b.x+b.width/2,y=b.y+b.height,rowBottom=Math.max(...boxes.filter(other=>Math.abs(other.y-b.y)<5).map(other=>other.y+other.height));
  draw(boxes.some(other=>other.y>b.y+5)
    ?`M ${x} ${y} V ${rowBottom+14} H ${root.offsetWidth-22} V ${railY} H ${cx}`
    :`M ${x} ${y} V ${railY} H ${cx}`,resultAt);
});
draw(`M ${cx} ${railY} V ${r.y-8} m -6 -6 l 6 6 6 -6`,resultAt);
