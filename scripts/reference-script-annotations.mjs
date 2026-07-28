import { sha256Text } from "./workflow-utils.mjs";

const clauseBoundaries = new Set(["\n", "\r", "。", "！", "？", "!", "?", "；", ";", "，", ",", "：", ":"]);
const explicitScopePattern = /(?:从.{1,40}(?:到|至).{0,40}|(?:这|本|前|上|后|接下来|以下)(?:一|两|二|三|几)?(?:句|句话|段)|(?:期间|过程中))/u;

const locationAt = (text, offset) => {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return `line ${lines.length}, column ${lines.at(-1).length + 1}`;
};

const defaultScopeFor = (speechText) => {
  let end = speechText.length;
  while (end > 0 && /\s/u.test(speechText[end - 1])) end -= 1;
  while (end > 0 && clauseBoundaries.has(speechText[end - 1])) end -= 1;
  while (end > 0 && /\s/u.test(speechText[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && !clauseBoundaries.has(speechText[start - 1])) start -= 1;
  while (start < end && /\s/u.test(speechText[start])) start += 1;
  return { start, end, text: speechText.slice(start, end) };
};

export const parseReferenceScript = (sourceText) => {
  let speechText = "";
  const annotations = [];

  for (let index = 0; index < sourceText.length;) {
    const character = sourceText[index];
    if (character === "】") {
      throw new Error(`Unexpected closing reference-script annotation at ${locationAt(sourceText, index)}`);
    }
    if (character !== "【") {
      speechText += character;
      index += 1;
      continue;
    }

    const sourceStart = index;
    let sourceEnd = -1;
    for (let cursor = index + 1; cursor < sourceText.length; cursor += 1) {
      if (sourceText[cursor] === "【") {
        throw new Error(`Nested reference-script annotation at ${locationAt(sourceText, cursor)}`);
      }
      if (sourceText[cursor] === "】") {
        sourceEnd = cursor + 1;
        break;
      }
    }
    if (sourceEnd < 0) {
      throw new Error(`Unclosed reference-script annotation at ${locationAt(sourceText, sourceStart)}`);
    }

    const instruction = sourceText.slice(sourceStart + 1, sourceEnd - 1).trim();
    if (!instruction) {
      throw new Error(`Empty reference-script annotation at ${locationAt(sourceText, sourceStart)}`);
    }
    const defaultScope = defaultScopeFor(speechText);
    if (!defaultScope.text) {
      throw new Error(`Reference-script annotation must follow spoken text at ${locationAt(sourceText, sourceStart)}`);
    }

    annotations.push({
      id: `annotation-${String(annotations.length + 1).padStart(3, "0")}`,
      instruction,
      sourceStart,
      sourceEnd,
      insertionOffset: speechText.length,
      scopeMode: explicitScopePattern.test(instruction) ? "explicit-range" : "preceding-clause",
      defaultScope
    });
    index = sourceEnd;
  }

  return { speechText, annotations };
};

export const buildReferenceScriptAnnotations = ({ status, path, sha256, text = "" }) => {
  const parsed = status === "provided" ? parseReferenceScript(text) : { speechText: "", annotations: [] };
  return {
    $schema: "../../../schemas/reference-script-annotations.schema.json",
    schemaVersion: "1.0.0",
    source: { status, path, sha256 },
    speechText: parsed.speechText,
    speechSha256: sha256Text(parsed.speechText),
    annotations: parsed.annotations,
    verification: {
      parsed: true,
      annotationCount: parsed.annotations.length
    }
  };
};
