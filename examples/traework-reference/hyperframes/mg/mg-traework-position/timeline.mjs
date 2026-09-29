const stage=select(".stage"),panel=select(".relation-panel"),nodes=select(".node"),arrow=select(".arrow"),noApi=select(".no-api"),shot=select(".model-shot");
timeline.set(root,{autoAlpha:1},beat.start);
timeline.fromTo(stage,{y:-36,autoAlpha:0},{y:0,autoAlpha:1,duration:.35},beat.start);
timeline.fromTo(nodes,{x:(i)=>i?50:-50,autoAlpha:0},{x:0,autoAlpha:1,stagger:.2,duration:.42},beat.start);
timeline.fromTo(arrow,{scaleX:0,autoAlpha:0},{scaleX:1,autoAlpha:1,duration:.32},22.1);
timeline.fromTo(noApi,{y:-18,autoAlpha:0},{y:0,autoAlpha:1,duration:.3},beat.start);
timeline.to(panel,{autoAlpha:0,duration:.24},24.646668);
timeline.fromTo(shot,{x:54,autoAlpha:0},{x:0,autoAlpha:1,duration:.34,ease:"power3.out"},24.646668);
