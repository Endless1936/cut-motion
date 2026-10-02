# Troubleshooting and Recovery

Read this only when a matching problem occurs. Identify whether the failure is in the Agent tool, credentials, network, sandbox, or edit itself; then use the matching recovery once. If it remains blocked, report the exact operation and error instead of repeating guesses.

| Symptom | Recovery |
| --- | --- |
| ChatCut tools are missing after installation | Start a new Agent session, then inspect its available tools. ChatCut integrations load at session start. Reinstall only if the official client guide says installation failed. |
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
