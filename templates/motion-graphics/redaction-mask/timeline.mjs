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
