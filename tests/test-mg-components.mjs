#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { componentNames, resolveComponent, templateRoot, DEFAULT_MG_TOP_PX } from "../scripts/motion-template-library.mjs";
import { buildComposition } from "../scripts/build-composition.mjs";
import { buildBeatMap } from "../scripts/plan-artifacts.mjs";

const planBeat = (beat) => buildBeatMap({
  transcript: { duration: 5 }, captionMode: "subtitles",
  designSystem: { typography: { displayFamily: "Smiley Sans", outlineReservePx: 18 }, captions: { fontSizePx: 96 } },
  beats: [{ id: "placement", start: 0, end: 5, templateId: "annotation", templateData: { copy: ["提示"] }, ...beat }]
}).beats[0];
const upper = planBeat({});
assert.equal(upper.templateData.topPx, DEFAULT_MG_TOP_PX);
assert.equal(upper.layout.primaryBoundsNormalized.y, DEFAULT_MG_TOP_PX / 1920);
const authored = planBeat({ templateData: { copy: ["提示"], topPx: 120 } });
assert.equal(authored.templateData.topPx, 120);
assert.equal(authored.layout.primaryBoundsNormalized.y, 120 / 1920);
const explicitBounds = planBeat({ templateData: { copy: ["提示"], topPx: 120 }, layout: { primaryBoundsNormalized: { y: 0.1 } } });
assert.equal(explicitBounds.layout.primaryBoundsNormalized.y, 0.1);
assert.deepEqual(planBeat(upper), upper, "A settled plan must retain its placement on regeneration");
const stage = planBeat({ templateId: "stage/b-axis-horizon-grid", templateData: {} });
assert.equal(stage.templateData.topPx, undefined);
assert.equal(stage.layout.primaryBoundsNormalized.y, 0.42, "Overlay defaults do not move stage geometry");
assert.equal(planBeat({ templateId: "custom", templateData: {} }).layout.primaryBoundsNormalized.y, DEFAULT_MG_TOP_PX / 1920);
const example = JSON.parse(fs.readFileSync(new URL("../templates/planning-inputs.example.json", import.meta.url), "utf8"));
const exampleNote = planBeat(example.beats[1]);
assert.equal(exampleNote.templateData.topPx / 1920, exampleNote.layout.primaryBoundsNormalized.y);

for (const id of componentNames()) {
  const component = resolveComponent(id);
  if (id === "stage/axis-stage-transition") continue;
  const beat = { id: "test-beat", start: 0, end: 5, axis: "A", templateData: {
    copy: Array.from({ length: component.meta.legacyCopySlots }, (_, i) => `测试<&${i}`),
    image: "assets/evidence.png", alt: "真实截图",
    focus: [{ x: 1, y: 2, width: 30, height: 20 }, { x: 2, y: 30, width: 40, height: 20 }]
  } };
  const result = component.render({ beat });
  if (!id.startsWith("stage/")) {
    assert.equal(component.meta.defaultTopPx, DEFAULT_MG_TOP_PX);
    assert.match(result.fragment, /style="--mg-top:280px"/);
    assert.match(result.style, /var\(--mg-top,\s*280px\)/);
    const positioned = component.render({ beat: { ...beat, templateData: { ...beat.templateData, topPx: 120 } } });
    assert.match(positioned.fragment, /style="--mg-top:120px"/, "Authored placement takes precedence without an approval flag");
    const planned = planBeat({ ...beat, templateId: id });
    assert.equal(planned.templateData.topPx, DEFAULT_MG_TOP_PX);
    assert.equal(planned.layout.primaryBoundsNormalized.y, DEFAULT_MG_TOP_PX / 1920);
    assert.deepEqual(planBeat(planned), planned, "Template content survives plan regeneration");
  } else assert.doesNotMatch(result.fragment, /--mg-top/);
  assert.equal(result.fragment.match(/data-topology="([^"]+)"/)[1], component.meta.semanticTopology);
  assert.equal(result.fragment.match(/data-primary-flow-axis="([^"]+)"/)[1], component.content(beat)?.axis ?? component.meta.primaryFlowAxis);
  assert.match(result.fragment, /data-beat-id="test-beat"/);
  assert.equal(result.style, fs.readFileSync(path.join(templateRoot, id, "style.css"), "utf8"));
  assert.equal(result.timeline, fs.readFileSync(path.join(templateRoot, id, "timeline.mjs"), "utf8"));
  if (component.meta.legacyCopySlots) assert.match(result.fragment, /测试&lt;&amp;0/);
  new Function("root", "select", "beat", "timeline", result.timeline);
}
assert.equal(resolveComponent("mapping"), null, "Do not silently substitute a different topology");
assert.doesNotThrow(() => resolveComponent("quote").render({ beat: { id: "x", start: 0, end: 1, onScreenCopy: ["one"] } }));
assert.throws(() => resolveComponent("quote").render({ beat: { id: "x", start: 0, end: 1, onScreenCopy: ["one","two"], templateData: { revealTimes: [0,2,3] } } }), /relative times/);


for (const name of ["ordered-steps", "parallel-points", "linear-flow", "relation-map", "converge-sources", "code-snippet", "annotation"]) {
  for (const count of [2, 5, 6]) {
    const data = { items: Array.from({length: count}, (_, i) => `条目<${i}`), source: "来源", result: "结果", title: "标题" };
    const beat = {id: "variable", start: 0, end: 8, templateData: data};
    const component = resolveComponent(name);
    const planned = planBeat({templateId: name, templateData: data});
    assert.deepEqual(planBeat(planned), planned);
    assert.ok(planned.onScreenCopy.includes("条目<" + (count-1)));
    const html = component.render({beat}).fragment;
    assert.match(html, /条目&lt;0/);
    assert.ok([...html.matchAll(/data-at=/g)].length >= count);
    assert.doesNotMatch(html, /undefined/);
    assert.equal([...html.matchAll(/ style="--mg-top/g)].length, 1);
    if (name === "linear-flow" && count > 4) assert.equal(planned.primaryFlowAxis, "vertical");
  }
}
const narrow = planBeat({templateId: "ordered-steps", templateData: {title: "流程", items: ["第一步","第二步"], widthPx: 540}});
for(const name of ["ordered-steps","linear-flow","quote"]){
  const templateData=name==="quote"?{text:"观点"}:{layout:"vertical",items:["第一步","第二步"]};
  const wide=planBeat({templateId:name,templateData});
  assert.equal(wide.templateData.widthPx,720);
  assert.equal(wide.layout.primaryBoundsNormalized.width,720/1080);
  assert.equal(wide.layout.primaryBoundsNormalized.x+wide.layout.primaryBoundsNormalized.width/2,.5);
}
assert.equal(narrow.layout.primaryBoundsNormalized.x + narrow.layout.primaryBoundsNormalized.width / 2, .5);
assert.throws(() => resolveComponent("parallel-points").render({beat:{id:"bad",start:0,end:3,templateData:{items:[{label:"字",description:123}]}}}), /strings/);
for(const count of [1,3]) {
  const result = resolveComponent("evidence-focus").render({beat:{id:"focus",start:0,end:5,templateData:{image:"assets/demo.png",alt:"演示",focus:Array.from({length:count},()=>({x:10,y:10,width:20,height:20}))}}});
  assert.equal([...result.fragment.matchAll(/data-at=/g)].length,count);
}

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
    copy:Array.from({length:resolveComponent(id).meta.legacyCopySlots},(_,i)=>`文案${i}`),
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
