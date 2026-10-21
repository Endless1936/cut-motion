#!/usr/bin/env node
// Generate a small interactive review set from the current canonical sources.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { renderTemplate } from "./motion-template-library.mjs";
import { templateSamples, evidenceSampleFocus } from "./mg-template-samples.mjs";
import { stagePreviewNames, stagePreviewPage, stageSpeakerSvg } from "./mg-preview-stage.mjs";
import { redactionPreviewBackdrop, verifyRedactionPreview } from "./mg-preview-redaction.mjs";

const rootPath = path.resolve(new URL("../", import.meta.url).pathname);
const rendersPath = path.join(rootPath, "templates/motion-graphics/renders");
const output = path.join(rendersPath, "current");
const assetsPath = path.join(output, "assets");
const templateOption=process.argv.indexOf("--template");
const selectedTemplate=templateOption<0?null:process.argv[templateOption+1];
if(templateOption>=0&&(!selectedTemplate||selectedTemplate.startsWith("--")))throw new Error("--template needs a template name");
const fontCandidates = ["woff2", "ttf", "otf"].flatMap(extension => [
  path.join(rootPath, `assets/fonts/smiley-sans-oblique.${extension}`),
  path.join(assetsPath, `font.${extension}`)
]);
const fontPath = fontCandidates.find(candidate => fs.existsSync(candidate));
const font = fontPath ? fs.readFileSync(fontPath) : null;
const fontName = fontPath ? `font${path.extname(fontPath)}` : null;
const gsap = fs.readFileSync(path.join(rootPath, "node_modules/gsap/dist/gsap.min.js"));
// Stable filenames overwrite the current set without discarding completed MP4s on a verify-only run.
fs.mkdirSync(assetsPath, { recursive: true });
if (font&&(!selectedTemplate||!fs.existsSync(path.join(assetsPath,fontName)))) fs.writeFileSync(path.join(assetsPath, fontName), font);
if(!selectedTemplate||!fs.existsSync(path.join(assetsPath,"gsap.min.js")))fs.writeFileSync(path.join(assetsPath, "gsap.min.js"), gsap);
const names = Object.keys(templateSamples);
if(selectedTemplate&&![...names,...stagePreviewNames].includes(selectedTemplate))throw new Error("Unknown preview template: "+selectedTemplate);
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
  "evidence-three": ["evidence-focus", {...templateSamples["evidence-focus"],focus:evidenceSampleFocus}],
  "metrics-long": ["metric-grid",{title:"长数字排版演示",items:[{label:"播放",value:"1,234,567",unit:"次"},{label:"累计",value:"98,765,432",unit:"次",emphasis:true}]}],
  "table-three": ["comparison-table",{title:"三种制作方式",headers:["快速预览","精细制作","批量编排"],rows:[{values:["试稿","定稿","多版本"]},{values:["短时验证","完整制作","批量任务"]},{values:["高清画面","高清画面","高清画面"]},{values:["180 点","720 点","按需使用"],emphasis:true,reveal:"cells"}]}],
  "factor-six": ["factor-expansion",{source:"成熟内容",structure:"保留结构",items:[{label:"画面",value:"×4",icon:"image"},{label:"声音",value:"×3",icon:"wave"},{label:"场景",value:"×3",icon:"scene"},{label:"演员",value:"×2",icon:"person"},{label:"文案",value:"×2",icon:"document"},{label:"节奏",value:"×3",icon:"video"}],result:"更多内容方案"}],
  "growth-six": ["growth-trend",{title:"六阶段趋势示意",items:[{label:"起步",value:10},{label:"尝试",value:17},{label:"积累",value:30},{label:"验证",value:48},{label:"增长",value:71},{label:"扩展",value:96}],result:"持续增长"}]
};
variants["evidence-pan"] = ["evidence-focus",{...templateSamples["evidence-focus"],focus:evidenceSampleFocus}];
const allCases = [...Object.entries(templateSamples).map(([name,data])=>[name,name,data]), ...Object.entries(variants).map(([key,[name,data]])=>[key,name,data])];
const cases=selectedTemplate?allCases.filter(([key])=>key===selectedTemplate):allCases;
const stageCases=selectedTemplate?stagePreviewNames.filter(name=>name===selectedTemplate):stagePreviewNames;
for (const [key, name, data] of cases) {
  const beat = { id: name, start: 0, end: 8, templateData: data };
  const { fragment, style, timeline } = renderTemplate(name, beat);
  const backdrop=name==="redaction-mask"?redactionPreviewBackdrop(data):{style:"",fragment:""};
  const evidencePath = path.join(output, "assets");
  if (name === "evidence-focus") {
    fs.mkdirSync(evidencePath, {recursive: true});
    fs.copyFileSync(path.join(rootPath, "templates/motion-graphics/evidence-focus/sample-evidence.svg"), path.join(evidencePath, "sample-evidence.svg"));
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
  ${font ? `@font-face{font-family:"Smiley Sans";src:url("assets/${fontName}")}` : ""}
  html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
  body{background:#0b101a}
  #canvas{position:relative;width:1080px;height:1920px;background:radial-gradient(ellipse at 50% 30%,#25334b6b,transparent 64%),linear-gradient(#b9cfff06 1px,transparent 1px),linear-gradient(90deg,#b9cfff06 1px,transparent 1px),#0b101a;background-size:auto,72px 72px,72px 72px,auto}
  .guide{position:absolute;top:1370px;width:100%;text-align:center;color:white;font:72px "Smiley Sans";text-shadow:0 3px 8px #222}
  ${style}\n${backdrop.style}\n${key==="evidence-pan"?".evidence-surface{max-height:280px}":""}</style><div id="canvas" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-fps="30" data-duration="8">${backdrop.fragment}${fragment}<p class="guide">字幕区域示意</p></div>
  <script src="assets/gsap.min.js"></script>
  <script>
  window.ready=document.fonts.ready.then(()=>new Promise(resolve=>{
    const images=[...document.images]; Promise.all(images.map(img=>img.decode().catch(()=>{}))).then(()=>{
      const root=document.querySelector(".mg-root"),select=selector=>[...root.querySelectorAll(selector)];
      const beat=${JSON.stringify(beat)},timeline=gsap.timeline({paused:true});
      ${timeline}
      ${name === "redaction-mask" ? "" : "timeline.to(root,{autoAlpha:0,y:-8,duration:.2},7.8);"}
      timeline.set({}, {}, 8);window.__timelines={main:timeline};
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
if(stageCases.length)fs.writeFileSync(path.join(assetsPath,"stage-speaker.svg"),stageSpeakerSvg);
for(const name of stageCases) fs.writeFileSync(path.join(output,name+".html"),stagePreviewPage(name,rootPath,fontName));
const reviewNames=[...names,...stagePreviewNames];
const cards=reviewNames.map(name=>`<article><h2>${name}</h2><video controls playsinline preload="metadata" poster="${name}.png" src="${name}.mp4"></video><p><a href="${name}.mp4">打开视频</a> · <a href="${name}.html">交互预览</a></p><details open><summary>交互动画 · 可折叠</summary><div class="phone"><iframe title="${name}" src="${name}.html"></iframe></div></details></article>`).join("");
fs.writeFileSync(path.join(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>MG 模板预览</title>
<style>body{margin:30px;background:#0b101a;color:#eee;font:16px system-ui}h1{font-size:26px}header{position:sticky;top:0;background:#0b101af2;padding:12px;z-index:2}main{display:grid;grid-template-columns:repeat(auto-fit,304px);gap:24px}h2{font-size:17px}article{padding:16px;background:#14203780;border:1px solid #c1d3ff22;border-radius:20px}.phone,video{display:block;width:270px;height:480px;overflow:hidden;border-radius:14px;background:#05080e}iframe{border:0;width:1080px;height:1920px;transform:scale(.25);transform-origin:0 0}input{width:50vw}a{color:#a9bdff}summary{cursor:pointer;color:#a8b4ca;margin:12px 0}</style>
<header><h1>${names.length} 个内容 MG + ${stagePreviewNames.length} 个舞台模板</h1><p>每段 8 秒 · 1080×1920 / 30fps · 视频可独立播放，展开动画可同步拖动</p><button id="play">播放全部</button> <input id="time" type="range" min="0" max="8" step="0.03333333333333333" value="3.4"><span id="readout">3.4 s</span></header><main>${cards}</main>
<script>
const frames=[...document.querySelectorAll("iframe")],slider=document.querySelector("#time"),button=document.querySelector("#play"),readout=document.querySelector("#readout");
const videos=[...document.querySelectorAll("video")];
const targetOrigin=location.protocol==="file:"?"*":location.origin;
let playing=false,animationFrame=null;
function send(frame,time){frame.contentWindow.postMessage({type:"mg-preview-seek",time},targetOrigin)}
function seek(time,syncVideos=true){time=Math.max(0,Math.min(8,Number(time)));slider.value=time;readout.textContent=time.toFixed(2)+" s";frames.forEach(frame=>send(frame,time));if(syncVideos)videos.forEach(video=>{if(Number.isFinite(video.duration))video.currentTime=time})}
function stop(){playing=false;cancelAnimationFrame(animationFrame);animationFrame=null;button.textContent="播放全部";videos.forEach(video=>video.pause())}
slider.oninput=()=>{stop();seek(slider.value)};
button.onclick=()=>{
  if(playing){stop();return}
  playing=true;button.textContent="暂停";seek(0);
  videos.forEach(video=>video.play().catch(()=>{}));
  const start=performance.now();
  function tick(now){if(!playing)return;const time=Math.min((now-start)/1000,8);seek(time,false);if(time<8)animationFrame=requestAnimationFrame(tick);else stop()}
  animationFrame=requestAnimationFrame(tick);
};
window.addEventListener("message",event=>{if(event.data?.type!=="mg-preview-ready")return;const frame=frames.find(frame=>frame.contentWindow===event.source);if(frame)send(frame,Number(slider.value))});
seek(slider.value);
</script>`);
if (!process.argv.includes("--verify") && !process.argv.includes("--serve") && !process.argv.includes("--render")) {
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
  res.setHeader("Content-Type",p.endsWith(".html")?"text/html":p.endsWith(".svg")?"image/svg+xml":p.endsWith(".js")?"text/javascript":p.endsWith(".mp4")?"video/mp4":"application/octet-stream");
  if(p.endsWith(".mp4")){
    const size=fs.statSync(p).size,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??"");
    res.setHeader("Accept-Ranges","bytes");
    if(range){
      const start=Number(range[1]),end=Math.min(Number(range[2]||size-1),size-1);
      if(start>end||start>=size){res.writeHead(416,{"Content-Range":`bytes */${size}`});res.end();return}
      res.writeHead(206,{"Content-Range":`bytes ${start}-${end}/${size}`,"Content-Length":end-start+1});
      fs.createReadStream(p,{start,end}).pipe(res);return;
    }
    res.setHeader("Content-Length",size);
  }
  fs.createReadStream(p).pipe(res);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
if(process.argv.includes("--serve")){
  console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/index.html`}));
  await new Promise(()=>{});
}
const browser=await puppeteer.launch({executablePath,headless:true,args:["--no-sandbox"]});
const failures=[],measurements=[],stageMeasurements=[],overlayMeasurements=[];
try {
  const page=await browser.newPage();await page.setViewport({width:1080,height:1920});
  page.on("pageerror",e=>failures.push(e.message));
  for(const [key,name,data] of cases){
    await page.goto(`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/${key}.html`);
    await page.evaluate(()=>window.ready);
    if(name==="redaction-mask"){
      const overlay=await verifyRedactionPreview(page,data);
      overlayMeasurements.push({name:key,...overlay});
      if(overlay.regions!==data.masks.length||overlay.rects!==data.masks.reduce((sum,mask)=>sum+mask.rects.length,0)||overlay.maxAlphaError>.03||overlay.maxCoordinateErrorPx>.1||!overlay.reversible||overlay.colors.some(color=>color!=="rgb(43, 42, 44)"))failures.push(key+": overlay timing, coordinates, gray color or reverse seeking");
      await page.screenshot({path:path.join(output,key+".png")});
      continue;
    }
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
      const backplate=root.querySelector(".steps-surface,.points-surface,.flow-panel,.metrics-panel,.table-panel,.factor-panel,.growth-panel,.code-panel")??(root.querySelector(".quote-rule")?root:null);
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
      root.parentElement.style.setProperty("--mg-paper","#ef9dda");
      const hostOverride=getComputedStyle(root.querySelector(".quote-copy")??root).color==="rgb(239, 157, 218)";
      root.parentElement.style.removeProperty("--mg-paper");
      window.seek(6.5);
      return {center:r.left+r.width/2,top:r.top,bottom:r.bottom,width:r.width,early,late,again,ahead,maxFocusErrorPx,changingBackplate,uncoveredContent,hostOverride,premature:elements.some((e,i)=>Number(e.dataset.at)>.1 && early[i]>.001),overflow:card.scrollWidth>card.clientWidth+2};
    });
    measurements.push({name:key,...geometry});
    const oldWidths={"ordered-steps":420,"linear-flow":428.9375,"quote":424};
    if(oldWidths[key]&&geometry.width<oldWidths[key]*1.6)failures.push(key+": width must reach 160% of the previous sample");
    if(geometry.maxFocusErrorPx>.1||geometry.changingBackplate||geometry.uncoveredContent||geometry.ahead||geometry.premature||Math.abs(geometry.center-540)>1||geometry.bottom>1250||geometry.overflow||JSON.stringify(geometry.early)!==JSON.stringify(geometry.again))failures.push(key+": placement, overflow or seeking");
    if(geometry.late.some(value=>value<.99)&&name!=="evidence-focus")failures.push(key+": missing reveal");
    if(!geometry.hostOverride)failures.push(key+": host paper-color override");
    if(names.includes(key) || ["converge-six","converge-five","compare-parts"].includes(key)) await page.screenshot({path:path.join(output,key+".png")});
  }
  for(const name of stageCases){
    await page.goto(`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/${name}.html`);
    await page.evaluate(()=>window.ready);
    const stage=await page.evaluate(()=>{
      const root=document.querySelector("#canvas"),speaker=document.querySelector("#demo-speaker");
      const read=time=>{window.seek(time);const b=speaker.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,stage:root.dataset.stage}};
      const early=read(0),middle=read(4),late=read(8),again=read(0);window.seek(4);
      return {width:root.clientWidth,height:root.clientHeight,duration:window.__timelines.main.duration(),early,middle,late,again};
    });
    stageMeasurements.push({name,...stage});
    if(stage.width!==1080||stage.height!==1920||stage.duration!==8||JSON.stringify(stage.early)!==JSON.stringify(stage.again))failures.push(name+": composition contract or reversible seeking");
    if(name==="axis-stage-transition"&&(Math.abs(stage.middle.width-222)>.1||Math.abs(stage.middle.x-46)>.1||stage.middle.stage!=="true"||stage.late.stage!=="false"))failures.push(name+": stage transition geometry");
    await page.screenshot({path:path.join(output,name+".png")});
  }
  fs.writeFileSync(path.join(output,"verification.json"),JSON.stringify({scope:selectedTemplate??"all",measurements,stageMeasurements,overlayMeasurements,failures},null,2));
  await page.setViewport({width:1260,height:1700});
  await page.goto(`http://127.0.0.1:${server.address().port}/templates/motion-graphics/renders/current/index.html`);
  await page.evaluate(()=>document.querySelectorAll("details").forEach(detail=>detail.open=true));
  await page.waitForFunction(()=>[...document.querySelectorAll("iframe")].every(f=>f.contentWindow.mgTL));
  const scrubTime=await page.evaluate(()=>{const slider=document.querySelector("#time");slider.value="5.2";slider.dispatchEvent(new Event("input"));return Number(slider.value)});
  await page.waitForFunction(time=>[...document.querySelectorAll("iframe")].every(f=>Math.abs(f.contentWindow.mgTL.time()-time)<.01),{},scrubTime);
  await page.click("#play");
  await page.waitForFunction(()=>Number.parseFloat(document.querySelector("#readout").textContent)>.15);
  await page.click("#play");
  const stopped=await page.evaluate(()=>document.querySelector("#play").textContent==="播放全部");
  if(!stopped)failures.push("gallery: play/pause interaction");
  await page.evaluate(()=>{const slider=document.querySelector("#time");slider.value="3.4";slider.dispatchEvent(new Event("input"))});
  await page.evaluate(()=>document.querySelectorAll("details").forEach(detail=>detail.open=false));
  await page.screenshot({path:path.join(output,"overview.png"),fullPage:true});
} finally {await browser.close();server.close();}
fs.writeFileSync(path.join(output,"verification.json"),JSON.stringify({scope:selectedTemplate??"all",measurements,stageMeasurements,overlayMeasurements,failures},null,2));
console.log(JSON.stringify({gallery:path.join(output,"index.html"),scope:selectedTemplate??"all",cases:measurements.length,stageCases:stageMeasurements.length,overlayCases:overlayMeasurements.length,maxCenterErrorPx:Math.max(0,...measurements.map(m=>Math.abs(m.center-540))),maxCardBottomPx:Math.max(0,...measurements.map(m=>m.bottom)),failures}));
if(failures.length)process.exitCode=1;
if(!failures.length&&process.argv.includes("--render")){
  const temporary=path.join(output,".render"),cli=path.join(rootPath,"node_modules/.bin/hyperframes");
  const renderNames=selectedTemplate?[selectedTemplate]:reviewNames;
  fs.mkdirSync(temporary,{recursive:true});
  let next=0;
  const renderOne=async name=>{
    const directory=path.join(temporary,name);fs.mkdirSync(directory,{recursive:true});
    fs.copyFileSync(path.join(output,name+".html"),path.join(directory,"index.html"));
    fs.symlinkSync(assetsPath,path.join(directory,"assets"),"dir");
    await new Promise((resolve,reject)=>{
      const child=spawn("rtk",["proxy",cli,"render",directory,"--output",path.join(output,name+".mp4"),"--fps","30","--quality","high","--workers","2"],{cwd:rootPath,stdio:["ignore","pipe","pipe"]});
      let log="";const collect=chunk=>{log=(log+chunk.toString()).slice(-12000)};
      child.stdout.on("data",collect);child.stderr.on("data",collect);child.on("error",reject);
      child.on("close",code=>code===0?resolve():reject(new Error(name+": render exited "+code+"\n"+log)));
    });
    console.log(JSON.stringify({rendered:name,file:path.join(output,name+".mp4"),bytes:fs.statSync(path.join(output,name+".mp4")).size}));
  };
  try{
    const outcomes=await Promise.allSettled(Array.from({length:2},async()=>{while(next<renderNames.length){const name=renderNames[next++];await renderOne(name)}}));
    const errors=outcomes.filter(outcome=>outcome.status==="rejected").map(outcome=>outcome.reason);
    if(errors.length)throw new AggregateError(errors,"MG preview renders failed");
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({rendered:renderNames.length,gallery:path.join(output,"index.html")}));
}
