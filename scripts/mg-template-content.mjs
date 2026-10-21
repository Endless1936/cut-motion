/** Content structure for the reusable MGs; choreography remains in each template. */
import { mgIcon } from "./mg-template-icons.mjs";
import { redactionContent } from "./mg-redaction-content.mjs";
const escape = value => { if (typeof value !== "string") throw new Error("MG text must be strings"); return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); };
const text = value => escape(value).replaceAll("\n", "<br>");
const numericText = (value, field) => {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`${field} needs nonempty text or a finite number`);
};
const labelOf = item => typeof item === "string" ? item : item.label ?? item.text;
const paragraph = (className, value, timed = true) => value ? `<p class="${className}"${timed ? ' data-at="0"' : ""}>${text(value)}</p>` : "";
const list = (items, { descriptionParts = false } = {}) => {
  if (!Array.isArray(items) || !items.length) throw new Error("MG items need at least one item");
  return items.map(item => {
    if (typeof item !== "string" && (!item || typeof item !== "object")) throw new Error("MG items need text or labelled objects");
    const label = labelOf(item);
    const description = item.description;
    const validDescription = description === undefined || typeof description === "string"
      || (descriptionParts && Array.isArray(description) && description.length > 0
        && description.every(part => typeof part === "string" && part.trim()));
    if (typeof label !== "string" || !label.trim() || !validDescription) throw new Error("MG items need text strings; comparison descriptions may contain separately timed text parts");
    return typeof item === "string" ? { label } : { ...item, label };
  });
};

