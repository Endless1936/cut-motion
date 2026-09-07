// Optional targeted DOM regression; uses existing dependencies, never downloads.
// node scripts/test-layout-browser.mjs <puppeteer-module-path> <chromium-path>
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { clippedContentRect, findContentCollision, bindFaceCoverApproval } from "./build-composition.mjs";

const [modulePath, executablePath] = process.argv.slice(2);
if (!modulePath || !executablePath) throw new Error("Supply an existing puppeteer module and Chromium executable");
const { default: puppeteer } = await import(pathToFileURL(modulePath).href);
const template = fs.readFileSync(new URL("../templates/hyperframes/index.template.html", import.meta.url), "utf8");
const contract = template.slice(template.indexOf("window.__motionContract ="), template.indexOf("      window.__motionContract();"));
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 800 });
  const mount = async (content) => {
    await page.setContent(`<style>body{margin:0}#root{position:relative;width:500px;height:500px}span{font-size:50px}</style><div id="root">${content}</div>`);
    await page.addScriptTag({ content: `const clippedContentRect = ${clippedContentRect};const findContentCollision = ${findContentCollision};${contract}` });
  };
  const check = () => page.evaluate(() => { try { window.__motionContract(1); return "passed"; } catch (error) { return error.message; } });
  await mount('<div data-motion-group data-axis="A" data-face-cover="none" data-group-start="0" data-group-duration="5"><div style="margin-left:50px;width:100px;height:100px;overflow:hidden"><span id="leaf" style="position:absolute;left:480px;top:80px;width:100px;height:50px;background:red">X</span></div></div>');
  assert.equal(await page.evaluate(() => document.elementFromPoint(530,90)?.id), "leaf");
  assert.equal(await check(), "motion_contract_canvas_overflow", "escaping absolute content must remain detectable");
  await mount('<div data-motion-group data-axis="A" data-face-cover="none" data-group-start="0" data-group-duration="5"><span style="overflow:hidden"><span id="leaf" style="display:inline-block;width:100px;height:80px;transform:translateX(450px);background:red">X</span></span></div>');
  assert.equal(await page.evaluate(() => document.elementFromPoint(530,30)?.id), "leaf");
  assert.equal(await check(), "motion_contract_canvas_overflow", "inline overflow does not clip painted content");
  await mount('<div data-motion-group data-axis="A" data-face-cover="none" data-group-start="0" data-group-duration="5"><div style="position:relative;margin-left:100px;width:200px;height:100px;overflow:clip;overflow-clip-margin:300px"><span id="leaf" style="display:block;width:500px;height:80px;background:red">X</span></div></div>');
  assert.equal(await page.evaluate(() => document.elementFromPoint(530,30)?.id), "leaf");
  assert.equal(await check(), "motion_contract_canvas_overflow", "expanded overflow clip edge must not hide real overflow");
  const viewport = '<div id="panel" style="position:relative;margin-left:100px;width:200px;height:200px;overflow:hidden"><img id="image" alt="" style="position:absolute;left:-100px;top:0;width:500px;height:200px"></div>';
  await mount(`<div data-motion-group data-axis="A" data-face-cover="none" data-group-start="0" data-group-duration="5" data-motion-surface="container">${viewport}<span style="position:absolute;left:350px;top:0">X</span></div>`);
  assert.equal(await check(), "passed", "cropped-away pixels must not cause a content collision");
  await page.evaluate(() => document.querySelector("#panel").style.transform = "translateZ(1px)");
  assert.equal(await check(), "passed", "axis-aligned 3D translation preserves viewport clipping");
  await page.evaluate(() => document.querySelector("span").style.left = "250px");
  assert.equal(await check(), "motion_contract_content_collision");
  await mount(`<div data-motion-group data-axis="A" data-face-cover="none" data-group-start="0" data-group-duration="5"><div style="overflow:hidden;position:relative;width:250px">${viewport}</div></div>`);
  assert.equal(await page.evaluate(() => clippedContentRect(document.querySelector("#image"), document.querySelector("#root")).right),250,"nested clipping must intersect both viewports");
  await page.evaluate(() => document.querySelector("#image").style.transform = "scale(2)");
  assert.equal(await check(), "passed", "image zoom inside its fixed viewport remains supported");
  const fragment = bindFaceCoverApproval(`<div data-motion-group data-axis="A" data-face-cover="intentional" data-group-start="0" data-group-duration="5">${viewport}</div>`, {id:"proof",layout:{faceCoverApproval:"user",faceSafetyNote:"User permits five seconds of face coverage"}});
  await mount(fragment);
  assert.equal(await check(), "passed");
  for (const axis of ['data-axis = "A"', 'data-axis=A']) {
    await mount(bindFaceCoverApproval(fragment.replace('data-axis="A"', axis), {id:"proof",layout:{faceCoverApproval:"user",faceSafetyNote:"User permits extended coverage"}}));
    assert.equal(await check(), "passed", "legal HTML attribute spelling retains recorded permission");
  }
  await mount(fragment+'<div data-motion-protected="caption" style="position:absolute;left:200px;top:0;width:100px;height:100px"></div>');
  assert.equal(await check(), "motion_contract_protected_overlap", "face permission must not bypass caption protection");
  console.log("Browser layout regressions passed: positioning escape, clipped collisions, nested clipping, zoom, face approval and caption protection.");
} finally {
  await browser.close();
}
