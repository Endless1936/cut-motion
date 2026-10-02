/**
 * Mapping: one labelled source feeds one labelled output through a single
 * directional connector. Source sits above the result so the arrow can never be
 * read backwards.
 */
import { requireItems, panelCss, panelEntrance, eventTime, needsSilhouette, silhouetteReveal, round, PANEL_OPEN } from "./shared.mjs";

export const meta = {
  name: "mapping",
  summary: "Connect a source label to an output label with one directional link.",
  primaryFlowAxis: "vertical",
  semanticTopology: "mapping",
  motionFamily: "technical",
  transitionFamily: "link-build",
  params: {
    onScreenCopy: "exactly 2 labels: [source, output]",
    microEvents: "tool-chip-in, link-line/output-container, output-label, link-lock (read by name)",
    containerRule: "the output container opens with a dim silhouette of its label whenever output-label lands 0.4s or more later"
  }
};

export const render = ({ beat, geometry, events = [] }) => {
  const items = requireItems(beat, 2);
  if (items.length !== 2) throw new Error(`${beat.id}: mapping takes exactly two labels [source, output]`);
  const [source, output] = items;

  const sourceIn = eventTime(events, ["tool-chip-in", "source-chip-in", "chip-in"], beat.start + 0.1);
  const linkIn = eventTime(events, ["link-line", "output-container", "link-build"], round(sourceIn + 0.5, 3));
  const outputIn = eventTime(events, ["output-label", "result-lock"], round(linkIn + 0.8, 3));
  const result = eventTime(events, ["link-lock", "lock"], outputIn + 1.0 > beat.end ? beat.end - 1 / 30 : round(outputIn + 1.0, 3));

  // The output container opens before the spoken result names it. Without a
  // placeholder the viewer stares at an empty tinted box for that whole stretch.
  const silhouette = needsSilhouette(linkIn, outputIn);

  const inner = [
      PANEL_OPEN,
    '    <div class="source-chip">' + escapeHtml(source) + "</div>",
    '    <div class="link-line"><span class="link-head"></span></div>',
    '    <div class="output-box">',
    '      <span class="output-dot"></span>',
    `      <span class="output-name">${escapeHtml(output)}</span>`,
    "    </div>",
    "  </div>"
  ].join("\n");

  const style = [
    panelCss(geometry),
    ".source-chip{height:112px;padding:0 32px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:rgba(255,255,255,.08);font-size:72px;line-height:1;font-weight:400;white-space:nowrap}",
    ".link-line{position:relative;width:5px;height:86px;background:var(--connector);transform-origin:top center;transform:scaleY(0)}",
    ".link-head{position:absolute;left:50%;bottom:-2px;width:20px;height:20px;margin-left:-10px;border-right:5px solid var(--connector);border-bottom:5px solid var(--connector);transform:rotate(45deg);opacity:0}",
    ".output-box{height:152px;padding:0 40px;display:flex;align-items:center;justify-content:center;gap:20px;border-radius:16px;background:rgba(49,85,255,.18);box-shadow:inset 0 0 0 4px rgba(49,85,255,.34)}",
    ".output-dot{width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.28)}",
    ".output-name{font-size:72px;line-height:1;font-weight:400;color:#ffffff;opacity:0}"
  ].join("\n");

  const timeline = [
    'const sourceChip = select(".source-chip");',
    'const linkLine = select(".link-line");',
    'const linkHead = select(".link-head");',
    'const outputBox = select(".output-box");',
    'const outputDot = select(".output-dot");',
    'const outputName = select(".output-name");',
    panelEntrance(),
    `// ${sourceIn}: the tool label takes the frame.`,
    `timeline.fromTo(sourceChip, { y: -20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.26, ease: "power3.out" }, ${sourceIn});`,
    `// ${linkIn}: connector and output container reveal as one group.`,
    `timeline.fromTo(linkLine, { scaleY: 0 }, { scaleY: 1, duration: 0.26, ease: "power2.out" }, ${linkIn});`,
    `timeline.fromTo(linkHead, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18, ease: "power2.out" }, ${round(linkIn + 0.2, 2)});`,
    `timeline.fromTo(outputBox, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.24, ease: "power2.out" }, ${linkIn});`,
    `timeline.to(outputDot, { opacity: 0.35, duration: 0.22, repeat: 2, yoyo: true, ease: "sine.inOut" }, ${round(linkIn + 0.1, 2)});`,
    ...(silhouette
      ? [
          `// ${linkIn}: the output box holds a dim silhouette so the container is never an empty shape.`,
          silhouetteReveal(".output-name", linkIn)
        ]
      : []),
    `// ${outputIn}: the output is labelled with the spoken result.`,
    `timeline.to(outputName, { autoAlpha: 1, duration: 0.26, ease: "power3.out" }, ${outputIn});`,
    `timeline.to(outputDot, { backgroundColor: "#3155ff", opacity: 1, duration: 0.22, ease: "power2.out" }, ${outputIn});`,
    `// ${round(result, 2)}: the link locks and holds.`,
    `timeline.to(linkHead, { boxShadow: "0 0 20px rgba(255,255,255,.5)", duration: 0.2, ease: "power2.out" }, ${round(result, 2)});`
  ].join("\n");

  return { inner, style, timeline };
};

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
