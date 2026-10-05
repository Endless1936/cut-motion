#!/usr/bin/env node
// Generate a small interactive review set from the current canonical sources.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { renderTemplate } from "./motion-template-library.mjs";
import { templateSamples, evidenceSampleFocus } from "./mg-template-samples.mjs";

const rootPath = path.resolve(new URL("../", import.meta.url).pathname);
const rendersPath = path.join(rootPath, "templates/motion-graphics/renders");
const output = path.join(rendersPath, "current");
const assetsPath = path.join(output, "assets");
const fontCandidates = ["woff2", "ttf", "otf"].flatMap(extension => [
  path.join(rootPath, `assets/fonts/smiley-sans-oblique.${extension}`),
  path.join(assetsPath, `font.${extension}`)
]);
const fontPath = fontCandidates.find(candidate => fs.existsSync(candidate));
const font = fontPath ? fs.readFileSync(fontPath) : null;
const fontName = fontPath ? `font${path.extname(fontPath)}` : null;
const gsap = fs.readFileSync(path.join(rootPath, "node_modules/gsap/dist/gsap.min.js"));
// This generated directory holds only the latest preview; load dependencies before replacing it.
fs.rmSync(rendersPath, { recursive: true, force: true });
fs.mkdirSync(assetsPath, { recursive: true });
if (font) fs.writeFileSync(path.join(assetsPath, fontName), font);
fs.writeFileSync(path.join(assetsPath, "gsap.min.js"), gsap);
const names = Object.keys(templateSamples);
const variants = {
  "ordered-six": ["ordered-steps", {title:"六个制作步骤",items:["初始化","文案","画面","配音","剪辑","成片"]}],
  "ordered-detailed": ["ordered-steps", {title:"详细操作",items:[{label:"确认目标",description:"先明确内容要解决的问题"},{label:"整理素材",description:"保留有用信息，删除重复内容"},{label:"编排动画",description:"关键词出现时再展开对应元素"},{label:"导出成片",description:"完成画面和音频合成"}]}],
  "parallel-six": ["parallel-points", {title:"独立能力",items:["文案","画面","音频","剪辑","字幕","模型"]}],
  "flow-horizontal": ["linear-flow", {layout:"horizontal",items:["录制","转写","剪辑","成片"]}],
  "flow-auto-six": ["linear-flow", {items:["录制","转写","整理","配音","剪辑","成片"]}],
  "relation-vertical": ["relation-map", {layout:"vertical",source:"内容来源",items:["图文内容","视频素材","播客音频","文档摘要","课程讲解"]}],
  "converge-six": ["converge-sources", {items:["文案内容","画面素材","配音音频","剪辑节奏","字幕方案","模型能力"],result:"完整成片",revealTimes:[0,.18,.82,1.37,2.13,2.94,4.61]}],
  "converge-five": ["converge-sources", {items:["项目文件","图片","视频","音频","模型"],result:"全部在云端",revealTimes:[0,.6,1.2,1.8,2.4,3]}],
  "transform-horizontal": ["map-transform", {layout:"horizontal",source:"原始素材",result:"完整成片"}],
  "compare-vertical": ["comparison", {layout:"vertical",title:"两种制作方式",items:[{label:"手动流程",description:"逐项打开工具并传递素材"},{label:"自动流程",description:"统一编排制作步骤"}]}],
  "compare-parts": ["comparison", {title:"画面方案",items:[{label:"普通方案",description:"速度更快"},{label:"精细方案",description:["质感更好","多花半分钟"]}],revealTimes:[0,.3,.9,1.5,2.4,4.5]}],
  "quote-single": ["quote", {text:"一个清楚的观点"}],
  "metric-long": ["metric-proof", {source:"示例数据",value:"1,234,567",unit:"次",caption:"数据只用于版式演示"}],
  "evidence-three": ["evidence-focus", {...templateSamples["evidence-focus"],focus:evidenceSampleFocus}]
};
variants["evidence-pan"] = ["evidence-focus",{...templateSamples["evidence-focus"],focus:evidenceSampleFocus}];
const cases = [...Object.entries(templateSamples).map(([name,data])=>[name,name,data]), ...Object.entries(variants).map(([key,[name,data]])=>[key,name,data])];
for (const [key, name, data] of cases) {
  const beat = { id: name, start: 0, end: 8, templateData: data };
  const { fragment, style, timeline } = renderTemplate(name, beat);
  const evidencePath = path.join(output, "assets");
  if (name === "evidence-focus") {
    fs.mkdirSync(evidencePath, {recursive: true});
    fs.copyFileSync(path.join(rootPath, "templates/motion-graphics/evidence-focus/sample-evidence.svg"), path.join(evidencePath, "sample-evidence.svg"));
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
  ${font ? `@font-face{font-family:"Smiley Sans";src:url("assets/${fontName}")}` : ""}
  html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
  body{background:linear-gradient(135deg,#d4be90 0 20%,#68767a 20% 40%,#c5a878 40% 60%,#56666c 60% 80%,#d3bd92 80%)}
  #canvas{position:relative;width:1080px;height:1920px;background:linear-gradient(0deg,rgba(20,26,29,.4),transparent)}
  .guide{position:absolute;top:1370px;width:100%;text-align:center;color:white;font:72px "Smiley Sans";text-shadow:0 3px 8px #222}
  ${style}\n${key==="evidence-pan"?".evidence-surface{max-height:280px}":""}</style><div id="canvas">${fragment}<p class="guide">字幕区域示意</p></div>
  <script src="assets/gsap.min.js"></script>
  <script>
  window.ready=document.fonts.ready.then(()=>new Promise(resolve=>{
    const images=[...document.images]; Promise.all(images.map(img=>img.decode().catch(()=>{}))).then(()=>{
      const root=document.querySelector(".mg-root"),select=selector=>[...root.querySelectorAll(selector)];
      const beat=${JSON.stringify(beat)},timeline=gsap.timeline({paused:true});
      ${timeline}
      timeline.to(root,{autoAlpha:0,y:-8,duration:.2},7.8);
      window.mgTL=timeline;window.seek=time=>timeline.seek(time,false);window.seek(3.4);resolve();
    });
  }));
  window.addEventListener("message",event=>{
    if(event.source!==window.parent||event.data?.type!=="mg-preview-seek"||!Number.isFinite(event.data.time))return;
    window.ready.then(()=>window.seek(Math.max(0,Math.min(8,event.data.time))));
  });
  window.ready.then(()=>window.parent.postMessage({type:"mg-preview-ready"},location.protocol==="file:"?"*":location.origin));
  </script>`;
  fs.writeFileSync(path.join(output, key + ".html"), html);
}
const cards=names.map(name=>`<article><h2>${name}</h2><div class="phone"><iframe title="${name}" src="${name}.html"></iframe></div></article>`).join("");
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>MG 模板预览</title>
<style>body{margin:30px;background:#171b1b;color:#eee;font:16px system-ui}h1{font-size:26px}header{position:sticky;top:0;background:#171b1b;padding:12px;z-index:2}main{display:grid;grid-template-columns:repeat(auto-fit,270px);gap:24px}h2{font-size:17px}.phone{width:270px;height:480px;overflow:hidden;border-radius:14px}iframe{border:0;width:1080px;height:1920px;transform:scale(.25);transform-origin:0 0}input{width:50vw}</style>
<header><h1>13 个共用 MG · 当前源码预览</h1><p>卡片整体居中 · 内容按语义展开 · 演示时间可拖动</p><button id="play">播放全部</button> <input id="time" type="range" min="0" max="8" step=".033" value="3.4"><span id="readout">3.4 s</span></header><main>${cards}</main>
<script>
const frames=[...document.querySelectorAll("iframe")],slider=document.querySelector("#time"),button=document.querySelector("#play"),readout=document.querySelector("#readout");
const targetOrigin=location.protocol==="file:"?"*":location.origin;
let playing=false,animationFrame=null;
function send(frame,time){frame.contentWindow.postMessage({type:"mg-preview-seek",time},targetOrigin)}
function seek(time){time=Math.max(0,Math.min(8,Number(time)));slider.value=time;readout.textContent=time.toFixed(2)+" s";frames.forEach(frame=>send(frame,time))}
function stop(){playing=false;cancelAnimationFrame(animationFrame);animationFrame=null;button.textContent="播放全部"}
slider.oninput=()=>{stop();seek(slider.value)};
button.onclick=()=>{
  if(playing){stop();return}
  playing=true;button.textContent="暂停";seek(0);
  const start=performance.now();
  function tick(now){if(!playing)return;const time=Math.min((now-start)/1000,8);seek(time);if(time<8)animationFrame=requestAnimationFrame(tick);else stop()}
  animationFrame=requestAnimationFrame(tick);
};
window.addEventListener("message",event=>{if(event.data?.type!=="mg-preview-ready")return;const frame=frames.find(frame=>frame.contentWindow===event.source);if(frame)send(frame,Number(slider.value))});
seek(slider.value);
</script>`);
if (!process.argv.includes("--verify") && !process.argv.includes("--serve")) {
  console.log(JSON.stringify({gallery:path.join(output,"index.html")}));
  process.exit(0);
}
const require=createRequire(import.meta.url);
const puppeteer=require(path.join(rootPath,"node_modules/puppeteer-core"));
const browserRoot=path.join(process.env.HOME,".cache/hyperframes/chrome/chrome-headless-shell");
const version=fs.readdirSync(browserRoot).sort().at(-1);
const executablePath=path.join(browserRoot,version,"chrome-headless-shell-mac-arm64/chrome-headless-shell");
const server=http.createServer((req,res)=>{
  const p=path.resolve(rootPath,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));
  if(!p.startsWith(rootPath+path.sep)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);res.end();return}
  res.setHeader("Content-Type",p.endsWith(".html")?"text/html":p.endsWith(".svg")?"image/svg+xml":p.endsWith(".js")?"text/javascript":"application/octet-stream");
  fs.createReadStream(p).pipe(res);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
if(process.argv.includes("--serve")){
  console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/index.html`}));
  await new Promise(()=>{});
}
const browser=await puppeteer.launch({executablePath,headless:true,args:["--no-sandbox"]});
const failures=[],measurements=[];
try {
  const page=await browser.newPage();await page.setViewport({width:1080,height:1920});
  page.on("pageerror",e=>failures.push(e.message));
  for(const [key,name] of cases){
    await page.goto(`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/${key}.html`);
    await page.evaluate(()=>window.ready);
    const geometry=await page.evaluate(async()=>{
      window.seek(6.5);
      const root=document.querySelector(".mg-root"),card=root.querySelector(".evidence-surface,.annotation-caption-copy")??root;
      const r=card.getBoundingClientRect(),elements=[...root.querySelectorAll("[data-at]")];
      const effectiveAlpha=element=>{
        let alpha=1;for(let e=element;e && e!==document.body;e=e.parentElement){
          const css=getComputedStyle(e);if(css.visibility==="hidden")return 0;alpha*=Number(css.opacity);
        }return alpha;
      };
      const states=time=>{window.seek(time);return elements.map(e=>effectiveAlpha(e))};
      const backplate=root.querySelector(".steps-surface,.points-surface,.flow-panel")??(root.querySelector(".quote-rule")?root:null);
      const triggers=[...root.querySelectorAll("[data-at],[data-link-at]")];
      const ahead=triggers.some(e=>{
        const at=Number(e.dataset.at??e.dataset.linkAt);
        if(at<=0)return false;window.seek(Math.max(0,at-1/30));return effectiveAlpha(e)>.001;
      });
      let maxFocusErrorPx=0;
      const image=root.querySelector(".evidence-image");
      if(image){
        const svg=new DOMParser().parseFromString(await (await fetch(image.src)).text(),"image/svg+xml");
        const [,,width,height]=svg.documentElement.getAttribute("viewBox").trim().split(" ").map(Number);
        const references=[...svg.querySelectorAll("[data-evidence-region]")].map(e=>Object.fromEntries(["x","y","width","height"].map(k=>[k,Number(e.getAttribute(k))])));
        for(let frame=0;frame<=195;frame++){
          window.seek(Math.max(.001,frame/30));
          const imageBox=image.getBoundingClientRect();
          elements.forEach((e,index)=>{
            if(effectiveAlpha(e)<=.001)return;
            const ref=references[index],r=e.getBoundingClientRect();
            const expected={left:imageBox.left+ref.x/width*imageBox.width,top:imageBox.top+ref.y/height*imageBox.height,width:ref.width/width*imageBox.width,height:ref.height/height*imageBox.height};
            maxFocusErrorPx=Math.max(maxFocusErrorPx,...Object.keys(expected).map(k=>Math.abs(r[k]-expected[k])));
          });
        }
      }
      let changingBackplate=false,uncoveredContent=false;
      if(backplate){
        window.seek(.001);
        const finalBox=backplate.getBoundingClientRect();
        for(let frame=0;frame<=195;frame++){
          window.seek(Math.max(.001,frame/30));
          const box=backplate.getBoundingClientRect(),css=getComputedStyle(backplate);
          if(Math.abs(box.width-finalBox.width)>.01||Math.abs(box.height-finalBox.height)>.01||css.clipPath!=="none"||effectiveAlpha(backplate)<.99)changingBackplate=true;
          for(const e of elements){
            if(effectiveAlpha(e)<=.001)continue;
            const r=e.getBoundingClientRect();
            if(r.left<box.left-.1||r.right>box.right+.1||r.top<box.top-.1||r.bottom>box.bottom+.1)uncoveredContent=true;
          }
        }
      }
      const early=states(.1),late=states(6.5),again=states(.1);
      window.seek(6.5);
      return {center:r.left+r.width/2,top:r.top,bottom:r.bottom,width:r.width,early,late,again,ahead,maxFocusErrorPx,changingBackplate,uncoveredContent,premature:elements.some((e,i)=>Number(e.dataset.at)>.1 && early[i]>.001),overflow:card.scrollWidth>card.clientWidth+2};
    });
    measurements.push({name:key,...geometry});
    const oldWidths={"ordered-steps":420,"linear-flow":428.9375,"quote":424};
    if(oldWidths[key]&&geometry.width<oldWidths[key]*1.6)failures.push(key+": width must reach 160% of the previous sample");
    if(geometry.maxFocusErrorPx>.1||geometry.changingBackplate||geometry.uncoveredContent||geometry.ahead||geometry.premature||Math.abs(geometry.center-540)>1||geometry.bottom>1250||geometry.overflow||JSON.stringify(geometry.early)!==JSON.stringify(geometry.again))failures.push(key+": placement, overflow or seeking");
    if(geometry.late.some(value=>value<.99)&&name!=="evidence-focus")failures.push(key+": missing reveal");
    if(names.includes(key) || ["converge-six","converge-five","compare-parts"].includes(key)) await page.screenshot({path:path.join(output,key+".png")});
  }
  await page.setViewport({width:1260,height:1700});
  await page.goto(`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/index.html`);
  await page.waitForFunction(()=>[...document.querySelectorAll("iframe")].every(f=>f.contentWindow.mgTL));
  await page.screenshot({path:path.join(output,"overview.png"),fullPage:true});
} finally {await browser.close();server.close();}
fs.writeFileSync(path.join(output,"verification.json"),JSON.stringify({measurements,failures},null,2));
console.log(JSON.stringify({gallery:path.join(output,"index.html"),cases:measurements.length,maxCenterErrorPx:Math.max(...measurements.map(m=>Math.abs(m.center-540))),maxCardBottomPx:Math.max(...measurements.map(m=>m.bottom)),failures}));
if(failures.length)process.exitCode=1;
