import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { compose } from "../scripts/compose.mjs";
import { snapshotTimes } from "../scripts/mg-frames.mjs";
import { setup } from "../scripts/setup.mjs";

const mediaProbe = () => ({ format: { duration: "10" }, streams: [{ codec_type: "video", width: 1080, height: 1920 }, { codec_type: "audio" }] });
function fixture(t, patch = {}) {
  const job = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-compose-"));
  t.after(() => fs.rmSync(job, { recursive: true, force: true }));
  fs.writeFileSync(path.join(job, "a-roll.mp4"), "test media");
  const plan = { source: { video: "a-roll.mp4" }, captionMode: "subtitles", captions: [{ text: "豆包工作任务", start: 1, end: 3 }], motions: [{ id: "steps", template: "ordered-steps", start: 1, end: 6, data: { title: "完整生产流程", items: ["初始化", "文案", "音频", "成片"] }, revealAt: [1, 1.1, 1.8, 2.9, 4.2] }], ...patch };
  const planPath = path.join(job, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan));
  const result = compose(planPath, undefined, { prepareRuntime: false, mediaProbe });
  return { job, planPath, result, html: fs.readFileSync(path.join(result.composition, "index.html"), "utf8") };
}

test("corrected captions remain authoritative and MG uses actual absolute speech onsets", t => {
  const { html, result } = fixture(t);
  assert.match(html, /豆包工作任务/);
  assert.doesNotMatch(html, /豆包工做/);
  assert.match(html, /data-at="0.1"/);
  assert.match(html, /data-at="3.2"/);
  assert.match(html, /bottom: 384px/);
  assert.match(html, /font-size: 96px/);
  assert.match(html, /left:0;right:0;margin-inline:auto/);
  assert.equal((html.match(/<audio\b/g) ?? []).length, 1);
  assert.match(html, /<video[^>]+muted/);
  assert.equal(result.motions[0].snapshotAt, 4.5);
  assert.deepEqual(snapshotTimes({ motions: [...result.motions, ...result.motions] }), [4.5]);
});

test("motion-copy uses timed central text and no separate subtitle line", t => {
  const { html } = fixture(t, { captionMode: "motion-copy", captions: [{ text: "unused transcript", start: 1, end: 4, lines: [{ text: "让工具", at: 1 }, { text: "跟着表达走", at: 2.3, emphasis: true }] }] });
  assert.match(html, /class="clip caption motion-copy"/);
  assert.match(html, /让工具/);
  assert.match(html, /跟着表达走/);
  assert.doesNotMatch(html, /unused transcript/);
  assert.match(html, /duration:0.22,immediateRender:false\},2.3/);
});

test("rerunning composition updates the same source link and does not mutate plan", t => {
  const { job, planPath, result } = fixture(t);
  const original = fs.readFileSync(planPath, "utf8");
  compose(planPath, result.composition, { prepareRuntime: false, mediaProbe });
  assert.equal(fs.readFileSync(planPath, "utf8"), original);
  assert.equal(fs.realpathSync(path.join(result.composition, "assets/a-roll.mp4")), fs.realpathSync(path.join(job, "a-roll.mp4")));
});

test("invalid speech times do not silently fall back to fixed intervals", t => {
  assert.throws(() => fixture(t, { motions: [{ id: "bad", template: "ordered-steps", start: 1, end: 3, copy: ["音频", "剪辑"], revealAt: [1, 4] }] }), /absolute times inside/);
  assert.throws(() => fixture(t, { motions: [{ id: "bad", template: "ordered-steps", start: 1, end: 3, data: { items: ["音频", "剪辑"] } }] }), /actual speech onsets/);
});

test("A-roll without an audio stream is not silently delivered muted", t => {
  const job = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-compose-"));
  t.after(() => fs.rmSync(job, { recursive: true, force: true }));
  fs.writeFileSync(path.join(job, "a-roll.mp4"), "test media");
  const planPath = path.join(job, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify({ source: { video: "a-roll.mp4" } }));
  assert.throws(() => compose(planPath, undefined, { prepareRuntime: false, mediaProbe: () => ({ format: { duration: 10 }, streams: [{ codec_type: "video" }] }) }), /video and audio stream/);
});

test("custom HTML/CSS/GSAP module uses the same unique plan and actual onsets", t => {
  const { job, planPath } = fixture(t, { motions: [] });
  const module = path.join(job, "mg/custom");
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, "fragment.html"), '<div class="custom"><p data-at="0">{{copy[0]}}</p><p data-at="0">{{copy[1]}}</p></div>');
  fs.writeFileSync(path.join(module, "style.css"), '.custom{position:absolute;top:280px;left:0;right:0;margin:auto;width:720px;opacity:0}.custom p{visibility:hidden}');
  fs.writeFileSync(path.join(module, "timeline.mjs"), 'timeline.set(root,{autoAlpha:1},beat.start);select("[data-at]").forEach(el=>timeline.set(el,{autoAlpha:1},beat.start+Number(el.dataset.at)));');
  fs.writeFileSync(planPath, JSON.stringify({ source: { video: "a-roll.mp4" }, captions: [], motions: [{ id: "custom", template: "custom", start: 1, end: 5, copy: ["文案", "剪辑"], data: { module: "mg/custom" }, revealAt: [1.2, 3.3] }] }));
  const result = compose(planPath, undefined, { prepareRuntime: false, mediaProbe });
  const html = fs.readFileSync(path.join(result.composition, "index.html"), "utf8");
  assert.match(html, /data-beat-id="custom"/);
  assert.match(html, /data-at="0.2"/);
  assert.match(html, /data-at="2.3"/);
  assert.match(html, /文案/);
  assert.doesNotMatch(html, /\{\{copy/);
  assert.equal(result.motions[0].snapshotAt, 3.6);
});

test("stage seek then backward seek restores full-screen speaker below ordinary MG", { skip: !process.env.CUT_MOTION_BROWSER_PATH }, async t => {
  const { job, planPath } = fixture(t);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  plan.motions.push({ id: "transition", template: "stage/axis-stage-transition", start: 6, end: 9 });
  fs.writeFileSync(planPath, JSON.stringify(plan));
  const result = compose(planPath, undefined, { prepareRuntime: false, mediaProbe });
  const runtime = setup(result.composition);
  const require = createRequire(path.join(runtime.modules, "hyperframes/package.json"));
  const { default: puppeteer } = await import(pathToFileURL(require.resolve("puppeteer-core")).href);
  const browser = await puppeteer.launch({ executablePath: process.env.CUT_MOTION_BROWSER_PATH, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(result.composition, "index.html")).href);
  await page.addScriptTag({ path: path.join(runtime.modules, "hyperframes/dist/hyperframe.runtime.iife.js") });
  const visibility = await page.evaluate(() => {
    const state = () => ({ stage: document.querySelector("#root").dataset.stage, pip: document.querySelector("#a-roll").dataset.pictureInPicture, speakerZ: Number(getComputedStyle(document.querySelector("#a-roll")).zIndex), cardZ: Number(getComputedStyle(document.querySelector("#mg-steps")).zIndex), cardOpacity: Number(getComputedStyle(document.querySelector('[data-beat-id="steps"]')).opacity) });
    window.__player.renderSeek(7.5);
    const stage = state();
    window.__player.renderSeek(2.2);
    return { stage, before: state() };
  });
  assert.equal(visibility.stage.pip, "true");
  assert.equal(visibility.before.pip, "false");
  assert.equal(visibility.before.stage, "false");
  assert.ok(visibility.before.speakerZ < visibility.before.cardZ);
  assert.equal(visibility.before.cardOpacity, 1);
});
