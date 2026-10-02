#!/usr/bin/env node
// Answer one question in a single command: are the ChatCut MCP tools usable from
// this session right now?
//
// Usage:
//   node scripts/check-chatcut.mjs [--url <mcp-url>] [--token <bearer-token>]
//                                  [--token-file <path>] [--timeout <seconds>] [--quiet]
//
// Diagnosing this by hand was the most expensive phase of the whole pipeline: the
// endpoint can be reachable while the token is stale, or authenticated while the
// server exposes no tools, or healthy while the client never mounts the connector.
// The probe separates those cases and prints the remedy for the one it finds.
//
// Configuration resolution: explicit flags, then CUT_MOTION_CHATCUT_MCP_URL /
// CUT_MOTION_CHATCUT_MCP_TOKEN / CUT_MOTION_CHATCUT_TOKEN_FILE, then the first
// `mcpServers.chatcut` HTTP entry found in the JSON configs listed by
// CUT_MOTION_CHATCUT_CONFIGS (a colon-separated list of known client MCP configs).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIGS = [
  path.join(os.homedir(), ".workbuddy", "mcp.json"),
  path.join(os.homedir(), ".codebuddy", "mcp.json"),
  path.join(os.homedir(), ".config", "mcp", "mcp.json"),
  path.join(os.homedir(), ".cursor", "mcp.json")
];
const REMEDIES = {
  config: "Remedy: register the ChatCut connector for this client, then enable and trust it.",
  token: "Remedy: refresh or re-issue the ChatCut access token, then update the MCP config.",
  network: "Remedy: check network access and proxy settings, then retry.",
  tools: "Remedy: retry; if it persists, refresh the access token.",
  untrusted: "Remedy: open the client's connector management page, enable ChatCut, and trust it."
};

const usage = () => {
  console.error(`Usage: node scripts/check-chatcut.mjs [--url <mcp-url>] [--token <bearer-token>] [--token-file <path>] [--timeout <seconds>] [--quiet]

Probes the ChatCut MCP endpoint with initialize + tools/list and prints the tool
names it found. Exits 0 when the tools are reachable, 1 when they are not, and 64
on a usage error. The token value is never printed.`);
};

const rawArguments = process.argv.slice(2);
const options = { url: "", token: "", tokenFile: "", timeout: 15, quiet: false };
for (let index = 0; index < rawArguments.length; index += 1) {
  const argument = rawArguments[index];
  if (argument === "--quiet") { options.quiet = true; continue; }
  if (argument === "-h" || argument === "--help" || argument === "help") { usage(); process.exit(0); }
  const value = rawArguments[index + 1];
  if (value === undefined) { usage(); process.exit(64); }
  if (argument === "--url") options.url = value;
  else if (argument === "--token") options.token = value;
  else if (argument === "--token-file") options.tokenFile = value;
  else if (argument === "--timeout") options.timeout = Number(value);
  else { usage(); process.exit(64); }
  index += 1;
}
options.url ||= process.env.CUT_MOTION_CHATCUT_MCP_URL ?? "";
options.token ||= process.env.CUT_MOTION_CHATCUT_MCP_TOKEN ?? "";
options.tokenFile ||= process.env.CUT_MOTION_CHATCUT_TOKEN_FILE ?? "";
if (process.env.CUT_MOTION_CHATCUT_TIMEOUT && rawArguments.indexOf("--timeout") === -1) {
  options.timeout = Number(process.env.CUT_MOTION_CHATCUT_TIMEOUT);
}
if (!Number.isFinite(options.timeout) || options.timeout <= 0) { usage(); process.exit(64); }

const fail = (reason, remedyKey) => {
  console.error(`missing  chatcut — ${reason}`);
  console.error(`         ${REMEDIES[remedyKey]}`);
  process.exit(1);
};

let tokenSource = options.tokenFile ? path.resolve(options.tokenFile) : null;
if (tokenSource) {
  if (!fs.existsSync(tokenSource)) fail(`token file ${tokenSource} is not readable`, "token");
  options.token ||= fs.readFileSync(tokenSource, "utf8").trim();
}

