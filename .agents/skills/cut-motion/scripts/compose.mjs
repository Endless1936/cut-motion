import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { renderTemplate, templateRoot, escapeHtml } from "./templates.mjs";
import { setup } from "./setup.mjs";

const assets = fileURLToPath(new URL("../assets/", import.meta.url));
const json = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const seconds = value => Number(Number(value).toFixed(6));
const finite = value => typeof value === "number" && Number.isFinite(value);
export function probe(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate", "-of", "json", file], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
  return JSON.parse(result.stdout);
}

export function compose(planPathInput, outputInput, { prepareRuntime = true, mediaProbe = probe } = {}) {
  const planPath = path.resolve(planPathInput), job = path.dirname(planPath);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const video = path.resolve(job, plan.source?.video ?? "");
  if (!plan.source?.video || !fs.statSync(video).isFile()) throw new Error("plan.source.video must identify the approved A-roll file");
  const media = mediaProbe(video), duration = Number(media.format?.duration);
  const width = plan.width ?? 1080, height = plan.height ?? 1920, fps = plan.fps ?? 30;
  if (![width, height, fps, duration].every(value => finite(value) && value > 0)) throw new Error("Canvas, FPS and media duration must be positive");
  if (!media.streams?.some(stream => stream.codec_type === "video") || !media.streams.some(stream => stream.codec_type === "audio")) throw new Error("Approved A-roll requires a video and audio stream");
  const mode = plan.captionMode ?? "subtitles";
  if (!["subtitles", "motion-copy"].includes(mode)) throw new Error("captionMode must be subtitles or motion-copy");
  const composition = path.resolve(outputInput ?? path.join(job, "composition"));
  if (prepareRuntime) setup(composition);
  fs.mkdirSync(path.join(composition, "assets"), { recursive: true });
  const mediaName = `a-roll${path.extname(video) || ".mp4"}`;
  const mediaTarget = path.join(composition, "assets", mediaName);
  try { fs.lstatSync(mediaTarget); fs.unlinkSync(mediaTarget); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.symlinkSync(video, mediaTarget);
  let fontCss = "";
  const fontCandidates = plan.font ? [path.resolve(job, plan.font)] : [];
  if (!plan.font) for (const start of [assets, job]) {
    for (let directory = start; ; directory = path.dirname(directory)) {
      for (const extension of ["woff2", "ttf"]) fontCandidates.push(path.join(directory, "fonts", `smiley-sans-oblique.${extension}`), path.join(directory, "assets/fonts", `smiley-sans-oblique.${extension}`));
      if (directory === path.dirname(directory)) break;
    }
  }
  const font = fontCandidates.find(file => fs.existsSync(file));
  if (font) {
    if (fs.existsSync(font)) {
      const name = `font${path.extname(font)}`;
      fs.copyFileSync(font, path.join(composition, "assets", name));
      fontCss = `@font-face{font-family:"Smiley Sans";src:url("./assets/${name}");font-display:swap}`;
    }
  }
  const captionCss = fs.readFileSync(path.join(assets, "caption.css"), "utf8");
  const styles = [], fragments = [], scripts = [], snapshots = [];
  scripts.push('timeline.set("#root",{attr:{"data-stage":"false"}},0);timeline.set("#a-roll",{attr:{"data-picture-in-picture":"false"}},0);');
  const ids = new Set();
  const range = (entry, label) => {
    if (!finite(entry.start) || !finite(entry.end) || entry.start < 0 || entry.end <= entry.start || entry.end > duration + 1 / fps) throw new Error(`${label}: timing must be inside the approved A-roll`);
  };
  for (const [index, caption] of (plan.captions ?? []).entries()) {
    range(caption, `caption ${index + 1}`);
    const id = `caption-${index + 1}`;
    const lines = mode === "motion-copy" ? (caption.lines ?? [{ text: caption.text, at: caption.start }]) : [{ text: caption.text, at: caption.start }];
    if (!lines.length || lines.some(line => typeof line.text !== "string" || !line.text.trim() || !finite(line.at) || line.at < caption.start || line.at >= caption.end)) throw new Error(`${id}: text and line onset are required`);
    fragments.push(`<section id="${id}" class="clip caption ${mode === "motion-copy" ? "motion-copy" : ""}" data-start="${caption.start}" data-duration="${seconds(caption.end - caption.start)}" data-track-index="80">${lines.map((line, row) => `<p id="${id}-line-${row}" class="${line.emphasis ? "emphasis" : ""}">${escapeHtml(line.text)}</p>`).join("")}</section>`);
    scripts.push(`timeline.set("#${id}",{autoAlpha:1},${caption.start});timeline.set("#${id}",{autoAlpha:0},${caption.end});`);
    if (mode === "motion-copy") lines.forEach((line, row) => scripts.push(`timeline.fromTo("#${id}-line-${row}",{autoAlpha:0,y:14},{autoAlpha:1,y:0,duration:${Math.min(.22, caption.end - line.at)},immediateRender:false},${line.at});`));
  }
  for (const [motionIndex, motion] of (plan.motions ?? []).entries()) {
    range(motion, motion.id ?? "motion");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(motion.id ?? "") || ids.has(motion.id)) throw new Error("Motion IDs must be unique lowercase names");
    ids.add(motion.id);
    if (motion.template === "stage/axis-stage-transition") {
      const directory = path.join(templateRoot, motion.template);
      styles.push(fs.readFileSync(path.join(directory, "axis-stage.css"), "utf8"));
      scripts.push(fs.readFileSync(path.join(directory, "axis-stage-transitions.js"), "utf8"));
      scripts.push(`window.addAxisStageTransitions(timeline,{root:document.querySelector("#root"),speaker:document.querySelector("#a-roll"),intervals:[[${motion.start},${motion.end}]],duration:${Math.min(.8,(motion.end-motion.start)/2)},frame:{width:${width},height:${height}},pip:${json(motion.data?.pip ?? {})}});`);
      snapshots.push({ id: motion.id, start: motion.start, end: motion.end, snapshotAt: seconds((motion.start + motion.end) / 2) });
      continue;
    }
    const revealAt = motion.revealAt;
    if (revealAt && (!Array.isArray(revealAt) || revealAt.some(at => !finite(at) || at < motion.start || at >= motion.end))) throw new Error(`${motion.id}: revealAt must contain absolute times inside the motion`);
    const beat = { id: motion.id, start: motion.start, end: motion.end, duration: motion.end - motion.start, axis: motion.data?.axis ?? "A", onScreenCopy: motion.copy ?? [], templateData: { ...motion.data, copy: motion.copy ?? motion.data?.copy ?? [], ...(revealAt ? { revealTimes: revealAt.map(at => seconds(at - motion.start)) } : {}) } };
    let module;
    if (motion.template === "custom") {
      if (typeof motion.data?.module !== "string") throw new Error(`${motion.id}: custom MG needs data.module pointing to its HTML/CSS/GSAP directory`);
      const directory = path.resolve(job, motion.data.module);
      module = Object.fromEntries([["fragment", "fragment.html"], ["style", "style.css"], ["timeline", "timeline.mjs"]].map(([key, name]) => [key, fs.readFileSync(path.join(directory, name), "utf8")]));
      module.fragment = module.fragment.replace(/\{\{copy\[(\d+)\]\}\}/g, (_, index) => {
        if (typeof motion.copy?.[Number(index)] !== "string") throw new Error(`${motion.id}: custom copy[${index}] is missing`);
        return escapeHtml(motion.copy[Number(index)]);
      });
      module.fragment = module.fragment.replace(/\sdata-beat-id=["'][^"']*["']/, "").replace(/(<[a-z][^>]*)(>)/i, `$1 data-beat-id="${motion.id}"$2`);
      let slot = 0;
      if (revealAt) module.fragment = module.fragment.replace(/data-at=["'][^"']*["']/g, () => `data-at="${seconds(revealAt[slot++] - motion.start)}"`);
    } else module = renderTemplate(motion.template, beat);
    const slots = [...module.fragment.matchAll(/data-at="[^"]*"/g)].length;
    if (revealAt && slots !== revealAt.length) throw new Error(`${motion.id}: revealAt count must match the ${slots} template elements`);
    if (slots > 1 && !revealAt) throw new Error(`${motion.id}: supply actual speech onsets in revealAt for ${slots} elements`);
    module.fragment = module.fragment.replace(/(<[^>]*\bdata-motion-group(?:\s|=|>)[^>]*)(>)/g, (tag, open, close) => /data-group-start=/.test(open) ? tag : `${open} data-group-start="${motion.start}" data-group-duration="${seconds(motion.end-motion.start)}"${close}`);
    if (motion.data?.image) {
      const relative = motion.data.image.replace(/^\.\//, ""), image = path.resolve(job, relative), target = path.join(composition, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(image, target);
    }
    const last = Math.max(motion.start, ...(revealAt ?? []));
    const stage = motion.template.startsWith("stage/");
    const snapshotAt = seconds(Math.min(motion.end - 1 / fps, Math.max(motion.start + (stage ? .9 : .35), last + .30)));
    const exitStart = Math.min(motion.end, Math.max(motion.end - .22, snapshotAt + .01));
    styles.push(`@scope (#mg-${motion.id}) {\n${module.style}\n}`);
    fragments.push(`<section id="mg-${motion.id}" class="clip ${stage ? "axis-stage-content" : "mg-layer"}" data-start="${motion.start}" data-duration="${seconds(motion.end - motion.start)}" data-track-index="${stage ? 10 : 20 + motionIndex}">${module.fragment}</section>`);
    scripts.push(`{const beat=${json({ ...beat, exitStartTime: exitStart, exitDuration: motion.end - exitStart })};const root=document.querySelector(${json(`[data-beat-id="${motion.id}"]`)});const select=selector=>[...root.querySelectorAll(selector)];\n${module.timeline}\ntimeline.to(root,{autoAlpha:0,duration:${seconds(motion.end-exitStart)},ease:"power2.in"},${seconds(exitStart)});timeline.set(root,{autoAlpha:0},${motion.end});}`);
    snapshots.push({ id: motion.id, template: motion.template, start: motion.start, end: motion.end, revealAt: revealAt ?? [motion.start], snapshotAt });
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Cut Motion</title><script src="./assets/gsap.min.js"></script><style>${fontCss}\n*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:"Smiley Sans",sans-serif;font-weight:400;font-synthesis:none}#root{position:relative;width:${width}px;height:${height}px;overflow:hidden}.clip{position:absolute;inset:0}#a-roll{width:100%;height:100%;object-fit:cover}.mg-layer{z-index:20;pointer-events:none}${captionCss}\n${styles.join("\n")}</style></head><body><div id="root" class="axis-stage-root" data-composition-id="main" data-width="${width}" data-height="${height}" data-fps="${fps}" data-start="0" data-duration="${duration}"><video id="a-roll" class="clip axis-stage-speaker" src="./assets/${mediaName}" data-start="0" data-duration="${duration}" data-media-start="0" data-track-index="0" muted playsinline preload="auto"></video><audio id="source-audio" src="./assets/${mediaName}" data-start="0" data-duration="${duration}" data-media-start="0" data-track-index="1" data-volume="1" preload="auto"></audio>${fragments.join("\n")}</div><script>const timeline=gsap.timeline({paused:true});${scripts.join("\n")}timeline.set({}, {}, ${duration});window.__timelines={main:timeline};</script></body></html>`;
  fs.writeFileSync(path.join(composition, "index.html"), fontCss ? html : html.replaceAll('"Smiley Sans",', ""));
  const metadata = { width, height, fps, duration, source: video, plan: planPath, motions: snapshots };
  fs.writeFileSync(path.join(composition, "composition.json"), JSON.stringify(metadata, null, 2) + "\n");
  return { composition, ...metadata };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: compose.mjs <plan.json> [composition-directory]");
  const result = compose(process.argv[2], process.argv[3]);
  console.log(`Built ${result.motions.length} MGs: ${result.composition}`);
}
