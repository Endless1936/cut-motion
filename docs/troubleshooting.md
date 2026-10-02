# Troubleshooting and Recovery

Read this only when a matching problem occurs. Identify whether the failure is in the Agent tool, credentials, network, sandbox, or edit itself; then use the matching recovery once. If it remains blocked, report the exact operation and error instead of repeating guesses.

| Symptom | Recovery |
| --- | --- |
| ChatCut tools are missing after installation | Start a new Agent session, then inspect its available tools. ChatCut integrations load at session start. A new session is necessary but not sufficient: if the tools are still absent, check whether the server was actually mounted before reinstalling (see [ChatCut MCP mount check](#chatcut-mcp-mount-check)). Reinstall only if the official client guide says installation failed. |
| ChatCut tools are absent while the configured token is valid | Distinguish "not wired up" from "not mounted". A valid token only proves the endpoint is reachable; it says nothing about whether the client mounted the server. Run the [ChatCut MCP mount check](#chatcut-mcp-mount-check); if the server never appears there, refresh and re-session will not help. |
| WorkBuddy: `mcpServers.chatcut` is configured but no ChatCut tool ever appears | WorkBuddy mounts a custom MCP server only after the user trusts it. Ask the user to open the custom-connectors entry at the top-right of the connector management page, click Trust on `chatcut`, then start a new session; confirm the tools are present before continuing. Rewriting `~/.workbuddy/mcp.json` does not remove an existing trust decision, so do not treat a token refresh as the cause. Never substitute direct HTTP or `curl` calls for the missing MCP tools. |
| ChatCut returns `401` or credentials appear missing in another client | Check the active client and follow its [official setup guide](agent-setup.md#environment-preflight). Do not assume another client's credential format or file path. Never print or paste access/refresh tokens into chat, logs, or Git. |
| WorkBuddy ChatCut still returns `401` after token renewal | Confirm the new Authorization header was saved and check the MCP server status. If the updated header is not active, restart WorkBuddy or start a new session using the documented reload path, then retry once. If it still returns `401`, report the status and exact error instead of refreshing again. Only if the refresh token itself is rejected, get approval under [environment preflight](agent-setup.md#environment-preflight) before repeating OAuth. The Agent must not run or capture the token-exchange command or response; never print or paste tokens. |
| A command is denied by the sandbox (`Operation not permitted`) | Treat it as a permission boundary, not as a missing package or invalid credential. Retry only the exact operation through the host's approved permission-escalation path. Do not change file permissions or move the project as a workaround; if escalation is unavailable, report the blocked path and command. |
| GitHub is unreachable through a local proxy | First distinguish sandbox denial from network routing. Test `github.com` and `api.github.com` separately over the direct and configured routes, then inspect the system/app proxy's actual host and port; do not assume `7890` or `55577`. Do not print proxy values if they contain credentials. If still blocked, report the failing host, route, and exact error. |
| A ChatCut edit tool rejects an operation or targets unexpected media | Read the active tool contract, then verify the targeted project, timeline, item IDs, and source time before retrying. Do not replace the supported MCP tool with guessed HTTP or `curl` calls. |
| A waveform index or tool response differs from an example | Inspect one real record's field names, units, window duration, and time origin before writing a consumer or changing a mapping. |
| A proposed optional pass or dependency adds work | Identify which later step consumes its output; defer it until needed if no current step uses it. |
| The Agent starts a later stage early or repeats work after a handoff | Check `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then follow only that state's route in [the workflow guide](workflow.md#active-state-route). Files alone do not establish a transition or approval. |
| A seam still feels loose after default edge tightening | Follow the user's rough-cut revision route and run one targeted source-waveform lookup for the reported seam; use the [rough-cut standard](talking-head-trim-standard.md#user-feedback-seam-review) to place any supported correction. |
| A failed take survives inside a retained transcript row | Recheck the row with Script's inline `~~…~~` strike; see step 1 of the [rough-cut standard](talking-head-trim-standard.md#fast-review-path). |
| The `rough-cut → rough-cut-review` transition reports a gap-candidate problem | The standard's cleanup steps are machine-checked, so finish them instead of working around the message. Run `node scripts/classify-gaps.mjs <job-directory>` to see every retained pause the locked timeline still has, classify each one in `state/gap-candidates.json`, and re-run. Missing `state/timeline-source-windows.pre-cleanup.json` means the pre-cleanup snapshot was never taken; the cleanest fix is to restore the pre-cleanup timeline in ChatCut, snapshot it, then apply cleanup. |
| A transition reports `Recorded fingerprints no longer match the job artifacts` | Something changed an accepted artifact outside the state machine — typically a manual rebuild, a hand edit, or a render that bypassed the entrypoint. Run `node scripts/workflow-state.mjs <workflow.json> verify` to list the mismatch, then rebuild through the transition that owns that artifact. Do not re-record the fingerprint to clear the message: the mismatch is the finding. |
| The `composition` transition reports a beat-map, authority or reapproval change | The plan moved after it was accepted. `The beat map changed after the motion plan advanced`, `Composition requires a creative package whose authorities match the job artifacts`, and `Creative reapproval required: <field>` all mean the same thing at different granularity. Re-derive the artifacts with `node scripts/generate-plan.mjs <job-directory> --write` if they are merely stale, or `reopen motion-plan` (with `--actor user`) when the change is editorial, then re-advance. |
| The rough-cut export is rejected with "audio and video durations differ" | ChatCut renders in the browser, so the exported audio track can outlast the video track. Run `./scripts/align-export.sh <exported.mp4>`; it copies streams, trims the overhang to just past the last video frame, and re-verifies both durations and the frame count. Promote the aligned file, not the original export. |
| `hyperframes check` reports `multiple_root_compositions` | Expected in place, not a composition defect: the command flags every root-level `.html` with `data-composition-id`, and the authored `hyperframes/index.template.html` is one. Run `./scripts/check-composition.sh <job-directory>` instead; it rebuilds the composition and checks a pruned staging root that holds only the generated `index.html`. Do not delete or rename the template to silence the message — the build, the render manifest, and the chunk renderer all read it. |

### ChatCut MCP mount check

The endpoint probe distinguishes an unreachable host, a rejected credential, and a healthy-but-unmounted server in one command:

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
