import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildComposition, findContentCollision, rebuildVisualSample } from "../scripts/build-composition.mjs";
import { renderTemplate } from "../scripts/motion-template-library.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(repositoryRoot, "templates", "hyperframes");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-composition-"));

const writeFixture = () => {
  const jobRoot = path.join(temporaryRoot, "job");
  const hyperframes = path.join(jobRoot, "hyperframes");
  fs.mkdirSync(path.join(jobRoot, "state"), { recursive: true });
  fs.cpSync(templateRoot, hyperframes, { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "state", "beat-map.json"), JSON.stringify({
    duration: 2.01,
    fps: 30,
    beats: [{
      id: "beat-001",
      start: 1,
      end: 1.5,
      entryAnchorWordId: "segment-001:word-001",
      exitAnchorWordId: "segment-001:word-002",
      exitAnchorOffsetFrames: 0,
      exitFrames: 3
    }]
  }));
  fs.writeFileSync(path.join(jobRoot, "state", "transcript.json"), JSON.stringify({
    segments: [{
      id: "segment-001",
      words: [
        { text: "一", start: 1, end: 1.1 },
        { text: "二", start: 1.1, end: 1.4 }
      ]
    }]
  }));
  const moduleDirectory = path.join(hyperframes, "mg", "beat-001");
  fs.mkdirSync(moduleDirectory, { recursive: true });
  fs.writeFileSync(path.join(moduleDirectory, "fragment.html"), '<div data-beat-id="beat-001"><span class="copy">内容</span></div>');
  fs.writeFileSync(path.join(moduleDirectory, "style.css"), 'body, .copy { color: white; }\n.copy { content: "}"; }');
  fs.writeFileSync(path.join(moduleDirectory, "timeline.mjs"), 'timeline.set(root, { autoAlpha: 1 }, beat.start);');

  const templatePath = path.join(hyperframes, "index.template.html");
  const captions = [
    '<section class="clip motion-caption-layer" data-caption-id="cue-001" data-caption-start-frame="0" data-caption-end-frame="15" data-start="0" data-duration="0.5"></section>',
    '<section class="clip motion-caption-layer" data-caption-id="cue-boundary" data-caption-start-frame="15" data-caption-end-frame="30" data-start="0.5" data-duration="0.5"></section>',
    '<section class="clip motion-caption-layer" data-caption-id="cue-002" data-caption-start-frame="30" data-caption-end-frame="45" data-start="1" data-duration="0.5"></section>'
  ].join("\n");
  fs.writeFileSync(
    templatePath,
    fs.readFileSync(templatePath, "utf8").replace("<!-- CUT_MOTION_CAPTIONS_START -->", `<!-- CUT_MOTION_CAPTIONS_START -->\n${captions}`)
  );
  return { jobRoot, hyperframes, moduleDirectory };
};

