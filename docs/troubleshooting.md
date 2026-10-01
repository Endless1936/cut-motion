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

**Do not** hand-roll HTTP calls as a substitute. That was done once: it cost a tedious round of hand-written requests per operation and produced a 105-line client that only exists because nobody checked *why* the tools were missing. If you genuinely cannot get the server mounted and must drive the endpoint directly, `scripts/chatcut-mcp.mjs` exists as a fallback — but reaching for it without doing the two steps above is treating the symptom.

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

## Adding to this document

Add an entry when a failure cost real time **and** its diagnosis was not obvious. For each one write: the symptom, how to confirm the cause in one or two commands, the fix, and — if a workaround once replaced a proper fix — why that workaround was the wrong turn. Skip anything that is a one-off typo.
