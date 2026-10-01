# Troubleshooting

Environment and tooling failures, organized by symptom. Read the section that matches what you are seeing — do not read this front to back.

This document covers **how the tools are reached**. Editing rules live in [the Talking-Head Rough-Cut Golden Standard](talking-head-trim-standard.md); do not mix the two.

The bias in every entry below: **diagnose before working around**. The expensive failures on past jobs came from skipping the diagnosis and hand-rolling a substitute for a tool that was merely misconfigured.

---

## The ChatCut MCP tools are not in my tool list

**Symptom.** You expect `create_project`, `read_script`, `edit_item`, `preview_timeline` and friends, but none of them are available.

**Diagnose first.** The server is configured as an HTTP MCP endpoint with a bearer token in the header. When the token is expired, the handshake at session start fails and the tools silently do not mount — the config is fine, the credential is not. Tokens here expire in about an hour, so this is the common case, not an edge case.

1. Confirm the server entry exists and note its URL:
   ```bash
   python3 -c "import json;print(json.load(open('$HOME/.workbuddy/mcp.json'))['mcpServers'])"
   ```
2. Test the credential directly against that URL. A `401` confirms the diagnosis:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST <mcp-url> \
     -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
   ```

**Fix.** Refresh the credential, then reload the session so the server mounts:

```bash
node scripts/chatcut-token.mjs   # exchanges the stored refresh token and writes it back
```

Then restart or reload MCP connections and re-check the tool list.

**Do not** hand-roll HTTP calls as a substitute. That was done once: it cost a tedious round of hand-written requests per operation and produced a 105-line client that only existed because nobody checked *why* the tools were missing. That client was deleted rather than kept as a fallback — a workaround in the repo invites the next run to take the same path. If the two steps above do not mount the server, say so plainly; the answer is a working credential, not a second way to reach the endpoint.

---

## ChatCut returns 401 mid-job

Long jobs outlive a one-hour token. Refresh and retry rather than reporting a blocker:

```bash
node scripts/chatcut-token.mjs
```

The fallback client retries once automatically after a refresh. If you are calling the tools directly, refresh by hand and retry the call.

---

## `github.com` is unreachable, or `gh auth login --web` fails with `unexpected EOF`

**Symptom.** `api.github.com` responds but `github.com` returns nothing, so the browser device flow cannot complete.

**Diagnose first.** Two different proxies are usually in play: an environment-variable proxy injected into the shell, and the system proxy from network settings. They do not allow the same hosts. Compare them before concluding the network is blocked:

```bash
env | grep -i proxy                                        # what the shell is using
curl -s -o /dev/null -w 'direct: %{http_code}\n' --noproxy '*' --max-time 15 https://github.com
curl -s -o /dev/null -w 'system-proxy: %{http_code}\n' -x http://127.0.0.1:7890 --max-time 15 https://github.com
```

Substitute the system proxy's actual host and port, which you can read from your network settings — do not assume `7890` is correct on this machine.

**Fix.** Run the command with the working proxy, without editing any user config:

```bash
env HTTP_PROXY=http://<system-proxy> HTTPS_PROXY=http://<system-proxy> gh auth login --web --skip-ssh-key
```

Two mechanical traps in that flow:

- It stops at `Press Enter to open ... in your browser`, which a non-interactive shell cannot answer. Pipe the newline: `printf '\n\n' | gh auth login --web --skip-ssh-key`.
- Without `--skip-ssh-key` it stops on an arrow-key SSH key picker that also cannot be answered. The key is already on the account, so skip it.

Each restart of the flow issues a **new** one-time code. Give the operator the current one; the previous code is dead.

---

## I am about to create or merge a PR as the wrong account

**Symptom.** SSH works, push succeeds, but the PR shows the wrong author.

**Diagnose first.** SSH identity and API identity are separate. A successful push proves nothing about who will author a PR:

```bash
gh auth status            # which account is active
gh api user --jq .login   # who the API will actually act as
```

Both must show the intended account. If they do not, stop — do not create the PR and do not merge it. Switch with `gh auth switch --user <account>`, or add the account with `gh auth login`.

After creating a PR, verify rather than assume:

```bash
gh pr view <n> --json author --jq .author.login
```

---

## A push is rejected, or commits are attributed to the wrong identity

Two independent things, checked separately:

```bash
git -C <repo> config --get core.sshCommand   # a repo may pin its own key, overriding ssh config
git -C <repo> config user.name               # commit identity; may be unset if no global identity exists
```

A repo-level `core.sshCommand` is the cleanest way to pin an account and needs no global `~/.ssh/config` edit. Check it before changing anything global.

---

## A produced artifact does not have the fields my code assumes

**Symptom.** A script reads an index or lookup and every value comes back empty, zero, or obviously wrong — but it does not throw. The result looks like "no speech anywhere" rather than a crash.

**Diagnose first.** Print one record before writing the loop that consumes thousands of them:

```bash
python3 -c "import json;d=json.load(open('state/source-audio-waveform-index.json'));print(d['waveform']['featureOrderPerChannel']);print(d['waveform']['windows'][0])"
```

Two failures of exactly this shape cost real time on one job:

- The RMS feature was renamed. Code matching `rmsSample` got `-1` from `indexOf` and silently read the wrong column out of every window. The index has shipped `rmsSample` and `linearRms16`. **Match on `/rms/i`, never on an exact name.**
- A window array carried no `timeUs`. Time has to be derived as `index * windowMs`, not read from the record.

Related: silence durations came back in **seconds** while the consuming code treated them as milliseconds, so every gap looked 1000× too small. Confirm the unit on the first value, not after the numbers look odd.

The pattern to watch for is a lookup that returns `null`/`-1` and is then used as if it were valid. Fail loudly on a missing field instead.

## A step ran, and its output was never used

**Symptom.** Time went into a pass whose results did not end up deciding anything — a sweep over three thresholds, a package install, a rendered preview that was superseded.

This is not a tooling failure, but it has cost more time than most tooling failures. Before starting a pass, be able to say which decision will consume its output:

- The dB candidate sweep is for **finding regions to inspect**. It does not choose a physical edge, and it is not the terminal-tail pass. Running it early, before there is a candidate to resolve, produces numbers nobody reads.
- Installing dependencies for a later stage (motion, render) before the current stage is accepted means installing twice if the cut changes.
- Rendering a preview before the cut points are settled means rendering again.

If a pass cannot name its consumer, defer it.

## Adding to this document

Add an entry when a failure cost real time **and** its diagnosis was not obvious. For each one write: the symptom, how to confirm the cause in one or two commands, the fix, and — if a workaround once replaced a proper fix — why that workaround was the wrong turn. Skip anything that is a one-off typo.
