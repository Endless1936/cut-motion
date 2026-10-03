import fs from "node:fs";
import path from "node:path";
import { resolveCaptionCues } from "./caption-review-utils.mjs";
import { captionFrameWindow } from "./frame-window-utils.mjs";
import { assertRegularContainedFile, isPathInside, readJson, sha256File } from "./workflow-utils.mjs";

const [captionsPath, pagesPath, designSystemPath, compositionPath] = process.argv.slice(2);
if (!captionsPath || !pagesPath || !designSystemPath) {
  console.error("Usage: node check-captions.mjs <captions.json> <chatcut-pages.json> <design-system.json> [hyperframes-index.html]");
  process.exit(64);
}

const parsedCaptions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
const parsedPagesDocument = JSON.parse(fs.readFileSync(pagesPath, "utf8"));
const parsedDesignSystem = JSON.parse(fs.readFileSync(designSystemPath, "utf8"));
const captions = parsedCaptions && typeof parsedCaptions === "object" && !Array.isArray(parsedCaptions) ? parsedCaptions : {};
const pagesDocument = parsedPagesDocument && typeof parsedPagesDocument === "object" && !Array.isArray(parsedPagesDocument)
  ? parsedPagesDocument : {};
const designSystem = parsedDesignSystem && typeof parsedDesignSystem === "object" && !Array.isArray(parsedDesignSystem)
  ? parsedDesignSystem : {};
const errors = [];
if (captions !== parsedCaptions) errors.push("release captions must be a JSON object");
if (pagesDocument !== parsedPagesDocument) errors.push("ChatCut timing evidence must be a JSON object");
if (designSystem !== parsedDesignSystem) errors.push("Caption design system must be a JSON object");
captions.source = captions.source && typeof captions.source === "object" && !Array.isArray(captions.source) ? captions.source : {};
captions.style = captions.style && typeof captions.style === "object" && !Array.isArray(captions.style) ? captions.style : {};
const expectedStyle = designSystem.captions && typeof designSystem.captions === "object" && !Array.isArray(designSystem.captions)
  ? designSystem.captions : {};
