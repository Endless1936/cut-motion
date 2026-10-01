#!/usr/bin/env node
// Minimal ChatCut MCP client over HTTP with automatic token refresh.
//
// Usage:
//   node scripts/chatcut-mcp.mjs tools
//   node scripts/chatcut-mcp.mjs call <toolName> '<json-args>'
//
// On a 401 the client refreshes the OAuth access token (see chatcut-token.mjs)
// and retries once, so long jobs never stall on an expired token.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { refreshChatCutToken } from './chatcut-token.mjs';

const HOME = homedir();
const MCP_FILE = join(HOME, '.workbuddy', 'mcp.json');
const ENDPOINT = 'https://api.chatcut.io/api/external-mcp/mcp';
let SESSION = null;

function currentToken() {
  const mcp = JSON.parse(readFileSync(MCP_FILE, 'utf8'));
  const auth = mcp?.mcpServers?.chatcut?.headers?.Authorization || '';
  return auth.replace(/^Bearer\s+/, '');
}

async function rpc(method, params, token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (SESSION) headers['Mcp-Session-Id'] = SESSION;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) SESSION = sid;
  const text = await res.text();
  return { status: res.status, text };
}

function parsePayload(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  // SSE framing: pick the last data: line and parse it.
  const lines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
  if (lines.length) return JSON.parse(lines[lines.length - 1].slice(5).trim());
  throw new Error(`unparseable response: ${text.slice(0, 400)}`);
}

export async function mcpRequest(method, params) {
  let token = currentToken();
  let out = await rpc(method, params, token);
  if (out.status === 401) {
    const refreshed = await refreshChatCutToken();
    token = refreshed.access_token;
    out = await rpc(method, params, token);
  }
  if (!out.status || out.status >= 400) {
    throw new Error(`MCP ${method} failed ${out.status}: ${out.text.slice(0, 400)}`);
  }
  const payload = parsePayload(out.text);
  if (payload.error) throw new Error(`MCP error: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

export async function initialize() {
  return mcpRequest('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'cut-motion', version: '1.0.0' },
  });
}

export async function listTools() {
  const res = await mcpRequest('tools/list', {});
  return res.tools || [];
}

export async function callTool(name, args = {}) {
  const res = await mcpRequest('tools/call', { name, arguments: args });
  const chunks = (res.content || [])
    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
  return { raw: res, text: chunks };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'tools') {
    const tools = await listTools();
    console.log(tools.map((t) => `${t.name}\t${(t.description || '').split('\n')[0]}`).join('\n'));
  } else if (cmd === 'call') {
    await initialize();
    const out = await callTool(a, b ? JSON.parse(b) : {});
    console.log(out.text || JSON.stringify(out.raw));
  } else {
    console.error('usage: chatcut-mcp.mjs tools | call <tool> <json>');
    process.exit(1);
  }
}
