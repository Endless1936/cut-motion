timeline.set(root,{autoAlpha:1},beat.start);
select(".redaction-region").forEach(mask=>{
  timeline.set(mask,{autoAlpha:0},beat.start);
  const opacity=Number(mask.dataset.opacity);
  JSON.parse(mask.dataset.windows).forEach(([start,covered,out,clear])=>{
    timeline.fromTo(mask,{autoAlpha:0},{autoAlpha:opacity,duration:covered-start,ease:"none",immediateRender:false},beat.start+start);
    timeline.to(mask,{autoAlpha:0,duration:clear-out,ease:"none",immediateRender:false},beat.start+out);
    timeline.set(mask,{autoAlpha:0,immediateRender:false},beat.start+clear);
  });
});
select(".redaction-rect[data-positions]").forEach(rect=>{
  let previous = { time:0, left:rect.style.left, top:rect.style.top };
  for (const [time,left,top] of JSON.parse(rect.dataset.positions)) {
    const at = beat.start + previous.time;
    if (time === 0) timeline.set(rect,{left,top},at);
    else timeline.fromTo(rect,{left:previous.left,top:previous.top},
      {left,top,duration:time-previous.time,ease:"none",immediateRender:false},at);
    previous = {time,left,top};
  }
});
