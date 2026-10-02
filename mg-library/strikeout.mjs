/**
 * Dependency strike-out: a label enters fully saturated, a coral rule sweeps
 * across it at the spoken negation, and both settle into the accepted "already
 * cancelled" state instead of fading away.
 */
import { requireItems, panelCss, panelEntrance, eventTime, round, PANEL_OPEN } from "./shared.mjs";

export const meta = {
  name: "strikeout",
  summary: "Strike a label through at the moment the narration rejects it.",
  summaryZh: "口播否定的那一刻，把标签划掉。",
  primaryFlowAxis: "horizontal",
  semanticTopology: "emphasis",
  motionFamily: "editorial",
  transitionFamily: "strike-reveal",
  params: {
    onScreenCopy: "exactly 1 label",
    microEvents: "tool-chip-in, strike-start, strike-lock (types are read by name)"
  }
};

export const render = ({ beat, geometry, events = [] }) => {
  const [label] = requireItems(beat, 1);
  if ((beat.onScreenCopy ?? []).length !== 1) throw new Error(`${beat.id}: strikeout takes exactly one label`);

  const labelIn = eventTime(events, ["tool-chip-in", "label-in", "chip-in"], beat.start + 0.1);
  const strikeStart = eventTime(events, ["strike-start", "strike-begin"], beat.start + Math.max(0.5, (beat.end - beat.start) * 0.55));
  const strikeLock = eventTime(events, ["strike-lock", "strike-end"], Math.max(strikeStart + 0.5, beat.end - 0.34));

  const inner = [
      PANEL_OPEN,
    '    <div class="tool-row">',
    `      <div class="tool-name">${escapeHtml(label)}</div>`,
    '      <div class="strike-mark"></div>',
    "    </div>",
    "  </div>"
  ].join("\n");

  const style = [
    panelCss(geometry),
    ".tool-row{position:relative;display:inline-flex;align-items:center;justify-content:center}",
    `.tool-name{height:168px;padding:0 48px;display:flex;align-items:center;border-radius:14px;background:rgba(255,255,255,.1);font-size:96px;line-height:1;font-weight:400;white-space:nowrap}`,
    `.strike-mark{position:absolute;left:-16px;right:-16px;top:50%;height:8px;margin-top:-4px;border-radius:4px;background:var(--coral);transform-origin:left center;transform:scaleX(0)}`
  ].join("\n");

  const timeline = [
    'const toolName = select(".tool-name");',
    'const strikeMark = select(".strike-mark");',
    panelEntrance(),
    `// ${labelIn}: the label enters fully saturated, so the rejection has a subject.`,
    `timeline.fromTo(toolName, { y: -20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.26, ease: "power3.out" }, ${labelIn});`,
    `// ${strikeStart}: the spoken negation becomes the strike itself.`,
    `timeline.fromTo(strikeMark, { scaleX: 0 }, { scaleX: 1, duration: ${round(Math.max(0.4, Math.min(0.8, strikeLock - strikeStart)), 2)}, ease: "power2.inOut" }, ${strikeStart});`,
    `// ${strikeLock}: the strike locks and the label desaturates as the accepted final state.`,
    `timeline.to(toolName, { color: "rgba(255,255,255,.68)", filter: "saturate(0.5)", duration: 0.2, ease: "power2.out" }, ${strikeLock});`,
    `timeline.to(strikeMark, { boxShadow: "0 0 24px rgba(236,84,79,.72)", duration: 0.2, ease: "power2.out" }, ${strikeLock});`
  ].join("\n");

  return { inner, style, timeline };
};

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
