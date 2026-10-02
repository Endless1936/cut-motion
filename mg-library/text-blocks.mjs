/**
 * Markdown-primitive MG components: ordered list, unordered list, quote, code
 * block and heading. They share one implementation because they differ only in
 * how the leading marker is drawn and how the panel opens.
 */
import { panelCss, panelEntrance, requireItems, revealCadence, PANEL_OPEN } from "./shared.mjs";

const VARIANTS = {
  "list-ordered": {
    summary: "A vertical numbered list that reveals item by item.",
    summaryZh: "纵向编号列表，逐条揭示。",
    primaryFlowAxis: "vertical",
    semanticTopology: "sequence",
    transitionFamily: "list-build",
    numbered: true
  },
  "list-unordered": {
    summary: "A vertical bulleted list that reveals item by item.",
    summaryZh: "纵向项目符号列表，逐条揭示。",
    primaryFlowAxis: "vertical",
    semanticTopology: "sequence",
    transitionFamily: "list-build",
    numbered: false
  },
  quote: {
    summary: "A single quoted line held behind a rule.",
    summaryZh: "一条引文停在分隔线之上。",
    primaryFlowAxis: "horizontal",
    semanticTopology: "evidence",
    transitionFamily: "quote-reveal"
  },
  "code-block": {
    summary: "A bordered block whose lines type on in sequence.",
    summaryZh: "带边框的代码块，逐行键入。",
    primaryFlowAxis: "vertical",
    semanticTopology: "sequence",
    transitionFamily: "code-build"
  },
  heading: {
    summary: "One large statement that scales into place.",
    summaryZh: "一句大字陈述放大就位。",
    primaryFlowAxis: "horizontal",
    semanticTopology: "emphasis",
    transitionFamily: "title-reveal"
  }
};

const PANEL_CLOSE = "  </div>";

const renderList = ({ beat, geometry, events, items, numbered }) => {
  const rows = items.map((item, index) => [
    '    <div class="row">',
    `      <span class="marker${numbered ? " marker-number" : ""}">${numbered ? String(index + 1) : "•"}</span>`,
    `      <span class="item">${escapeHtml(item)}</span>`,
    "    </div>"
  ].join("\n")).join("\n");
  const style = [
    panelCss(geometry, { extra: ".row{display:flex;align-items:center;gap:28px;width:100%;margin-bottom:22px}.row:last-child{margin-bottom:0}" }),
    ".marker{flex:0 0 auto;min-width:72px;height:72px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.1);font-size:44px;line-height:1}",
    ".marker-number{background:rgba(49,85,255,.34)}",
    ".item{font-size:88px;line-height:1;font-weight:400;white-space:nowrap}"
  ].join("\n");
  const times = revealCadence(events, items.length, beat.start);
  const timeline = [
    'const rows = select(".row");',
    panelEntrance(),
    times.map((time, index) => `timeline.fromTo(rows[${index}], { x: -34, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.26, ease: "power3.out" }, ${time});`).join("\n")
  ].join("\n");
  return { inner: `  ${PANEL_OPEN}\n${rows}\n${PANEL_CLOSE}`, style, timeline };
};

const renderQuote = ({ beat, geometry, events, items }) => {
  const text = items.join(" ");
  const [time] = revealCadence(events, 1, beat.start);
  const style = [
    panelCss(geometry),
    ".quote-row{display:flex;align-items:center;gap:36px;max-width:100%}",
    ".quote-rule{flex:0 0 auto;width:8px;height:150px;border-radius:4px;background:var(--coral);transform-origin:top center;transform:scaleY(0)}",
    ".quote-text{font-size:88px;line-height:1.1;font-weight:400}"
  ].join("\n");
  const timeline = [
    'const rule = select(".quote-rule");',
    'const quoteText = select(".quote-text");',
    panelEntrance(),
    `timeline.fromTo(rule, { scaleY: 0 }, { scaleY: 1, duration: 0.26, ease: "power2.out" }, ${time});`,
    `timeline.fromTo(quoteText, { autoAlpha: 0, x: -22 }, { autoAlpha: 1, x: 0, duration: 0.3, ease: "power3.out" }, ${Number((time + 0.08).toFixed(3))});`
  ].join("\n");
  return {
    inner: `  ${PANEL_OPEN}\n    <div class="quote-row">\n      <div class="quote-rule"></div>\n      <div class="quote-text">${escapeHtml(text)}</div>\n    </div>\n${PANEL_CLOSE}`,
    style,
    timeline
  };
};

const renderCodeBlock = ({ beat, geometry, events, items }) => {
  const lines = items.map((item) => `      <span class="code-line">${escapeHtml(item)}</span>`).join("\n");
  const times = revealCadence(events, items.length, beat.start, 0.12);
  const style = [
    panelCss(geometry),
    ".code-frame{width:100%;box-sizing:border-box;border-radius:16px;background:rgba(0,0,0,.34);box-shadow:inset 0 0 0 3px rgba(255,255,255,.14);padding:40px;display:flex;flex-direction:column;gap:20px;opacity:0}",
    ".code-line{font-size:76px;line-height:1.1;font-weight:400;letter-spacing:2px;white-space:nowrap}"
  ].join("\n");
  const timeline = [
    'const frame = select(".code-frame");',
    'const lines = select(".code-line");',
    panelEntrance(),
    `timeline.fromTo(frame, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${times[0]});`,
    times.map((time, index) => `timeline.fromTo(lines[${index}], { autoAlpha: 0, x: -18 }, { autoAlpha: 1, x: 0, duration: 0.2, ease: "power3.out" }, ${time});`).join("\n")
  ].join("\n");
  return { inner: `  ${PANEL_OPEN}\n    <div class="code-frame">\n${lines}\n    </div>\n${PANEL_CLOSE}`, style, timeline };
};

const renderHeading = ({ beat, geometry, events, items }) => {
  const text = items.join(" ");
  const [time] = revealCadence(events, 1, beat.start);
  const style = [
    panelCss(geometry),
    ".headline{font-size:132px;line-height:1.05;font-weight:400;text-align:center;transform-origin:center}"
  ].join("\n");
  const timeline = [
    'const headline = select(".headline");',
    panelEntrance(),
    `timeline.fromTo(headline, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.34, ease: "power3.out" }, ${time});`
  ].join("\n");
  return { inner: `  ${PANEL_OPEN}\n    <div class="headline">${escapeHtml(text)}</div>\n${PANEL_CLOSE}`, style, timeline };
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const textBlockComponent = (name) => {
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`unknown text-block variant: ${name}`);
  return {
    meta: {
      name,
      summary: variant.summary,
      primaryFlowAxis: variant.primaryFlowAxis,
      semanticTopology: variant.semanticTopology,
      motionFamily: "editorial",
      transitionFamily: variant.transitionFamily,
      params: { onScreenCopy: "1-4 labels", microEvents: "one entry per label, revealed in order" }
    },
    render: (context) => {
      const items = requireItems(context.beat, 1);
      if (items.length > 4) throw new Error(`${context.beat.id}: ${name} supports at most 4 labels`);
      if (name === "list-ordered" || name === "list-unordered") return renderList({ ...context, items, numbered: variant.numbered });
      if (name === "quote") return renderQuote({ ...context, items });
      if (name === "code-block") return renderCodeBlock({ ...context, items });
      return renderHeading({ ...context, items });
    }
  };
};

export const TEXT_BLOCK_NAMES = Object.keys(VARIANTS);
