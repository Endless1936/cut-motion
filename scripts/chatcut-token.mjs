#!/usr/bin/env node
// ChatCut OAuth access-token refresh.
//
// Access tokens issued by ChatCut expire in 3600s. The long-lived credential is
// the refresh_token stored in ~/.workbuddy/chatcut-oauth.json. This script
// exchanges the refresh_token for a fresh access_token, writes it back into
// ~/.workbuddy/mcp.json (so the connector keeps working), rotates the stored
// refresh_token, and prints the new access_token on stdout.
//
// Discovery chain (OAuth 2.0 Protected Resource Metadata):
//   GET  /.well-known/oauth-protected-resource  -> authorization_server
//   GET  /.well-known/oauth-authorization-server -> token_endpoint
//   POST token_endpoint  grant_type=refresh_token

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const OAUTH_FILE = join(HOME, '.workbuddy', 'chatcut-oauth.json');
const MCP_FILE = join(HOME, '.workbuddy', 'mcp.json');
const ISSUER = 'https://api.chatcut.io';

async function discoverTokenEndpoint() {
  const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`);
  const meta = await res.json();
  if (!meta.token_endpoint) throw new Error('no token_endpoint in metadata');
  return meta.token_endpoint;
}

export async function refreshChatCutToken() {
  const oauth = JSON.parse(readFileSync(OAUTH_FILE, 'utf8'));
  const tokenEndpoint = await discoverTokenEndpoint();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: oauth.client_id,
    refresh_token: oauth.refresh_token,
  });
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token refresh failed ${res.status}: ${text}`);
  const json = JSON.parse(text);

  // Rotate the refresh token: ChatCut returns a new one on every exchange.
  writeFileSync(
    OAUTH_FILE,
    JSON.stringify({ client_id: oauth.client_id, refresh_token: json.refresh_token || oauth.refresh_token }, null, 2) + '\n'
  );

  // Keep the connector config in sync.
  const mcp = JSON.parse(readFileSync(MCP_FILE, 'utf8'));
  const server = mcp?.mcpServers?.chatcut;
  if (server?.headers?.Authorization) {
    server.headers.Authorization = `Bearer ${json.access_token}`;
    writeFileSync(MCP_FILE, JSON.stringify(mcp, null, 2) + '\n');
  }

  return json;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const json = await refreshChatCutToken();
  console.log(JSON.stringify(json, null, 2));
}
