#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { componentNames, resolveComponent, templateRoot } from "./motion-template-library.mjs";
import { buildComposition } from "./build-composition.mjs";

for (const id of componentNames()) {
  const component = resolveComponent(id);
  if (id === "stage/axis-stage-transition") continue;
  const beat = { id: "test-beat", start: 0, end: 5, axis: "A", templateData: {
    copy: Array.from({ length: component.meta.copySlots }, (_, i) => `测试<&${i}`),
    image: "assets/evidence.png", alt: "真实截图",
    focus: [{ x: 1, y: 2, width: 30, height: 20 }, { x: 2, y: 30, width: 40, height: 20 }]
  } };
  const result = component.render({ beat });
  assert.match(result.fragment, /data-beat-id="test-beat"/);
  assert.equal(result.style, fs.readFileSync(path.join(templateRoot, id, "style.css"), "utf8"));
  assert.equal(result.timeline, fs.readFileSync(path.join(templateRoot, id, "timeline.mjs"), "utf8"));
  if (component.meta.copySlots) assert.match(result.fragment, /测试&lt;&amp;0/);
  new Function("root", "select", "beat", "timeline", result.timeline);
}
assert.equal(resolveComponent("mapping"), null, "Do not silently substitute a different topology");
assert.throws(() => resolveComponent("quote").render({ beat: { id: "x", start: 0, end: 1, onScreenCopy: ["one"] } }), /text slots/);
assert.throws(() => resolveComponent("quote").render({ beat: { id: "x", start: 0, end: 1, onScreenCopy: ["one","two"], templateData: { revealTimes: [0,2,3] } } }), /relative times/);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-mg-"));
try {
  fs.mkdirSync(path.join(temporary, "state"));
  fs.mkdirSync(path.join(temporary, "hyperframes"));
  fs.writeFileSync(path.join(temporary, "hyperframes/index.template.html"), '<style>/* CUT_MOTION_MG_STYLES */</style><div id="root"><video id="a-roll"></video></div><script>const timeline={}; /* CUT_MOTION_MG_TIMELINES */</script>');
  fs.writeFileSync(path.join(temporary, "state/transcript.json"), JSON.stringify({segments:[{id:"s",words:[{start:0,end:4,text:"测试"}]}]}));
  const base = { start:0,end:4.2,mgScope:"local",axis:"A",entryAnchorWordId:"s:word-001",exitAnchorWordId:"s:word-001",exitAnchorOffsetFrames:0,exitFrames:6 };
  const map = {duration:5,fps:30,beats:[
    {...base,id:"quote-one",templateId:"quote",templateData:{copy:["第一句","署名"]}},
    {...base,id:"note",templateId:"annotation",templateData:{copy:["批注"]}},
    {...base,id:"stage",templateId:"stage/axis-stage-transition"}
  ]};
  const save=()=>fs.writeFileSync(path.join(temporary,"state/beat-map.json"),JSON.stringify(map));
  const run=(...flags)=>spawnSync(process.execPath,["scripts/assemble-mg.mjs",temporary,...flags],{encoding:"utf8"});
  save();
  let result=run("--write"); assert.equal(result.status,0,result.stderr);
  const output=path.join(temporary,"hyperframes/mg/quote-one/fragment.html");
  assert.match(fs.readFileSync(output,"utf8"),/第一句/);
  assert.match(fs.readFileSync(path.join(temporary,"hyperframes/index.template.html"),"utf8"),/window.addAxisStageTransitions/);
  assert.equal(fs.existsSync(path.join(temporary,"hyperframes/mg/stage")),false);
  const note=path.join(temporary,"hyperframes/mg/note/fragment.html");
  fs.appendFileSync(note,"<!-- manual -->");
  map.beats[0].templateData.copy[0]="改好的文案"; save();
  result=run("--write","--beat","quote-one"); assert.equal(result.status,0,result.stderr);
  assert.match(fs.readFileSync(output,"utf8"),/改好的文案/);
  assert.match(fs.readFileSync(note,"utf8"),/manual/);
  result=run("--write"); assert.notEqual(result.status,0); assert.match(result.stderr,/manual\/unmanaged/);
  result=run("--write","--force"); assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(fs.readFileSync(note,"utf8"),/manual/);
  result=run("--write","--beat","missing"); assert.notEqual(result.status,0);
  map.beats[0].templateId="custom"; save();
  fs.appendFileSync(output,"<!-- custom -->");
  result=run("--write"); assert.equal(result.status,0,result.stderr);
  assert.match(fs.readFileSync(output,"utf8"),/custom/);
  map.beats = map.beats.filter((beat) => beat.id !== "stage"); save();
  result=run("--write"); assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(fs.readFileSync(path.join(temporary,"hyperframes/index.template.html"),"utf8"),/window.addAxisStageTransitions/);

  // Fresh assembly must compile every canonical module, including grid and shared stage helpers.
  fs.rmSync(path.join(temporary,"hyperframes/mg"), {recursive:true,force:true});
  fs.mkdirSync(path.join(temporary,"hyperframes/assets"));
  fs.writeFileSync(path.join(temporary,"hyperframes/assets/evidence.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(temporary,"hyperframes/index.template.html"), '<style>/* CUT_MOTION_MG_STYLES */</style><div id="root"><video id="a-roll"></video><!-- CUT_MOTION_MG_FRAGMENTS --></div><script>const timeline={}; /* CUT_MOTION_MG_TIMELINES */</script>');
  map.beats = componentNames().map((id,index) => ({...base,id:`canonical-${index}`,templateId:id,templateData:{
    copy:Array.from({length:resolveComponent(id).meta.copySlots},(_,i)=>`文案${i}`),
    image:"assets/evidence.svg",alt:"证据",
    focus:[{x:1,y:2,width:30,height:20},{x:2,y:30,width:40,height:20}]
  }}));
  save(); result=run("--write"); assert.equal(result.status,0,result.stderr);
  const built=buildComposition(path.join(temporary,"hyperframes"));
  assert.equal(built.beatIds.length,componentNames().length-1);
  const html=fs.readFileSync(built.outputPath,"utf8");
  assert.match(html,/assets\/evidence.svg/);
  assert.doesNotMatch(html,/sample-evidence.svg/);
  assert.match(html,/book-video-grid-top/);
  assert.match(html,/window.addAxisStageTransitions/);
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
console.log(`Canonical MG templates and targeted assembly tests passed (${componentNames().length} templates).`);