let configPath = null;
if (!options.url) {
  const configList = (process.env.CUT_MOTION_CHATCUT_CONFIGS ?? "").split(":").filter(Boolean);
  for (const candidate of configList.length ? configList : DEFAULT_CONFIGS) {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) continue;
    let entry = null;
    try {
      const config = JSON.parse(fs.readFileSync(resolved, "utf8"));
      entry = config.mcpServers?.chatcut ?? config.servers?.chatcut ?? null;
    } catch {
      continue;
    }
    if (!entry) continue;
    const url = entry.url ?? entry.serverUrl ?? "";
    if (!url) continue;
    options.url = url;
    configPath = resolved;
    if (!options.token) {
      const header = entry.headers?.Authorization ?? entry.headers?.authorization ?? "";
      options.token = String(header).replace(/^Bearer\s+/i, "") || String(entry.env?.CHATCUT_MCP_TOKEN ?? "");
      tokenSource = header ? `${resolved} (headers.Authorization)` : null;
    }
    break;
  }
}

if (!options.url) {
  console.error("missing  chatcut — no MCP endpoint configured");
  console.error("         Set CUT_MOTION_CHATCUT_MCP_URL and CUT_MOTION_CHATCUT_MCP_TOKEN, or pass --url/--token,");
  console.error(`         or add an mcpServers.chatcut HTTP entry to one of: ${DEFAULT_CONFIGS.join(", ")}`);
  console.error(`         ${REMEDIES.config}`);
  process.exit(1);
}
if (!options.token) {
  console.error(`missing  chatcut — ${options.url} has no bearer token`);
  console.error(`         ${REMEDIES.token}`);
  process.exit(1);
}

const host = options.url.replace(/^[a-z]+:\/\//i, "").split("/")[0];
const displayToken = () => tokenSource ?? "flag/environment";

const request = async (payload, sessionId) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout * 1000);
  try {
    const response = await fetch(options.url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${options.token}`,
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      const dataLine = text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("data:")).pop();
      if (dataLine) {
        try { body = JSON.parse(dataLine.slice(5).trim()); } catch { body = null; }
      }
    }
    return {
      status: response.status,
      sessionId: response.headers.get("mcp-session-id") ?? "",
      body,
      preview: text.slice(0, 200).replace(/\s+/g, " ")
    };
  } finally {
    clearTimeout(timer);
  }
};

const initialize = await request({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "cut-motion-preflight", version: "1.0.0" }
  }
}).catch((error) => ({ error }));

if (initialize.error) {
  fail(`${host} is unreachable (${initialize.error.cause?.code ?? initialize.error.name ?? "request failed"})`, "network");
}
if (initialize.status === 401 || initialize.status === 403) {
  console.error(`missing  chatcut — authentication rejected (HTTP ${initialize.status}) at ${host}`);
  console.error("         The endpoint is reachable, so this is a credential problem, not a network one.");
  console.error(`         ${REMEDIES.token}`);
  process.exit(1);
}
if (initialize.status !== 200) {
  console.error(`missing  chatcut — initialize returned HTTP ${initialize.status} at ${host}`);
  console.error(`         Response: ${initialize.preview}`);
  process.exit(1);
}
if (initialize.body?.error) {
  console.error(`missing  chatcut — initialize was rejected: ${initialize.body.error.message ?? "unknown error"}`);
  console.error(`         ${REMEDIES.token}`);
  process.exit(1);
}

const listed = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, initialize.sessionId)
  .catch((error) => ({ error }));

if (listed.error || listed.body?.error) {
  const detail = listed.body?.error?.message ?? listed.error?.message ?? "no response";
  console.error(`missing  chatcut — initialize succeeded but tools/list failed: ${detail}`);
  console.error(`         ${REMEDIES.tools}`);
  process.exit(1);
}

const names = (listed.body?.result?.tools ?? []).map((tool) => tool.name);
if (names.length === 0) {
  console.error(`missing  chatcut — connected to ${host} but the server exposes no tools`);
  console.error(`         ${REMEDIES.untrusted}`);
  process.exit(1);
}

if (!options.quiet) {
  console.log(`ok       chatcut — ${names.length} tool(s) via ${host} (token from ${displayToken()})`);
  for (const name of names) console.log(`         ${name}`);
  console.log(`
Reachable endpoint is necessary but not sufficient: the client must also have the
ChatCut connector enabled and trusted, otherwise the tools exist but are never
mounted into the session. If this probe passes while no ChatCut tool is callable,
${REMEDIES.untrusted.replace("Remedy: ", "")}`);
} else {
  console.log(`ok       chatcut — ${names.length} tool(s) via ${host}`);
}
