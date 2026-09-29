const stage=select(".workflow-stage");
const title=select(".workflow-title");
const line=select(".workflow-line");
const steps=select(".step");
const starts=[73.666667,74.566667,75.566667,76.866667,77.7,78.333333];
timeline.set(root,{autoAlpha:1},beat.start);
timeline.from(stage,{y:-28,autoAlpha:0,duration:.32,ease:"power2.out"},beat.start);
timeline.from(title,{x:-26,autoAlpha:0,duration:.28,ease:"power2.out"},71.866667);
steps.forEach((step,i)=>{const t=starts[i];timeline.fromTo(step,{x:-36,autoAlpha:0},{x:0,autoAlpha:1,duration:.28,ease:"power3.out"},t);timeline.to(line,{scaleY:(i+1)/6,duration:.3,ease:"power2.out"},t);});
