/**
 * Convergence: several labelled sources merge into one result container.
 * Encodes "these N things all come from / resolve to the same place".
 */
import { requireItems, panelCss, panelEntrance, eventTime, eventTimes, round, PANEL_OPEN } from "./shared.mjs";

export const meta = {
  name: "convergence",
  summary: "Merge two to four labelled sources into a single result container.",
  summaryZh: "两到四个素材标签并成一组，汇入同一个结果容器。",
  primaryFlowAxis: "vertical",
  semanticTopology: "convergence",
  motionFamily: "technical",
  transitionFamily: "convergence-build",
  params: {
    onScreenCopy: "2-5 labels; the last is the result, the rest are sources",
    microEvents: "source-chip-in per source, then merge-line/merge-container, then result-lock"
  }
};

export const render = ({ beat, geometry, events = [] }) => {
  const items = requireItems(beat, 2);
  if (items.length < 3 || items.length > 5) throw new Error(`${beat.id}: convergence needs 2-4 sources plus one result label`);
  const sources = items.slice(0, -1);
  const result = items.at(-1);

  const declared = eventTimes(events, ["source-chip-in", "chip-in", "input-in"]);
  const chipTimes = sources.map((_, index) => declared[index] ?? round(beat.start + 0.1 + index * 0.06, 3));
  const mergeTime = eventTime(events, ["merge-line", "merge-container", "merge-connector"], round(Math.max(...chipTimes) + 0.2, 3));
  const lockTime = eventTime(events, ["result-lock", "lock"], round(Math.max(beat.end - 0.4, mergeTime + 0.6), 3));

  const sourceChips = sources.map((source) => `      <div class="source-chip">${escapeHtml(source)}</div>`).join("\n");
  const mergeLines = sources.map(() => [
    "      <div class=\"merge-slot\">",
    '        <div class="merge-line"></div>',
    "      </div>"
  ].join("\n")).join("\n");

  const inner = [
      PANEL_OPEN,
    '    <div class="source-row">',
    sourceChips,
    "    </div>",
    '    <div class="merge-field">',
    mergeLines,
    "    </div>",
    '    <div class="collector-bar"></div>',
    '    <div class="merge-trunk"></div>',
    '    <div class="result-box">',
    `      <span class="result-name">${escapeHtml(result)}</span>`,
    '      <span class="lock-dot"></span>',
    "    </div>",
    "  </div>"
  ].join("\n");

  const slotWidth = round(Math.max(120, 760 / sources.length), 0);
  const style = [
    panelCss(geometry),
    ".source-row{display:flex;align-items:center;justify-content:center;gap:14px;height:112px}",
    ".source-chip{height:112px;padding:0 20px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(255,255,255,.08);font-size:72px;line-height:1;font-weight:400;white-space:nowrap}",
    ".merge-field{display:flex;align-items:flex-start;justify-content:center;gap:14px;height:64px;margin-top:8px}",
    `.merge-slot{width:${slotWidth}px;height:64px;display:flex;align-items:flex-start;justify-content:center}`,
    ".merge-line{width:4px;height:100%;background:var(--connector);transform-origin:top center;transform:scaleY(0)}",
    ".collector-bar{width:778px;height:4px;border-radius:2px;background:var(--connector);transform-origin:center;transform:scaleX(0)}",
    ".merge-trunk{width:4px;height:44px;background:var(--connector);transform-origin:top center;transform:scaleY(0)}",
    ".result-box{height:152px;padding:0 40px;display:flex;align-items:center;justify-content:center;gap:20px;border-radius:16px;background:rgba(49,85,255,.24);box-shadow:0 22px 54px rgba(49,85,255,.26)}",
    ".result-name{font-size:96px;line-height:1;font-weight:400;color:rgba(255,255,255,.42)}",
    ".lock-dot{width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.25)}"
  ].join("\n");

  const timeline = [
    'const chips = select(".source-chip");',
    'const lines = select(".merge-line");',
    'const collector = select(".collector-bar");',
    'const trunk = select(".merge-trunk");',
    'const resultBox = select(".result-box");',
    'const resultName = select(".result-name");',
    'const lockDot = select(".lock-dot");',
    panelEntrance(),
    chipTimes.map((time, index) => `// ${time}: source label ${index + 1} arrives.\ntimeline.fromTo(chips[${index}], { y: -20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.24, ease: "power3.out" }, ${time});`).join("\n"),
    `// ${mergeTime}: lines, collector, trunk and container share one reveal group.`,
    `timeline.fromTo(lines, { scaleY: 0 }, { scaleY: 1, duration: 0.26, ease: "power2.out", stagger: 0.02 }, ${mergeTime});`,
    `timeline.fromTo(collector, { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${mergeTime});`,
    `timeline.fromTo(trunk, { scaleY: 0, autoAlpha: 0 }, { scaleY: 1, autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${mergeTime});`,
    `timeline.fromTo(resultBox, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${mergeTime});`,
    `// ${lockTime}: the result locks onto the spoken name.`,
    `timeline.to(resultName, { color: "#ffffff", duration: 0.22, ease: "power2.out" }, ${lockTime});`,
    `timeline.to(lockDot, { backgroundColor: "#3155ff", duration: 0.22, ease: "power2.out" }, ${lockTime});`,
    `timeline.fromTo(resultBox, { scale: 1 }, { scale: 1.045, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.inOut" }, ${lockTime});`
  ].join("\n");

  return { inner, style, timeline };
};

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
