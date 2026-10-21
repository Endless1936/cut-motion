timeline.set(root,{autoAlpha:1},beat.start);
const duration=at=>Math.min(.32,Math.max(.04,beat.end-at));
const title=select(".growth-title")[0],result=select(".growth-result")[0];
[title,result].filter(Boolean).forEach(element=>{
  const at=beat.start+Number(element.dataset.at);
  timeline.fromTo(element,{autoAlpha:0,y:8},{autoAlpha:1,y:0,duration:duration(at),ease:"power3.out",immediateRender:false},at);
});
const chart=select(".growth-chart")[0],items=select(".growth-item"),axes=select(".growth-axes")[0],line=select(".growth-line")[0];
const width=chart.offsetWidth,height=chart.offsetHeight,baseline=height-64;
axes.setAttribute("viewBox",`0 0 ${width} ${height}`);line.setAttribute("viewBox",`0 0 ${width} ${height}`);
const svgElement=(name,attributes,parent)=>{
  const element=root.ownerDocument.createElementNS("http://www.w3.org/2000/svg",name);
  Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,String(value)));parent.appendChild(element);return element;
};
svgElement("path",{d:`M 24 8 V ${baseline} H ${width-8}`},axes);
const values=items.map(item=>Math.max(0,Number(item.dataset.value)||0)),max=Math.max(...values,0);
const points=items.map((item,index)=>{
  const shell=item.querySelector(".growth-bar-shell"),bar=item.querySelector(".growth-bar");
  const barHeight=max?values[index]/max*shell.offsetHeight:0;
  item.style.setProperty("--bar-height",`${barHeight}px`);
  if(values[index]===0)bar.style.borderWidth="0";
  const at=beat.start+Number(item.dataset.at),column=item.offsetParent;
  timeline.fromTo(item,{autoAlpha:0},{autoAlpha:1,duration:.16,immediateRender:false},at);
  timeline.fromTo(bar,{scaleY:0},{scaleY:1,duration:duration(at),ease:"power2.out",immediateRender:false},at);
  return{x:column.offsetLeft+item.offsetLeft+item.offsetWidth/2,y:baseline-barHeight,at};
});
points.forEach((point,index)=>{
  if(index){
    const previous=points[index-1],path=svgElement("path",{d:`M ${previous.x} ${previous.y} L ${point.x} ${point.y}`,pathLength:1},line);
    path.dataset.linkAt=String(point.at-beat.start);Object.assign(path.style,{opacity:"0",visibility:"hidden",strokeDasharray:"1",strokeDashoffset:"1"});
    timeline.fromTo(path,{autoAlpha:0,strokeDashoffset:1},{autoAlpha:1,strokeDashoffset:0,duration:duration(point.at),ease:"power2.out",immediateRender:false},point.at);
  }
  const dot=svgElement("circle",{cx:point.x,cy:point.y,r:5},line);
  dot.style.opacity="0";dot.style.visibility="hidden";
  timeline.fromTo(dot,{autoAlpha:0},{autoAlpha:1,duration:.16,immediateRender:false},point.at+.1);
});
