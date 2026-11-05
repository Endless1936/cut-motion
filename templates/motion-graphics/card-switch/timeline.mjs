const [outgoing, incoming] = select(".card-switch-image");
const swapAt = beat.start + Number(incoming.dataset.at);
const fanAt = Math.max(beat.start, swapAt - .13);
const settleAt = Math.min(swapAt + .27, beat.exitStartTime ?? beat.end);
const tuckScale = Math.min(.85, incoming.offsetWidth / outgoing.offsetWidth, incoming.offsetHeight / outgoing.offsetHeight);
// Clear the tilted first card's right edge, even if the second image is narrow.
const outgoingRight = outgoing.offsetWidth * .33 + outgoing.offsetHeight * .09;
const incomingRight = incoming.offsetWidth * .38;
const fanRight = Math.max(incoming.offsetWidth * .12, outgoingRight - incomingRight + 60);

timeline.set(root, { autoAlpha: 1 }, beat.start);
timeline.fromTo(outgoing, { autoAlpha: 0, y: 12, zIndex: 2 },
  { autoAlpha: 1, y: 0, duration: Math.min(.13, fanAt - beat.start), immediateRender: false }, beat.start);
timeline.set(incoming, { autoAlpha: 1, zIndex: 1, scale: .68 }, fanAt);
timeline.to(outgoing, { xPercent: -10, y: -42, scale: .86, rotation: -6, duration: swapAt - fanAt }, fanAt);
timeline.to(incoming, { x: fanRight, y: -12, scale: .78, rotation: 5, duration: swapAt - fanAt }, fanAt);
timeline.set(outgoing, { zIndex: 1 }, swapAt);
timeline.set(incoming, { zIndex: 2 }, swapAt);
timeline.to(outgoing, { xPercent: 0, y: 0, scale: tuckScale, rotation: 0, duration: settleAt - swapAt }, swapAt);
timeline.to(incoming, { x: 0, y: 0, scale: 1, rotation: 0, duration: settleAt - swapAt }, swapAt);
timeline.set(outgoing, { autoAlpha: 0 }, settleAt);
