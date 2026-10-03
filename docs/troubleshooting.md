# Troubleshooting and Recovery

Read this only when a matching problem occurs. Identify whether the failure is in the Agent tool, credentials, network, sandbox, or edit itself; then use the matching recovery once. If it remains blocked, report the exact operation and error instead of repeating guesses.

| Symptom | Recovery |
| --- | --- |
| ChatCut tools are missing after installation | Check the client's connector status and Trust/enable setting, then use its supported reload path. Start a new session only if that client requires it to load newly installed tools. Reinstall only if setup failed; see [mount diagnosis](#chatcut-mcp-mount-check). |
| WorkBuddy: `mcpServers.chatcut` is configured but no ChatCut tool appears | Check Trust in custom connectors. A valid token or a successful endpoint probe does not establish that the client mounted the server. After enabling/trusting it, reload through the client's supported route and inspect the active tools. Use the probe for diagnosis, not as a substitute editing API. |
| ChatCut returns `401` or credentials appear missing in another client | Check the active client and follow its [official setup guide](agent-setup.md#environment-preflight). Do not assume another client's credential format or file path. Never print or paste access/refresh tokens into chat, logs, or Git. |
| WorkBuddy ChatCut still returns `401` after token renewal | Confirm the new Authorization header was saved and check the MCP server status. If the updated header is not active, restart WorkBuddy or start a new session using the documented reload path, then retry once. If it still returns `401`, report the status and exact error instead of refreshing again. Only if the refresh token itself is rejected, get approval under [environment preflight](agent-setup.md#environment-preflight) before repeating OAuth. The Agent must not run or capture the token-exchange command or response; never print or paste tokens. |
| A command is denied by the sandbox (`Operation not permitted`) | Treat it as a permission boundary, not as a missing package or invalid credential. Retry only the exact operation through the host's approved permission-escalation path. Do not change file permissions or move the project as a workaround; if escalation is unavailable, report the blocked path and command. |
| The same-machine ChatCut import helper returns `listen EPERM` before transferring media | Retry the same helper through the host-approved local-network permission path. Use an upload-helper fallback only when this client does not support the loopback bridge; do not switch routes to bypass an OS or host-policy denial. If permission is denied, ask the user to grant it or upload through the editor. |
| HyperFrames render compiles, then exits in a sandbox at `Starting frame capture` (often around 25%) with an empty `HyperFrames ... render failed` detail | Treat this as a possible sandbox boundary. Retry the same job-local render once through the host-approved permission-escalation path. Do not reinstall dependencies or switch to chunked rendering for this symptom alone; if the host-permission retry also fails, report its full error. |
| Normal HyperFrames render stalls or fails before frame 0 with a media-initialization error | Retry once with `npm run render:chunked` from the job's `hyperframes/` directory. Install/restore the pinned browser only if the error names it as missing. Do not tune workers or GPU mode without observed memory/resource failure; report the first failed interval if chunked render also fails. |
| GitHub is unreachable through a local proxy | First distinguish sandbox denial from network routing. Test `github.com` and `api.github.com` separately over the direct and configured routes, then inspect the system/app proxy's actual host and port; do not assume `7890` or `55577`. Do not print proxy values if they contain credentials. If still blocked, report the failing host, route, and exact error. |
| A ChatCut edit tool rejects an operation or targets unexpected media | Read the active tool contract, then verify the targeted project, timeline, item IDs, and source time before retrying. Do not replace the supported MCP tool with guessed HTTP or `curl` calls. |
| A waveform index or tool response differs from an example | Inspect one real record's field names, units, window duration, and time origin before writing a consumer or changing a mapping. |
| A proposed optional pass or dependency adds work | Identify which later step consumes its output; defer it until needed if no current step uses it. |
| The Agent starts a later stage early or repeats work after a handoff | Check `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then follow only that state's route in [the workflow guide](workflow.md#active-state-route). Files alone do not establish a transition or approval. |
| A seam still feels loose after default edge tightening | Follow the user's rough-cut revision route and run one targeted source-waveform lookup for the reported seam; use the [rough-cut standard](talking-head-trim-standard.md#after-user-feedback) to place any supported correction. |
| The user hears a clipped word after tightening | Restore the affected edge toward its pre-tightening boundary and let the user replay that seam. Use the submitted edit and original source timing to identify the intended take; a timeline read-back cannot prove the word survived. ASR interval overlap alone is not proof of audible clipping. Do not immediately reapply the same tightening plan to the corrected edge. |
| Pause cleanup or another edit changed the clips after a tightening plan was computed | Recompute from the current timeline using `prepare-rough-cut.mjs <job> tighten <saved-preview-pages.json>...`. The standalone calculator also accepts `--out <plan.json> --force` to replace a stale plan. Old item IDs and trim counts no longer describe the edited timeline. |
| A guide names a ChatCut tool or import flag absent from this client | Use the mounted tool contract and its matching skill/helper. Tool names and helper flags differ between integrations; do not substitute guessed tools or HTTP calls. See [local import](agent-setup.md#import-a-local-recording-into-chatcut). |
| A failed take survives inside a retained transcript row | Recheck the row with Script's inline `~~…~~` strike; see step 1 of the [rough-cut standard](talking-head-trim-standard.md#three-editing-passes). |
| A usable rough cut is waiting on local records | Use `workflow-state.mjs <workflow.json> review-cut --project-id <id> --timeline-id <id>` and deliver the project. Candidate audits and reconciliation are not listening prerequisites. |
| Plan generation says the main-timeline transcript is incomplete or has another page | If coverage is incomplete, refresh the listed timeline items' transcript. If `nextOffset` is present, repeat `preview_timeline({views:["transcript"], offset: nextOffset})` on the same approved timeline with the same range and filters, then append that page's `structuredContent` as the next element of the saved JSON array; rerun plan generation once after all pages are saved. |
| An explicit `workflow-state.mjs ... verify` reports fingerprint drift | Treat it as diagnostic information, not a normal delivery block. Inspect only if the current output appears stale or a user requests an audit; ordinary transitions do not require `verify`. |
| Plan generation reports a manually changed output | Preserve the intended decisions in `planning-inputs.json`; then deliberately migrate with `generate-plan.mjs <job> --write --replace-existing`, which saves backups. For one MG revision use the assembler's `--beat` option or edit that module directly. |
| A-roll export status is missing or unavailable | Check `roughcut/a-roll.mp4` and known outputs first, then use `track_export` with `latest=false` for the project/timeline. Reuse a completed render or continue tracking a running one; submit a new export only when neither exists. |
| A-roll audio ends later than the video, but their stream start offsets match | Keep the original export. A longer audio tail alone does not show desynchronization; do not run the tail-trim helper to satisfy duration equality. |
| An export has a verified unwanted audio tail that the user asked to remove | Use `scripts/align-export.sh <input> --output <job>/roughcut/a-roll-aligned.mp4`; it trims audio, so keep the original and use this only for that explicit edit. |
| Composition is ready but the pinned HyperFrames CLI is missing | Check with `test -x <job>/hyperframes/node_modules/.bin/hyperframes`. If missing, run `./scripts/check-environment.sh install-job <job-directory>`; it reuses `.cache/cut-motion/` or installs the exact pinned packages there. Do not pause for approval. Plan delivery does not wait on render setup. |
| Render preparation reports `Local asset is missing: ./assets/fonts/...` | Run `scripts/install-font.sh <job-directory>` to reuse a licensed font from the repository cache or another job; it does not download. If no copy exists and the design allows the sans-serif fallback, remove the stale font URL from the authored source and rebuild. Use `--download` only after approval. |
| `hyperframes check` reports `multiple_root_compositions` | In an older authored `index.template.html`, change only the root's `data-composition-id` to `data-template-composition-id` and rebuild; current templates already do this. An optional `check-composition.sh <job>` can isolate older sources for diagnosis. Keep the authored template. |

### ChatCut MCP mount check

The optional endpoint probe distinguishes network failures, rejected credentials and a responding MCP server:

```bash
./scripts/check-environment.sh chatcut
```

That covers the reachability half. When the probe passes and the ChatCut tools are still absent, the mount is the problem; these client-side steps narrow it and print no credential values:

```bash
# 1. Did the current session's loaded-tool cache include ChatCut at all?
grep -c chatcut "$HOME/.workbuddy/mcp-tool-list.json"

# 2. Which MCP config was actually injected into the Agent process
grep -o -- '--mcp-config=<len=[0-9]*> --strict-mcp-config' "$HOME/.workbuddy/logs/daemon.log" | tail -1

# 3. Which custom servers the client accepted
grep -o 'custom-mcp:[a-zA-Z0-9_-]*' "$HOME/.workbuddy/logs/daemon.log" | sort | uniq -c
```

With `--strict-mcp-config`, only servers present in the injected config are usable, so a server missing from step 3 cannot be reached no matter what the token says. The complementary check is to search for any `mcp__chatcut__*` tool name: an unmounted server has no tools to find.

### Quick proxy check

This prints only HTTP status codes; ordinary `curl` uses the shell's configured proxy, while `--noproxy '*'` tests direct access:

```bash
for host in github.com api.github.com; do
  curl -sS -o /dev/null -w "$host direct: %{http_code}\n" --noproxy '*' --max-time 15 "https://$host"
  curl -sS -o /dev/null -w "$host configured: %{http_code}\n" --max-time 15 "https://$host"
done
```

If both use the same route but the desktop has a separate system/app proxy, inspect its actual address locally. Do not print full proxy environment values into logs; they may contain credentials.

Add an entry only after the cause and recovery are supported by a real incident or an official tool guide. Keep each entry to the symptom and the shortest reliable recovery; the workflow standards remain the source of editing policy.
