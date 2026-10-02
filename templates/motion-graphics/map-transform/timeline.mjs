timeline.set(root, {autoAlpha:1}, beat.start);
const source = select('.transform-source')[0];
const result = select('.transform-result')[0];
const sourceAt = beat.start + Number(source.dataset.at);
const resultAt = beat.start + Number(result.dataset.at);
timeline.fromTo(source,{autoAlpha:0,y:-14},{autoAlpha:1,y:0,duration:.32,ease:'power3.out'},sourceAt);
timeline.fromTo(select('.transform-link i'),{scaleY:0,transformOrigin:'top'},{scaleY:1,duration:.35,ease:'power2.out'},Math.max(sourceAt,resultAt-.45));
timeline.fromTo(select('.transform-link span'),{autoAlpha:0,y:-12},{autoAlpha:1,y:0,duration:.25,ease:'power2.out'},Math.max(sourceAt,resultAt-.25));
timeline.fromTo(result,{autoAlpha:0,y:12},{autoAlpha:1,y:0,duration:.32,ease:'power3.out'},resultAt);
