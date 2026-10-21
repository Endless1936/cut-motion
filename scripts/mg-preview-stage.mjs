import fs from "node:fs";
import path from "node:path";

export const stagePreviewNames = ["b-axis-horizon-grid", "axis-stage-transition"];

// Deliberately abstract demonstration artwork; no private footage or project assets.
export const stageSpeakerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="#263751"/><stop offset="1" stop-color="#0d1525"/></linearGradient><linearGradient id="shirt" x2="1" y2="1"><stop stop-color="#7d97d4"/><stop offset="1" stop-color="#344d80"/></linearGradient></defs><path fill="url(#back)" d="M0 0h1080v1920H0z"/><path fill="none" stroke="#a9bdff15" stroke-width="2" d="M90 240h900M90 480h900M90 1440h900M240 100v1720M840 100v1720"/><ellipse cx="540" cy="1850" rx="500" ry="650" fill="url(#shirt)"/><rect x="444" y="1010" width="192" height="300" rx="90" fill="#b8c7e4"/><ellipse cx="540" cy="825" rx="244" ry="330" fill="#d0daee"/><path d="M292 786c-38-261 64-415 242-415 215 0 306 213 249 430-12-169-58-204-98-243-88 98-230 151-393 166Z" fill="#18243d"/><path d="M403 845h83m106 0h83" stroke="#405575" stroke-width="14" stroke-linecap="round"/><path d="M495 1012q45 28 90 0" fill="none" stroke="#7f91ae" stroke-width="10" stroke-linecap="round"/><text x="540" y="1580" fill="#dce5f9" text-anchor="middle" font-size="60" font-family="sans-serif">A · DEMO</text></svg>`;

export function stagePreviewPage(name, rootPath, fontName) {
  const folder = path.join(rootPath, "templates/motion-graphics/stage");
  const gridFragment = fs.readFileSync(path.join(folder, "b-axis-horizon-grid/fragment.html"), "utf8");
  const gridStyle = fs.readFileSync(path.join(folder, "b-axis-horizon-grid/style.css"), "utf8");
  const gridTimeline = fs.readFileSync(path.join(folder, "b-axis-horizon-grid/timeline.mjs"), "utf8");
  const axisStyle = fs.readFileSync(path.join(folder, "axis-stage-transition/axis-stage.css"), "utf8");
  const axisScript = fs.readFileSync(path.join(folder, "axis-stage-transition/axis-stage-transitions.js"), "utf8");
  const transition = name === "axis-stage-transition";
  return `<!doctype html><meta charset="utf-8"><style>
  ${fontName ? `@font-face{font-family:"Smiley Sans";src:url("assets/${fontName}")}` : ""}
  html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#050505;color:#f4f5f8;font-family:"Smiley Sans",sans-serif}
  #canvas{position:relative;width:1080px;height:1920px;overflow:hidden}
  ${axisStyle}\n${gridStyle}
  .demo-schematic{position:absolute;left:66px;right:66px;top:460px;height:590px;border:1px solid #c1d3ff33;border-radius:32px;background:#142037dd;display:grid;align-content:center;gap:34px;padding:44px;box-sizing:border-box;z-index:18}
  .demo-title{text-align:center;font-size:46px;color:#dce5f9}
  .demo-nodes{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
  .demo-node{height:180px;border:1px solid #c1d3ff26;border-radius:22px;background:linear-gradient(145deg,#2a3f6e,#111c36);display:grid;place-items:center;font-size:38px;color:#a9bdff}
  .demo-result{text-align:center;color:#55dda5;font-size:48px}
  .guide{position:absolute;top:1370px;left:0;right:0;margin:0;text-align:center;font-size:64px;color:#f4f5f8;z-index:80}
  ${!transition ? '.axis-stage-speaker{transform:translate(46px,1514px) scale(.205555556);clip-path:circle(540px at 540px 960px);z-index:40}' : ""}
  </style><div id="canvas" class="axis-stage-root" data-stage="${!transition}" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-fps="30" data-duration="8">
  <img id="demo-speaker" class="axis-stage-speaker" src="assets/stage-speaker.svg" alt="抽象讲述者示意">
  ${gridFragment}
  <div class="axis-stage-content"><section class="demo-schematic"><div class="demo-title">B 轴舞台 · 公共示意素材</div><div class="demo-nodes"><div class="demo-node">内容</div><div class="demo-node">画面</div><div class="demo-node">声音</div></div><div class="demo-result">统一编排 · 完整呈现</div></section></div>
  <p class="guide">字幕区域示意</p></div><script src="assets/gsap.min.js"></script><script>
  ${axisScript}
  window.ready=document.fonts.ready.then(()=>Promise.all([...document.images].map(image=>image.decode().catch(()=>{})))).then(()=>{
    const timeline=gsap.timeline({paused:true}),canvasRoot=document.querySelector("#canvas"),speaker=document.querySelector("#demo-speaker"),content=document.querySelector(".axis-stage-content");
    const root=document.querySelector(".book-video-grid-module"),select=selector=>[...root.querySelectorAll(selector)],beat={start:${transition ? 1 : 0},duration:${transition ? 6 : 8}};
    ${gridTimeline}
    ${transition ? 'timeline.set(content,{autoAlpha:0},0);window.addAxisStageTransitions(timeline,{root:canvasRoot,speaker,intervals:[[1,7]]});timeline.fromTo(content,{autoAlpha:0},{autoAlpha:1,duration:.5,immediateRender:false},1.35);timeline.to(content,{autoAlpha:0,duration:.35},6.2);timeline.to(root,{autoAlpha:0,duration:.8},6.2);' : 'timeline.set(content,{autoAlpha:1},0);'}
    timeline.set({}, {}, 8);window.__timelines={main:timeline};window.mgTL=timeline;window.seek=time=>timeline.seek(time,false);window.seek(3.4);
  });
  window.addEventListener("message",event=>{
    if(event.source!==window.parent||event.data?.type!=="mg-preview-seek"||!Number.isFinite(event.data.time))return;
    window.ready.then(()=>window.seek(Math.max(0,Math.min(8,event.data.time))));
  });
  window.ready.then(()=>window.parent.postMessage({type:"mg-preview-ready"},location.protocol==="file:"?"*":location.origin));
  </script>`;
}
