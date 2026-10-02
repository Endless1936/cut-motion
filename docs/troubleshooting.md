# Troubleshooting and Recovery

Read this only when a matching problem occurs. Identify whether the failure is in the Agent tool, credentials, network, sandbox, or edit itself; then use the matching recovery once. If it remains blocked, report the exact operation and error instead of repeating guesses.

| Symptom | Recovery |
| --- | --- |
| ChatCut tools are missing after installation | Start a new Agent session, then inspect its available tools. ChatCut integrations load at session start. Reinstall only if the official client guide says installation failed. |
| ChatCut returns `401` or credentials appear missing | Check the active client and follow its [official setup guide](agent-setup.md#environment-preflight). WorkBuddy uses a bearer token that expires; follow the [official refresh steps](https://chatcut.io/workbuddy). Never print or paste access/refresh tokens into chat, logs, or Git, and do not guess credential-file paths. Ask for authorization only if the documented refresh flow requires sign-in or approval. |
| A command is denied by the sandbox (`Operation not permitted`) | Treat it as a permission boundary, not as a missing package or invalid credential. Retry only the exact operation through the host's approved permission-escalation path. Do not change file permissions or move the project as a workaround; if escalation is unavailable, report the blocked path and command. |
| GitHub or another service fails through a local proxy | Distinguish a refused local proxy connection from a sandbox-denied network request. Do not rotate credentials or repeatedly retry. Use the configured, authorized network path once; if unavailable, report the exact proxy/network error. |
| A ChatCut edit tool rejects an operation or targets unexpected media | Read the active tool contract, then verify the targeted project, timeline, item IDs, and source time before retrying. Do not replace the supported MCP tool with guessed HTTP or `curl` calls. |
| A waveform index or tool response differs from an example | Inspect one real record's field names, units, window duration, and time origin before writing a consumer or changing a mapping. |
| A proposed optional pass or dependency adds work | Identify which later step consumes its output; defer it until needed if no current step uses it. |
| The Agent starts a later stage early or repeats work after a handoff | Check `state/workflow.json` with `scripts/workflow-state.mjs ... status`, then follow only that state's route in [the workflow guide](workflow.md#active-state-route). Files alone do not establish a transition or approval. |
| A seam still feels loose after default edge tightening | Follow the user's rough-cut revision route and run one targeted source-waveform lookup for the reported seam; use the [rough-cut standard](talking-head-trim-standard.md#user-feedback-seam-review) to place any supported correction. |
| A failed take survives inside a retained transcript row | Recheck the row with Script's inline `~~…~~` strike; see step 1 of the [rough-cut standard](talking-head-trim-standard.md#fast-review-path). |

Add an entry only after the cause and recovery are supported by a real incident or an official tool guide. Keep each entry to the symptom and the shortest reliable recovery; the workflow standards remain the source of editing policy.