export function templateContent(name, beat) {
  if (name === "redaction-mask") return redactionContent(beat.templateData ?? {}, beat);
  const data = beat.templateData ?? {};
  const copy = data.copy ?? beat.onScreenCopy ?? [];
  let body, words = [], axis = "vertical", normalizedData = {};
  const add = value => { if (value) words.push(value); return value; };
  const title = (className, fallback = "") => paragraph(className, add(data.title ?? fallback));
  switch (name) {
    case "ordered-steps": {
      const items = list(data.items ?? Array.from({ length: Math.ceil(copy.length / 2) }, (_, i) => ({ label: copy[i * 2], description: copy[i * 2 + 1] })));
      normalizedData = { items };
      body = `<section class="steps-panel" data-motion-surface="container"><div class="steps-surface" aria-hidden="true"></div>${title("steps-title")}<div class="steps-list">${items.map((item, i) => {
        add(item.label); add(item.description);
        return `<article class="step" data-at="0">${i ? '<i class="step-link" aria-hidden="true"></i>' : ""}<span class="step-number">${String(i + 1).padStart(2, "0")}</span><div class="step-copy"><h3>${text(item.label)}</h3>${paragraph("step-description", item.description, false)}</div></article>`;
      }).join("")}</div></section>`;
      break;
    }
    case "parallel-points": {
      const items = list(data.items ?? copy);
      normalizedData = { items };
      axis = data.layout === "chips" ? "horizontal" : "vertical";
      body = `<section class="points-panel" data-motion-surface="container"><div class="points-surface" aria-hidden="true"></div>${title("points-title")}<div class="points-list" style="--items:${items.length}">${items.map(item => {
        add(item.label); add(item.description);
        return `<article class="point${item.emphasis ? " point-emphasis" : ""}" data-at="0"><span class="point-mark" aria-hidden="true">${mgIcon(item.label, item.icon)}</span><div>${paragraph("point-copy", item.label, false)}${paragraph("point-description", item.description, false)}</div></article>`;
      }).join("")}</div>${paragraph("points-conclusion", add(data.conclusion))}</section>`;
      break;
    }
    case "linear-flow": {
      const items = list(data.items ?? copy);
      normalizedData = { items };
      axis = data.layout === "vertical" || (data.layout === undefined && items.length > 4) ? "vertical" : "horizontal";
      body = `<section class="flow-panel" data-motion-surface="container">${title("flow-title")}<div class="flow-nodes" style="--items:${items.length}">${items.map((item, i) => {
        add(item.label); add(item.description);
        return `<article class="flow-node" data-at="0">${i ? '<i class="flow-link" aria-hidden="true"></i>' : ""}<span class="flow-orb" aria-hidden="true">${mgIcon(item.label, item.icon)}</span><div class="flow-copy"><h3>${text(item.label)}</h3>${paragraph("flow-description", item.description, false)}</div></article>`;
      }).join("")}</div></section>`;
      break;
    }
    case "relation-map": {
      const source = add(data.source ?? copy[0]);
      const items = list(data.items ?? copy.slice(1));
      normalizedData = { source, items };
      body = `<section class="map-panel"><article class="map-source" data-at="0"><span class="source-mark" aria-hidden="true">${mgIcon(source, data.sourceIcon)}</span><h3>${text(source)}</h3></article><div class="map-targets" style="--items:${items.length}">${items.map(item => {
        add(item.label); add(item.description);
        return `<article class="map-target" data-at="0"><i class="map-drop" aria-hidden="true">${mgIcon(item.label, item.icon)}</i><h4>${text(item.label)}</h4>${paragraph("map-description", item.description, false)}</article>`;
      }).join("")}</div><svg class="map-wiring" aria-hidden="true"><path class="map-path" fill="none"/></svg></section>`;
      break;
    }
    case "converge-sources": {
      const items = list(data.items ?? copy.slice(0, -1));
      normalizedData = { items, result: data.result ?? copy.at(-1) };
      const columns = items.length <= 4 ? items.length : 3;
      const remaining = items.length % columns;
      const lastRow = items.length - remaining;
      body = `<section class="converge-panel"><div class="converge-inputs" style="--items:${items.length};--grid-columns:${columns * 2};--input-font-size:${items.length > 4 ? 56 : 64}px">${items.map((item, i) => {
        const column = remaining && i >= lastRow ? ` style="grid-column:${columns - remaining + 1 + (i - lastRow) * 2} / span 2"` : "";
        return `<h3 data-at="0"${column}>${text(add(item.label))}</h3>`;
      }).join("")}</div><svg class="converge-wiring" aria-hidden="true"><g class="converge-branches"></g><path class="converge-collector" fill="none"/></svg>${paragraph("converge-result", add(data.result ?? copy.at(-1)))}</section>`;
      break;
    }
    case "map-transform": {
      axis = data.layout === "horizontal" ? "horizontal" : "vertical";
      normalizedData = { source: data.source ?? copy[0], result: data.result ?? copy[1] };
      body = `<section class="transform-panel"><h3 class="transform-source" data-at="0">${text(add(data.source ?? copy[0]))}</h3><div class="transform-link" aria-hidden="true"><i></i><span></span></div>${paragraph("transform-result", add(data.result ?? copy[1]))}</section>`;
      break;
    }
    case "comparison": {
      axis = data.layout === "vertical" ? "vertical" : "horizontal";
      const items = list(data.items ?? [{ label: copy[1], description: copy[2] }, { label: copy[3], description: copy[4] }], { descriptionParts: true });
      normalizedData = { items, title: data.title ?? (data.items ? "" : copy[0] ?? "") };
      body = title("compare-topic", normalizedData.title) + `<div class="compare-grid" style="--items:${items.length}">${items.map((item, i) => {
        add(item.label);
        const descriptions = Array.isArray(item.description) ? item.description : [item.description];
        return `<section class="compare-side${i ? " compare-right" : " compare-left"}"><span class="compare-kicker" data-at="0">${text(item.label)}</span>${descriptions.map(part => paragraph("compare-value", add(part))).join("")}</section>`;
      }).join("")}</div>`;
      break;
    }
    case "metric-proof": {
      const structured = data.value !== undefined;
      normalizedData = { source: data.source ?? (structured ? "" : copy[0] ?? ""), value: data.value ?? copy[1], unit: data.unit ?? (structured ? "" : copy[2] ?? ""), caption: data.caption ?? (structured ? "" : copy[3] ?? "") };
      body = paragraph("proof-source", add(normalizedData.source)) + `<div class="proof-reading" data-at="0"><span class="proof-value">${text(add(normalizedData.value))}</span>${normalizedData.unit ? `<span class="proof-unit">${text(add(normalizedData.unit))}</span>` : ""}</div>` + paragraph("proof-caption", add(normalizedData.caption));
      break;
    }
    case "metric-grid": {
      const items = list(data.items);
      normalizedData = { title: data.title ?? "", items };
      body = `<section class="metrics-panel">${title("metrics-title")}<div class="metrics-rows">${items.map(item => {
        const value = numericText(item.value, "metric value");
        add(item.label); add(value); add(item.unit); add(item.note);
        return `<article class="metric-row${item.emphasis ? " metric-emphasis" : ""}" data-at="0"><span class="metric-label">${text(item.label)}</span><div class="metric-reading"><span class="metric-value">${text(value)}</span>${item.unit ? `<span class="metric-unit">${text(item.unit)}</span>` : ""}</div>${paragraph("metric-note", item.note, false)}</article>`;
      }).join("")}</div></section>`;
      break;
    }
    case "comparison-table": {
      if (!Array.isArray(data.headers) || data.headers.length < 2 || data.headers.length > 3 || !data.headers.every(v => typeof v === "string" && v.trim())) throw new Error("comparison-table needs two or three text headers");
      if (!Array.isArray(data.rows) || !data.rows.length) throw new Error("comparison-table needs rows");
      normalizedData = { title: data.title ?? "", headers: data.headers, rows: data.rows };
      body = `<section class="table-panel">${title("table-title")}<div class="table-grid" style="--columns:${data.headers.length}"><div class="table-head" data-at="0">${data.headers.map(value => `<div class="table-cell"><span class="table-value">${text(add(value))}</span></div>`).join("")}</div>${data.rows.map(row => {
        const values = Array.isArray(row) ? row : row.values;
        if (!Array.isArray(values) || values.length !== data.headers.length) throw new Error("comparison-table row width must match headers");
        const cells = !Array.isArray(row) && row.reveal === "cells";
        return `<div class="table-row${row.emphasis ? " table-emphasis" : ""}"${cells ? "" : ' data-at="0"'}>${values.map(value => `<div class="table-cell"${cells ? ' data-at="0"' : ""}><span class="table-value">${text(add(numericText(value, "table value")))}</span></div>`).join("")}</div>`;
      }).join("")}</div></section>`;
      break;
    }
    case "factor-expansion": {
      const items = list(data.items);
      normalizedData = { source: data.source, structure: data.structure, items, result: data.result };
      const source = add(data.source), structure = add(data.structure);
      body = `<section class="factor-panel"><div class="factor-origin"><p class="factor-source" data-at="0">${text(source)}</p><span class="factor-arrow" aria-hidden="true"><svg viewBox="0 0 64 32"><path d="M4 16h52M45 5l11 11-11 11"/></svg></span><p class="factor-core" data-at="0">${text(structure)}</p></div><svg class="factor-wiring" aria-hidden="true"></svg><div class="factor-items" style="--columns:${Math.min(3, items.length)}">${items.map(item => {
        add(item.label); const value = add(numericText(item.value, "factor value"));
        return `<article class="factor-item" data-at="0"><span class="factor-icon">${mgIcon(item.label, item.icon)}</span><span class="factor-label">${text(item.label)}</span><strong class="factor-value">${text(value)}</strong></article>`;
      }).join("")}</div><div class="factor-result" data-at="0"><div class="factor-pool" aria-hidden="true"></div><span class="factor-result-copy">${text(add(data.result))}</span></div></section>`;
      break;
    }
    case "growth-trend": {
      const items = list(data.items);
      if (items.some(item => !Number.isFinite(item.value) || item.value < 0)) throw new Error("growth-trend values must be finite nonnegative numbers");
      normalizedData = { title: data.title ?? "", items, result: data.result };
      body = `<section class="growth-panel">${title("growth-title")}<div class="growth-chart"><svg class="growth-axes" aria-hidden="true"></svg><svg class="growth-line" aria-hidden="true"></svg><div class="growth-columns" style="--columns:${items.length}">${items.map(item => `<article class="growth-item" data-at="0" data-value="${item.value}"><div class="growth-bar-shell"><div class="growth-bar"></div></div><span class="growth-value">${text(add(String(item.value)))}</span><span class="growth-label">${text(add(item.label))}</span></article>`).join("")}</div></div>${paragraph("growth-result", add(data.result))}</section>`;
      break;
    }
    case "evidence-focus": {
      const focus = data.focus ?? [];
      body = `<div class="evidence-surface" data-collision-unit><div class="evidence-canvas"><img class="evidence-image" src="${escape(data.image)}" alt="${escape(data.alt)}">${focus.map(({ x, y, width, height }) => `<span class="evidence-focus" data-at="0" style="left:${x}%;top:${y}%;width:${width}%;height:${height}%" aria-hidden="true"></span>`).join("")}</div></div>`;
      break;
    }
    case "quote": {
      normalizedData = { text: data.text ?? copy[0], credit: data.credit ?? (data.text !== undefined ? "" : copy[1] ?? "") };
      body = '<div class="quote-rule" data-at="0"></div>' + paragraph("quote-copy", add(normalizedData.text)) + paragraph("quote-credit", add(normalizedData.credit));
      break;
    }
    case "code-snippet": {
      const items = list(data.items ?? copy.slice(1));
      normalizedData = { items, title: data.title ?? (data.items ? "" : copy[0] ?? "") };
      body = `<section class="code-panel" data-motion-surface="container">${title("code-label", normalizedData.title)}<div class="code-lines">${items.map((item, i) => {
        add(item.label);
        return `<div class="code-line${i === data.highlightIndex || item.emphasis ? " code-highlight" : ""}" data-at="0"><span class="code-number">${String(i + 1).padStart(2, "0")}</span><code>${text(item.label)}</code></div>`;
      }).join("")}</div></section>`;
      break;
    }
    case "correction": {
      normalizedData = { old: data.old ?? copy[0], replacement: data.replacement ?? copy[1] };
      body = `<p class="correction-old" data-at="0">${text(add(data.old ?? copy[0]))}<span class="correction-strike" data-at="0" aria-hidden="true"></span></p>${paragraph("correction-new", add(data.replacement ?? copy[1]))}`;
      break;
    }
    case "annotation": {
      const items = list(data.items ?? copy);
      normalizedData = { items };
      axis = "horizontal";
      body = `<p class="annotation-caption-copy" data-collision-unit>${items.map(item => `<span data-at="0">${text(add(item.label))}</span>`).join("")}</p>`;
      break;
    }
    default: return null;
  }
  if (words.some(value => typeof value !== "string")) throw new Error(`${beat.id}: MG text must be strings`);
  return { body, copy: words, axis, normalizedData };
}