try {
  const contentElement = (rect, { text = "", role, intentional = false } = {}) => ({
    textContent: text,
    dataset: { ...(role ? { motionRole: role } : {}), ...(intentional ? { overlapPolicy: "intentional" } : {}) },
    getBoundingClientRect: () => rect
  });
  const textElement = contentElement(
    { left: 10, right: 110, top: 10, bottom: 60 },
    { text: "入门够用" }
  );
  const collidingIndicator = contentElement(
    { left: 90, right: 130, top: 20, bottom: 60 },
    { text: "✓", role: "indicator" }
  );
  assert.ok(findContentCollision([textElement, collidingIndicator]), "text and indicator overlap must fail");
  assert.equal(findContentCollision([
    textElement,
    contentElement(
      { left: 90, right: 130, top: 20, bottom: 60 },
      { text: "✓", role: "indicator", intentional: true }
    )
  ]), null, "intentional overlap must be explicitly exempted");
  assert.equal(findContentCollision([
    textElement,
    contentElement({ left: 130, right: 170, top: 20, bottom: 60 }, { role: "indicator" })
  ]), null, "separate content must pass");

  assert.equal(fs.existsSync(path.join(templateRoot, "index.html")), false, "generated template output must not be tracked");
  const fixture = writeFixture();

  const full = buildComposition(fixture.hyperframes);
  assert.deepEqual(
    { startFrame: full.startFrame, endFrame: full.endFrame, duration: full.duration },
    { startFrame: 0, endFrame: 61, duration: 61 / 30 }
  );
  const fullHtml = fs.readFileSync(full.outputPath, "utf8");
  {
    let fontsReady, imageReady, timelinesBuilt = 0;
    const fonts = new Promise(resolve => { fontsReady = resolve; });
    const image = new Promise(resolve => { imageReady = resolve; });
    const timeline = {
      set() {}, to() {},
      totalTime() { return 0; }, time() { return 0; }, totalDuration() { return 2; }
    };
    const window = {};
    const runtime = [...fullHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    vm.runInNewContext(runtime, {
      document: { fonts: { ready: fonts }, images: [{ decode: () => image }], querySelector: () => ({}) },
      window,
      gsap: { timeline: () => { timelinesBuilt += 1; return timeline; } }
    });
    assert.equal(timelinesBuilt, 0, "geometry cannot be measured before font loading");
    fontsReady();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timelinesBuilt, 0, "evidence image geometry also needs its final dimensions");
    imageReady();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timelinesBuilt, 1);
    assert.equal(window.__timelines.main, timeline, "register the complete timeline only after layout settles");
  }
  assert.match(fullHtml, /^<!doctype html>\n<!-- GENERATED BY /i);
  assert.match(fullHtml, /@scope \(#mg-beat-001\) \{\nbody, \.copy/);
  assert.match(fullHtml, /id="mg-beat-001"/);
  const runtimeBeat = Function(`return ${fullHtml.match(/const beat = (Object\.freeze\([^;]+\));/)[1]}`)();
  const revealDuration = at => Math.min(.28, Math.max(.04, runtimeBeat.end - at));
  assert.equal(revealDuration(1.05), .28, "assembled templates need a finite entrance duration");
  assert.ok(Math.abs(revealDuration(1.45) - .05) < 1e-6, "entrances must shorten at the authored Beat end");
  const templatePath = path.join(fixture.hyperframes, "index.template.html");
  const validTemplate = fs.readFileSync(templatePath, "utf8");
  fs.writeFileSync(templatePath, validTemplate.replace('data-caption-start-frame="15"', 'data-caption-start-frame="14"'));
  assert.throws(() => buildComposition(fixture.hyperframes), /overlaps/);
  assert.equal(fs.readFileSync(full.outputPath, "utf8"), fullHtml, "failed caption build must preserve the last built output");
  fs.writeFileSync(templatePath, validTemplate);

  {
    const fragmentPath = path.join(fixture.moduleDirectory, "fragment.html");
    const originalFragment = fs.readFileSync(fragmentPath, "utf8");
    fs.writeFileSync(fragmentPath, originalFragment.replace('data-beat-id="beat-001"', 'data-beat-id="beat-001" data-motion-group="proof" data-axis="A" data-face-cover-approval="user"'));
    buildComposition(fixture.hyperframes);
    assert.doesNotMatch(fs.readFileSync(full.outputPath, "utf8"), /data-face-cover-approval/);
    fs.writeFileSync(fragmentPath, originalFragment);
  }

  {
    const fragmentPath = path.join(fixture.moduleDirectory, "fragment.html");
    const originalFragment = fs.readFileSync(fragmentPath, "utf8");
    fs.writeFileSync(fragmentPath, [
      '<div data-beat-id="beat-001">',
      '<div data-motion-group="primary" data-group-start="1" data-group-duration="0.2"></div>',
      '<div data-motion-group="auxiliary" data-group-start="1.3" data-group-duration="0.1"></div>',
      '</div>'
    ].join("\n"));
    const groupedFull = buildComposition(fixture.hyperframes);
    const groupedHtml = fs.readFileSync(groupedFull.outputPath, "utf8");
    assert.match(groupedHtml, /data-motion-group="primary"[^>]*data-group-start="1"[^>]*data-group-duration="0.2"/);
    assert.match(groupedHtml, /data-motion-group="auxiliary"[^>]*data-group-start="1.3"[^>]*data-group-duration="0.1"/);
    const groupedChunkPath = path.join(fixture.hyperframes, "chunks", "f000030-f000060-grouped", "index.html");
    buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, videoOnly: true, outputPath: groupedChunkPath });
    const groupedChunkHtml = fs.readFileSync(groupedChunkPath, "utf8");
    assert.match(groupedChunkHtml, /data-motion-group="primary"[^>]*data-group-start="0"[^>]*data-group-duration="0.2"/);
    assert.match(groupedChunkHtml, /data-motion-group="auxiliary"[^>]*data-group-start="0.3"[^>]*data-group-duration="0.1"/);
    fs.writeFileSync(fragmentPath, originalFragment);
  }

  const chunkPath = path.join(fixture.hyperframes, "chunks", "f000030-f000060", "index.html");
  const episodeCssPath = path.join(fixture.hyperframes, "episode-theme.css");
  fs.writeFileSync(episodeCssPath, ".mg-root { color: #7DF2C4; }");
  const chunk = buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, videoOnly: true, outputPath: chunkPath });
  assert.equal(chunk.duration, 1);
  const chunkHtml = fs.readFileSync(chunkPath, "utf8");
  assert.doesNotMatch(chunkHtml, /cue-001/);
  assert.doesNotMatch(chunkHtml, /cue-boundary/, "a cue ending at the chunk start frame must be excluded");
  assert.match(chunkHtml, /cue-002/);
  assert.match(chunkHtml, /src="\.\/assets\//);
  assert.doesNotMatch(chunkHtml, /\.\.\/assets/);
  assert.equal(fs.realpathSync(path.join(path.dirname(chunkPath), "assets")), fs.realpathSync(path.join(fixture.hyperframes, "assets")));
  assert.equal(
    fs.readFileSync(path.join(path.dirname(chunkPath), "caption.css"), "utf8"),
    fs.readFileSync(path.join(fixture.hyperframes, "caption.css"), "utf8")
  );
  const localizedEpisodeCss = path.join(path.dirname(chunkPath), "episode-theme.css");
  assert.equal(fs.readFileSync(localizedEpisodeCss, "utf8"), fs.readFileSync(episodeCssPath, "utf8"));
  fs.writeFileSync(episodeCssPath, ".mg-root { color: #FFD15C; }");
  buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, videoOnly: true, outputPath: chunkPath });
  assert.equal(fs.readFileSync(localizedEpisodeCss, "utf8"), fs.readFileSync(episodeCssPath, "utf8"), "localized styles must refresh after a theme edit");

  const samplePath = path.join(fixture.hyperframes, "visual-sample", "index.html");
  const sample = buildComposition(fixture.hyperframes, {
    startFrame: 30,
    endFrame: 60,
    outputPath: samplePath
  });
  assert.deepEqual(sample.beatIds, ["beat-001"]);
  const sampleHtml = fs.readFileSync(samplePath, "utf8");
  assert.match(sampleHtml, /<span class="copy">内容<\/span>/);
  assert.doesNotMatch(sampleHtml, /cue-boundary/);
  assert.match(sampleHtml, /cue-002/);
  assert.equal(fs.realpathSync(path.join(path.dirname(samplePath), "assets")), fs.realpathSync(path.join(fixture.hyperframes, "assets")));
  assert.equal(
    fs.readFileSync(path.join(path.dirname(samplePath), "caption.css"), "utf8"),
    fs.readFileSync(path.join(fixture.hyperframes, "caption.css"), "utf8")
  );
  fs.writeFileSync(samplePath, sampleHtml.replace("</style>", ".manual-sample-patch { color: red; }</style>"));
  rebuildVisualSample(fixture.hyperframes);
  assert.equal(
    fs.readFileSync(samplePath, "utf8"),
    sampleHtml,
    "visual-sample advance rebuild must remove hand-authored sample-only changes"
  );
  const fragmentPath = path.join(fixture.moduleDirectory, "fragment.html");
  const originalFragment = fs.readFileSync(fragmentPath, "utf8");
  fs.writeFileSync(fragmentPath, originalFragment.replace("内容", "同源更新"));
  buildComposition(fixture.hyperframes, { startFrame: 30, endFrame: 60, outputPath: samplePath });
  assert.match(fs.readFileSync(samplePath, "utf8"), /同源更新/, "visual sample must rebuild from the canonical MG module");
  fs.writeFileSync(fragmentPath, originalFragment);

  assert.throws(
    () => buildComposition(fixture.hyperframes, { startFrame: 0.5, endFrame: 30 }),
    /half-open integer frame window/
  );
  assert.throws(
    () => buildComposition(fixture.hyperframes, { outputPath: path.join(fixture.jobRoot, "state", "workflow.json") }),
    /Composition output must be/
  );
  const escapedChunkDirectory = path.join(fixture.hyperframes, "chunks", "escape");
  fs.mkdirSync(path.dirname(escapedChunkDirectory), { recursive: true });
  fs.symlinkSync(path.join(fixture.jobRoot, "state"), escapedChunkDirectory);
  assert.throws(
    () => buildComposition(fixture.hyperframes, { outputPath: path.join(escapedChunkDirectory, "index.html") }),
    /resolves outside/
  );
  fs.unlinkSync(escapedChunkDirectory);

  const timelinePath = path.join(fixture.moduleDirectory, "timeline.mjs");
  const validTimeline = fs.readFileSync(timelinePath, "utf8");
  fs.writeFileSync(timelinePath, 'import { gsap } from "gsap";');
  assert.throws(() => buildComposition(fixture.hyperframes), /without imports/);
  fs.writeFileSync(timelinePath, "gsap.timeline();");
  assert.throws(() => buildComposition(fixture.hyperframes), /second timeline/);
  fs.writeFileSync(timelinePath, validTimeline);

  const beatMapPath = path.join(fixture.jobRoot, "state", "beat-map.json");
  const duplicated = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
  duplicated.beats.push({ ...duplicated.beats[0] });
  fs.writeFileSync(beatMapPath, JSON.stringify(duplicated));
  assert.throws(() => buildComposition(fixture.hyperframes), /Duplicate Beat ID/);
  duplicated.beats.pop();
  fs.writeFileSync(beatMapPath, JSON.stringify(duplicated));

  fs.writeFileSync(
    fragmentPath,
    '<div data-beat-id="beat-001" id="mg-beat-001"></div>'
  );
  assert.throws(() => buildComposition(fixture.hyperframes), /reserved generated wrapper ID/);
  const beatMap = JSON.parse(fs.readFileSync(beatMapPath, "utf8"));
  beatMap.captionMode = "subtitles";
  beatMap.beats.push({ id: "beat-missing", start: 1.6, end: 1.8, mgScope: "local" });
  fs.writeFileSync(beatMapPath, JSON.stringify(beatMap));
  assert.throws(() => buildComposition(fixture.hyperframes), /approved motion Beat is missing its MG module/);

  const scaffoldSource = path.join(temporaryRoot, "source.mp4");
  const scaffoldJob = path.join(temporaryRoot, "scaffold-job");
  fs.writeFileSync(scaffoldSource, "fixture");
  execFileSync("bash", [path.join(repositoryRoot, "scripts", "scaffold-project.sh"), scaffoldJob, scaffoldSource], { stdio: "pipe" });
  assert.equal(fs.existsSync(path.join(scaffoldJob, "hyperframes", "index.html")), true, "scaffold must build index.html");

  if (process.argv.includes("--browser")) {
    const { default: puppeteer } = await import("puppeteer-core");
    const chromeRoot = path.join(os.homedir(), ".cache/hyperframes/chrome/chrome-headless-shell");
    const chromeVersion = fs.readdirSync(chromeRoot).filter(name => name.startsWith("mac_arm-")).sort().at(-1);
    const executablePath = path.join(chromeRoot, chromeVersion, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
    const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1920 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setRequestInterception(true);
      let delayedFonts = 0;
      page.on("request", request => {
        if (request.url().endsWith("smiley-sans-oblique.ttf")) {
          delayedFonts += 1;
          setTimeout(() => request.continue(), 200);
        } else request.continue();
      });
      const assets = path.join(fixture.hyperframes, "assets");
      fs.mkdirSync(path.join(assets, "fonts"), { recursive: true });
      fs.copyFileSync(path.join(repositoryRoot, "assets/fonts/smiley-sans-oblique.ttf"), path.join(assets, "fonts/smiley-sans-oblique.ttf"));
      fs.copyFileSync(path.join(repositoryRoot, "node_modules/gsap/dist/gsap.min.js"), path.join(assets, "gsap.min.js"));
      fs.writeFileSync(templatePath, validTemplate.replace("smiley-sans-oblique.woff2", "smiley-sans-oblique.ttf").replace('format("woff2")', 'format("truetype")'));
      const beat = { id: "beat-001", start: .2, end: 7.5, entryAnchorWordId: "segment-001:word-001", exitAnchorWordId: "segment-001:word-002", exitAnchorOffsetFrames: 0, exitFrames: 3,
        templateData: { items: ["项目文件", "图片", "视频", "音频", "模型"], result: "全部在云端", revealTimes: [0, .6, 1.2, 1.8, 2.4, 3] } };
      fs.writeFileSync(beatMapPath, JSON.stringify({ duration: 8, fps: 30, beats: [beat] }));
      fs.writeFileSync(path.join(fixture.jobRoot, "state/transcript.json"), JSON.stringify({ segments: [{ id: "segment-001", words: [{ text: "开始", start: .2, end: .3 }, { text: "结果", start: 7, end: 7.5 }] }] }));
      const sources = renderTemplate("converge-sources", beat);
      for (const [key, filename] of [["fragment", "fragment.html"], ["style", "style.css"], ["timeline", "timeline.mjs"]]) fs.writeFileSync(path.join(fixture.moduleDirectory, filename), sources[key]);
      buildComposition(fixture.hyperframes);
      await page.goto(pathToFileURL(full.outputPath).href);
      await page.waitForFunction(() => Boolean(window.__timelines?.main));
      const geometry = await page.evaluate(() => {
        const timeline = window.__timelines.main;
        timeline.seek(6);
        const root = document.querySelector('[data-beat-id="beat-001"]'), base = root.getBoundingClientRect();
        const inputs = [...root.querySelectorAll(".converge-inputs h3")];
        const branches = [...root.querySelectorAll("path[data-link-at]")].slice(0, inputs.length);
        const states = time => { timeline.seek(time); return inputs.map(node => [getComputedStyle(node).opacity, getComputedStyle(node).visibility]); };
        const early = states(.25), late = states(6), again = states(.25);
        timeline.seek(6);
        const result = root.querySelector(".converge-result").getBoundingClientRect();
        return { fontsLoaded: document.fonts.check('64px "Smiley Sans"'), early, late, again,
          resultSample: { x: Math.round(result.left + 24), y: Math.round(result.top + result.height / 2) },
          errors: inputs.map((node, index) => {
            const box = node.getBoundingClientRect(), point = branches[index].getPointAtLength(0);
            return Math.max(Math.abs(point.x - (box.left - base.left + box.width / 2)), Math.abs(point.y - (box.bottom - base.top)));
          }) };
      });
      assert.ok(delayedFonts > 0, "exercise late loading of the actual local font");
      assert.equal(geometry.fontsLoaded, true);
      // offset metrics round to whole layout pixels; keep endpoints within one pixel.
      assert.ok(geometry.errors.every(value => value < 1), `connector endpoints drifted: ${geometry.errors}`);
      assert.deepEqual(geometry.early, geometry.again, "production timeline must seek backwards deterministically");
      assert.ok(geometry.late.every(([opacity, visibility]) => opacity === "1" && visibility === "visible"));
      assert.deepEqual(errors, []);
      // Exercise the pinned renderer's timeline readiness, without requiring job media.
      fs.writeFileSync(full.outputPath, fs.readFileSync(full.outputPath, "utf8").replace(/<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/g, ""));
      const snapshots = path.join(temporaryRoot, "snapshots");
      execFileSync(path.join(repositoryRoot, "node_modules/.bin/hyperframes"), ["snapshot", "--at", "6", "--no-end", "--describe", "false", "--output", snapshots],
        { cwd: fixture.hyperframes, stdio: "pipe", timeout: 60000 });
      const png = fs.readdirSync(snapshots).find(file => file.endsWith(".png"));
      assert.ok(png, "pinned CLI must capture the async production composition");
      await page.goto(pathToFileURL(path.join(snapshots, png)).href);
      const pixel = await page.evaluate(({ x, y }) => {
        const image = document.querySelector("img"), canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return [...context.getImageData(x, y, 1, 1).data];
      }, geometry.resultSample);
      assert.ok([125, 242, 196].every((value, index) => Math.abs(value - pixel[index]) <= 3), `CLI snapshot missed the revealed result: ${pixel}`);
      console.log("Production browser geometry passed: delayed font, five input endpoints and repeated seeking.");
    } finally { await browser.close(); }
  }

  console.log("Composition builder tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
