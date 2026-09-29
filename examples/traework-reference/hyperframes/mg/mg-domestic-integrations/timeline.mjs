const bind=select(".bind");
const invoke=select(".invoke");
const plugin=select(".plugin");
timeline.set(root,{autoAlpha:1},beat.start);
timeline.fromTo(bind,{xPercent:-50,x:-54,autoAlpha:0},{xPercent:-50,x:0,autoAlpha:1,duration:.28,ease:"power3.out"},152.866667);
timeline.to(bind,{xPercent:-50,x:-54,autoAlpha:0,duration:.22,ease:"power2.in"},154.766667);
timeline.fromTo(invoke,{xPercent:-50,x:54,autoAlpha:0},{xPercent:-50,x:0,autoAlpha:1,duration:.28,ease:"power3.out"},154.766667);
timeline.to(invoke,{xPercent:-50,x:-54,autoAlpha:0,duration:.22,ease:"power2.in"},156.433333);
timeline.fromTo(plugin,{xPercent:-50,x:54,autoAlpha:0},{xPercent:-50,x:0,autoAlpha:1,duration:.28,ease:"power3.out"},156.433333);
