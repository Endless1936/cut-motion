const shot=select(".seedance-shot");
const result=select(".video-result");
const play=select(".play");
timeline.set(root,{autoAlpha:1},beat.start);
timeline.fromTo(shot,{x:-48,autoAlpha:0},{x:0,autoAlpha:1,duration:.3,ease:"power3.out"},171.966667);
timeline.fromTo(result,{x:48,autoAlpha:0},{x:0,autoAlpha:1,duration:.3,ease:"power3.out"},175.166667);
timeline.fromTo(play,{scale:.72},{scale:1,duration:.3,ease:"back.out(1.3)"},175.216667);
