// Optional no-network MCP transport regression; no real configuration is read.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cut-motion-mcp-test-"));
const script = fileURLToPath(new URL("../scripts/check-chatcut.mjs", import.meta.url));
const hook = path.join(directory, "mock-fetch.mjs");
const trace = path.join(directory, "calls.jsonl");
const secret = "fixture-secret-not-a-real-token";
try {
  fs.writeFileSync(hook, `import fs from 'node:fs';
globalThis.fetch = async (url, options) => {
  const payload = JSON.parse(options.body);
  fs.appendFileSync(process.env.TEST_TRACE, JSON.stringify({payload, headers: options.headers, redirect: options.redirect})+'\\n');
  const scenario = process.env.TEST_CASE;
  const error = {error:{code:-32000, message:'private-response '+process.env.CUT_MOTION_CHATCUT_MCP_TOKEN}};
  if(scenario === 'auth') return new Response(JSON.stringify(error), {status:401});
  if(scenario === 'rpc') return Response.json(error);
  if(payload.method === 'initialize') return Response.json({result:{protocolVersion:'2025-06-18'}}, {headers:{'mcp-session-id':'fixture-session'}});
  if(payload.method === 'notifications/initialized') return scenario === 'notification-error' ? Response.json(error) : new Response(null, {status:202});
  if(scenario === 'tools-error') return Response.json(error);
  return Response.json({result:{tools:scenario === 'bad-tools' ? {} : [{name:'read_script'}]}});
};`);
  const run = (scenario, hasConfig = true) => {
    fs.writeFileSync(trace, "");
    const result = spawnSync(process.execPath, ["--import", hook, script, "--quiet"], {
      encoding: "utf8",
      env: { ...process.env,
        CUT_MOTION_CHATCUT_MCP_URL: hasConfig ? "https://example.invalid/mcp?private=query" : "",
        CUT_MOTION_CHATCUT_MCP_TOKEN: secret,
        CUT_MOTION_CHATCUT_TOKEN_FILE: "",
        CUT_MOTION_CHATCUT_CONFIGS: path.join(directory, "nonexistent-config.json"),
        TEST_CASE: scenario, TEST_TRACE: trace }
    });
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(output, /fixture-secret|private-response|private=query/);
    const calls = fs.readFileSync(trace, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    return { ...result, calls, output };
  };
  const success = run("success");
  assert.equal(success.status, 0, success.output);
  assert.deepEqual(success.calls.map(({payload}) => payload.method), ["initialize", "notifications/initialized", "tools/list"]);
  for (const call of success.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${secret}`);
    assert.equal(call.redirect, "manual");
  }
  for (const call of success.calls.slice(1)) {
    assert.equal(call.headers["Mcp-Session-Id"], "fixture-session");
    assert.equal(call.headers["MCP-Protocol-Version"], "2025-06-18");
  }
  assert.equal("id" in success.calls[1].payload, false);
  for (const scenario of ["auth", "rpc", "notification-error", "tools-error", "bad-tools"]) {
    const result = run(scenario);
    assert.equal(result.status, 1, result.output);
    if (scenario === "notification-error") assert.equal(result.calls.length, 2);
  }
  const unknown = run("success", false);
  assert.equal(unknown.status, 2);
  assert.match(unknown.output, /unknown.*no HTTP endpoint/);
  assert.doesNotMatch(unknown.output, /missing\s+chatcut/);
  assert.equal(unknown.calls.length, 0);
  console.log("ChatCut endpoint diagnostic tests passed.");
} finally {
  fs.rmSync(directory, {recursive:true, force:true});
}