if (Object.keys(captions.source).length === 0) errors.push("release captions require a source object");
if (Object.keys(captions.style).length === 0) errors.push("release captions require a style object");
if (Object.keys(expectedStyle).length === 0) errors.push("caption design system requires a captions style object");
const jobRoot = path.dirname(path.dirname(path.resolve(captionsPath)));
const pagesJobRoot = path.dirname(path.dirname(path.resolve(pagesPath)));
if (pagesJobRoot !== jobRoot) errors.push("captions and ChatCut timing evidence must belong to the same job");
for (const [candidate, label] of [[captionsPath, "Release captions"], [pagesPath, "ChatCut timing evidence"]]) {
  try {
    assertRegularContainedFile(jobRoot, path.resolve(candidate), label);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${label} is not a regular job file`);
  }
}
try {
  const designStat = fs.lstatSync(path.resolve(designSystemPath));
  if (!designStat.isFile() || designStat.isSymbolicLink()) errors.push("Caption design system must be a non-symlink regular file");
} catch {
  errors.push("Caption design system must be a readable regular file");
}
const normalizeCaptionText = (value) => [...String(value ?? "").normalize("NFKC").toLowerCase()]
  .filter((character) => !/[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉—–\-]/u.test(character))
  .join("");
if (!Array.isArray(captions.cues) || captions.cues.length === 0) errors.push("release captions require at least one cue");
if (captions.source?.kind !== "approved-semantic-plan") errors.push("release captions must originate from an approved semantic plan");
if (!Number.isFinite(pagesDocument.fps) || pagesDocument.fps <= 0) errors.push("ChatCut timing evidence requires a positive fps");
if (captions.source?.fps !== pagesDocument.fps) errors.push("caption fps must match the locked edit timeline");
if (captions.source?.roughCutLocked !== true) errors.push("captions require a locked ChatCut rough cut");
if (captions.source?.captionRenderDisabled !== true || pagesDocument.captionRenderDisabled !== true) {
  console.warn("Warning: ChatCut caption rendering is not confirmed disabled; check the final MP4 for duplicate captions.");
}
const validCleanExport = (value) => (typeof value === "boolean" && value === true)
  || (typeof value === "string" && value.trim().length > 0);
if (!Object.hasOwn(captions.source, "cleanExport") || !Object.hasOwn(pagesDocument, "cleanExport")
  || !validCleanExport(captions.source.cleanExport)
  || !validCleanExport(pagesDocument.cleanExport)
  || captions.source.cleanExport !== pagesDocument.cleanExport) {
  errors.push("caption clean export must match the locked ChatCut export");
}
const isSourceWordEvidence = pagesDocument.source === "ChatCut inspect_asset original source word rows";
if (pagesDocument.source !== "chatcut-viewer-pages" && !isSourceWordEvidence) errors.push("raw timing evidence must originate from ChatCut viewer pages or source word rows");
if (pagesDocument.source === "chatcut-viewer-pages") {
  const evidenceRows = Array.isArray(pagesDocument.pages)
    ? pagesDocument.pages
    : Array.isArray(pagesDocument.cards) ? pagesDocument.cards : [];
  const usesCards = !Array.isArray(pagesDocument.pages) && Array.isArray(pagesDocument.cards);
  if (evidenceRows.length === 0) {
    errors.push("ChatCut viewer evidence requires non-empty pages");
  } else {
    const legacyPages = !usesCards && evidenceRows.every((page) => typeof page?.id === "string" && page.id
      && Number.isFinite(page.start) && Number.isFinite(page.end) && page.start >= 0 && page.end > page.start
      && typeof page.text === "string" && page.text.trim());
    const modernPages = !usesCards && evidenceRows.every((page) => typeof page?.id === "string" && page.id
      && Number.isInteger(page.startFrame) && Number.isInteger(page.endFrame)
      && page.startFrame >= 0 && page.endFrame > page.startFrame
      && typeof page.viewerText === "string" && page.viewerText.trim());
    const cardPages = usesCards && evidenceRows.every((page) => typeof page?.id === "string" && page.id
      && Number.isInteger(page.startFrame) && Number.isInteger(page.endFrame)
      && page.startFrame >= 0 && page.endFrame > page.startFrame
      && typeof page.text === "string" && page.text.trim());
    if (!legacyPages && !modernPages && !cardPages) errors.push("ChatCut viewer evidence contains invalid page ranges");
    const starts = legacyPages ? evidenceRows.map((page) => page.start) : evidenceRows.map((page) => page.startFrame);
    const ends = legacyPages ? evidenceRows.map((page) => page.end) : evidenceRows.map((page) => page.endFrame);
    if (starts.some((start, index) => index > 0 && start < ends[index - 1])) {
      errors.push("ChatCut viewer evidence pages must be ordered and non-overlapping");
    }
  }
}
if (isSourceWordEvidence) {
  const rows = Array.isArray(pagesDocument.rows) ? pagesDocument.rows : [];
  const validRows = rows.filter((row) => Number.isFinite(row?.startMs) && Number.isFinite(row?.endMs) && row.endMs > row.startMs);
  if (!rows.length || validRows.length !== rows.length) errors.push("source word evidence requires valid source timestamps");
  // Rows follow released timeline order. Source positions may rewind when a
  // shot is reordered or intentionally reused; the mapping below checks order.

  const mappingReference = pagesDocument.timelineMapping;
  let mapping = null;
  let mappingLoaded = false;
  if (typeof mappingReference !== "string" || !mappingReference || path.isAbsolute(mappingReference)) {
    errors.push("source word evidence requires a relative timeline mapping");
  } else {
    const mappingPath = path.resolve(jobRoot, mappingReference);
    if (!isPathInside(jobRoot, mappingPath)) {
      errors.push("source word timeline mapping must stay inside the job");
    } else {
      try {
        const containedPath = assertRegularContainedFile(jobRoot, mappingPath, "Source word timeline mapping");
        if (!/^[a-f0-9]{64}$/i.test(String(pagesDocument.timelineMappingSha256 ?? ""))) {
          errors.push("source word timeline mapping requires a SHA-256");
        } else if (sha256File(containedPath) !== String(pagesDocument.timelineMappingSha256).toLowerCase()) {
          errors.push("source word timeline mapping hash does not match the evidence");
        }
        mapping = readJson(containedPath);
        mappingLoaded = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "source word timeline mapping is unreadable");
      }
    }
  }

  const entries = Array.isArray(mapping?.entries) ? mapping.entries : [];
  const validEntries = entries.filter((entry) => Number.isFinite(entry?.sourceStartMs)
    && Number.isFinite(entry?.sourceEndMs)
    && entry.sourceStartMs >= 0
    && entry.sourceEndMs > entry.sourceStartMs
    && Number.isInteger(entry?.timelineStartFrame)
    && Number.isInteger(entry?.timelineEndFrame)
    && entry.timelineStartFrame >= 0
    && entry.timelineEndFrame > entry.timelineStartFrame);
  const mappingIsObject = mappingLoaded && mapping !== null && typeof mapping === "object" && !Array.isArray(mapping);
  if (mappingLoaded && !mappingIsObject) errors.push("source word timeline mapping must be a JSON object");
  if (mappingIsObject && mapping.schemaVersion !== "1.0.0") errors.push("source word timeline mapping schemaVersion must be 1.0.0");
  if (mappingIsObject && (typeof mapping.fps !== "number" || !Number.isFinite(mapping.fps) || mapping.fps !== pagesDocument.fps)) {
    errors.push("source word timeline mapping fps must match the locked edit timeline");
  }
  if (mappingIsObject && (!entries.length || validEntries.length !== entries.length)) errors.push("source word timeline mapping contains invalid ranges");
  if (mappingIsObject && validRows.length && validEntries.length === entries.length) {
    if (entries.length !== validRows.length) {
      errors.push("source word timeline mapping requires one entry per source word row");
    } else {
      for (let index = 0; index < validRows.length; index += 1) {
        const row = validRows[index];
        const entry = entries[index];
        if (Math.abs(entry.sourceStartMs - row.startMs) > 0.001 || Math.abs(entry.sourceEndMs - row.endMs) > 0.001) {
          errors.push("source word timeline mapping entries must preserve source word row order and bounds");
          break;
        }
        if (index > 0) {
          const previous = entries[index - 1];
          const sharesOneEvidenceFrame = entry.timelineStartFrame === previous.timelineStartFrame
            && entry.timelineEndFrame === previous.timelineEndFrame
            && entry.timelineEndFrame === entry.timelineStartFrame + 1;
          if (entry.timelineStartFrame < previous.timelineEndFrame && !sharesOneEvidenceFrame) {
            errors.push("source word timeline mapping timeline ranges must be ordered; only adjacent words sharing one frame may overlap");
            break;
          }
        }
      }
    }
  }

  const covers = (ranges, start, end, startKey, endKey) => {
    let cursor = start;
    for (const range of [...ranges].sort((left, right) => left[startKey] - right[startKey])) {
      if (range[endKey] <= cursor) continue;
      if (range[startKey] > cursor) return false;
      cursor = Math.max(cursor, range[endKey]);
      if (cursor >= end) return true;
    }
    return cursor >= end;
  };
  if (mappingIsObject && validEntries.length) {
    if (validRows.some((row) => !covers(validEntries, row.startMs, row.endMs, "sourceStartMs", "sourceEndMs"))) {
      errors.push("source word timeline mapping does not cover every source word row");
    }
    for (const cue of captions.cues ?? []) {
      try {
        const window = captionFrameWindow(cue);
        if (!covers(validEntries, window.startFrame, window.endFrame, "timelineStartFrame", "timelineEndFrame")) {
          errors.push("source word timeline mapping does not cover every released caption cue");
          break;
        }
      } catch {
        // The normal cue loop below reports malformed caption windows.
      }
    }
  }
}
if (pagesDocument.roughCutLocked !== true) errors.push("ChatCut timing evidence is not locked");

for (const [field, expected] of Object.entries(expectedStyle)) {
  if (JSON.stringify(captions.style?.[field]) !== JSON.stringify(expected)) errors.push(`Caption style ${field} must match the design system`);
}
if (captions.style?.fontWeight !== 400) errors.push("Captions must use normal weight 400");

let previousEndFrame = 0;
for (const cue of captions.cues ?? []) {
  const cueId = cue?.id ?? "caption cue";
  if (typeof cue?.id !== "string" || !cue.id
    || typeof cue?.sourcePageId !== "string" || !cue.sourcePageId
    || !Number.isInteger(cue?.startFrame) || !Number.isInteger(cue?.endFrame)
    || !Number.isFinite(cue?.start) || !Number.isFinite(cue?.end) || cue.end <= cue.start
    || typeof cue?.viewerText !== "string" || !cue.viewerText.trim()) {
    errors.push(`${cueId}: missing required caption fields`);
  }
  let window;
  try {
    window = captionFrameWindow(cue);
  } catch (error) {
    errors.push(error.message);
    continue;
  }
  if (window.startFrame < previousEndFrame) errors.push(`${cue.id}: overlaps the previous caption cue`);
  if (Math.abs(cue.start - cue.startFrame / captions.source.fps) > 0.000001
    || Math.abs(cue.end - cue.endFrame / captions.source.fps) > 0.000001) {
    errors.push(`${cue.id}: seconds must be quantized from timeline frames`);
  }
  if (!Array.isArray(cue.lines) || cue.lines.length !== 1 || typeof cue.lines[0] !== "string"
    || !cue.lines[0].trim() || /[\r\n]/.test(cue.lines[0])) {
    errors.push(`${cue.id}: must contain exactly one rendered line`);
  }
  previousEndFrame = window.endFrame;
}

const reviewPlanRelativePath = captions.source.reviewPlan ?? "captions/caption-review-plan.json";
const reviewPlanPath = typeof reviewPlanRelativePath === "string"
  ? path.resolve(jobRoot, reviewPlanRelativePath)
  : null;
if (!reviewPlanPath || path.isAbsolute(reviewPlanRelativePath) || !isPathInside(jobRoot, reviewPlanPath)) {
  errors.push("approved semantic captions require a review plan inside the job");
} else if (!fs.existsSync(reviewPlanPath)) {
  errors.push("approved semantic captions require their review plan");
} else {
  try {
    assertRegularContainedFile(jobRoot, reviewPlanPath, "Caption review plan");
    const reviewPlan = readJson(reviewPlanPath);
    const transcriptPath = path.join(jobRoot, "state", "transcript.json");
    if (reviewPlan.status !== "approved") errors.push("semantic caption plan must be marked approved before promotion");
    if (!Array.isArray(reviewPlan.cues) || reviewPlan.cues.length !== captions.cues.length) errors.push("promoted cue count differs from the approved plan");
    let transcript = null;
    if (!fs.existsSync(transcriptPath)) {
      errors.push("approved semantic captions require their transcript authority");
    } else {
      try {
        assertRegularContainedFile(jobRoot, transcriptPath, "Transcript authority");
        transcript = readJson(transcriptPath);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Transcript authority is unreadable");
      }
    }
    const resolvedCues = transcript ? resolveCaptionCues(reviewPlan, transcript) : [];
    const totalWordCount = (transcript?.segments ?? []).reduce((sum, segment) => sum + (segment.words?.length ?? 0), 0);
    if (totalWordCount > 0) {
      const startsAtFirstWord = resolvedCues[0]?.startWordIndex === 0;
      const endsAtLastWord = resolvedCues.at(-1)?.endWordIndex === totalWordCount - 1;
      const contiguous = resolvedCues.every((cue, index) => index === 0
        || cue.startWordIndex === resolvedCues[index - 1].endWordIndex + 1);
      if (!startsAtFirstWord || !endsAtLastWord || !contiguous) {
        errors.push("approved semantic captions do not cover the complete transcript");
      }
    }
    for (let index = 0; index < Math.min(resolvedCues.length, captions.cues.length); index += 1) {
      const approved = resolvedCues[index];
      const rendered = captions.cues[index];
      if (normalizeCaptionText(approved.text) !== normalizeCaptionText(approved.resolvedText)) {
        errors.push(`${approved.id}: approved wording differs from the recording transcript`);
      }
      if (approved.id !== rendered.id || approved.text !== rendered.lines?.[0]) errors.push(`${rendered.id}: wording differs from the approved semantic plan`);
      const expectedStartFrame = Math.max(0, Math.round(approved.start * captions.source.fps));
      const expectedEndFrame = Math.max(expectedStartFrame + 1, Math.round(approved.end * captions.source.fps));
      if (rendered.startFrame !== expectedStartFrame || rendered.endFrame !== expectedEndFrame) {
        errors.push(`${rendered.id}: timing differs from the approved semantic plan`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "approved caption review plan is unreadable");
  }
}

if (compositionPath) {
  const source = fs.readFileSync(compositionPath, "utf8");
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const sections = [...source.matchAll(/<section\b([^>]*)\bdata-caption-id="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/g)]
    .map((match) => ({ attributes: `${match[1]} ${match[3]}`, id: match[2], body: match[4] }));
  if (sections.length !== captions.cues.length) errors.push(`Expected ${captions.cues.length} caption clips, found ${sections.length}`);
  for (const cue of captions.cues) {
    const section = sections.find((candidate) => candidate.id === escapeHtml(cue.id));
    if (!section) {
      errors.push(`${cue.id}: timed caption clip is missing`);
      continue;
    }
    const start = Number(section.attributes.match(/data-start="([^"]+)"/)?.[1]);
    const duration = Number(section.attributes.match(/data-duration="([^"]+)"/)?.[1]);
    if (Math.abs(start - cue.start) > 0.000001) errors.push(`${cue.id}: clip start does not match caption data`);
    if (Math.abs(duration - (cue.end - cue.start)) > 0.000001) errors.push(`${cue.id}: clip duration does not match caption data`);
    if (!section.attributes.includes(`data-caption-page-id="${escapeHtml(cue.sourcePageId)}"`)) errors.push(`${cue.id}: ChatCut source page is missing`);
    if (!section.attributes.includes(`data-caption-start-frame="${cue.startFrame}"`)
      || !section.attributes.includes(`data-caption-end-frame="${cue.endFrame}"`)) {
      errors.push(`${cue.id}: ChatCut frame range is missing`);
    }
    for (const line of cue.lines) {
      if (!section.body.includes(`>${escapeHtml(line)}</p>`)) errors.push(`${cue.id}: rendered line is missing: ${line}`);
    }
  }
}

for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exit(1);
console.log(`Caption plan passed: ${captions.cues.length} ${captions.source.kind} cue(s)`);
