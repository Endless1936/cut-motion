const gain=select(".gain-shot");
const spend=select(".spend-shot");
const result=select(".cost-result");
timeline.set(root,{autoAlpha:1},beat.start);
timeline.fromTo(gain,{xPercent:-50,x:-48,autoAlpha:0},{xPercent:-50,x:0,autoAlpha:1,duration:.3,ease:"power3.out"},130.2);
timeline.to(gain,{x:-48,autoAlpha:0,duration:.22,ease:"power2.in"},134);
timeline.fromTo(spend,{xPercent:-50,x:48,autoAlpha:0},{xPercent:-50,x:0,autoAlpha:1,duration:.3,ease:"power3.out"},134);
timeline.to(spend,{x:-48,autoAlpha:0,duration:.22,ease:"power2.in"},141.133333);
timeline.fromTo(result,{x:48,autoAlpha:0},{x:0,autoAlpha:1,duration:.3,ease:"power3.out"},141.133333);
