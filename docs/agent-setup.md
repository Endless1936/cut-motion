# Agent Setup and Maintenance

This document is for Agents and repository contributors. End users should follow `README.md` or `README-EN.md` and interact through natural language.

## Environment preflight

Use the ChatCut tools already exposed in the active Agent session. If they are unavailable, report that immediately; do not probe endpoints, inspect daemon logs, or troubleshoot tokens during a normal job. Then run the local dependency check once:

```bash
./scripts/check-environment.sh check
```

ChatCut is an Agent integration; its setup depends on the client. The official guides currently cover:

| Client | Setup guide |
| --- | --- |
| ChatGPT desktop app (Work or Codex tab) | [chatcut.io/chatgpt](https://chatcut.io/chatgpt) |
| Claude Code | [chatcut.io/claude](https://chatcut.io/claude) |
| WorkBuddy | [chatcut.io/workbuddy](https://chatcut.io/workbuddy) |

If ChatCut is required but unavailable, explain the reason and wait for approval before installing a plugin, changing Agent-wide configuration, or starting authentication. Then ask the active Agent to follow the matching guide:

- ChatGPT desktop Work/Codex: `Read https://chatcut.io/chatgpt to install and use the ChatCut plugin`
- Claude Code: `Read https://chatcut.io/claude to install and use the ChatCut plugin`
- WorkBuddy: `Read https://chatcut.io/workbuddy and follow its setup to connect ChatCut`

Start a new Agent session after setup because integrations may load only when a session starts, then confirm ChatCut tools are available before continuing. The ChatGPT guide covers the desktop app's Work and Codex tabs; do not assume it also covers the ChatGPT website or remote workspaces.

### WorkBuddy token renewal

The current [ChatCut WorkBuddy guide](https://chatcut.io/workbuddy) configures a static bearer token that expires after about an hour; do not assume WorkBuddy's native OAuth refresh manager applies to this manual MCP entry. If ChatCut returns `401`, give the user the guide's [Verify refresh flow](https://chatcut.io/workbuddy#verify) and have them complete it in their own local terminal, outside the Agent's terminal or logging path. Do not run or capture its token-exchange command, or ask the user to paste its command or response into chat: the documented command places the refresh token in a process argument and prints a response containing tokens. The user should replace only `mcpServers.chatcut.headers.Authorization` in `~/.workbuddy/mcp.json` and keep any rotated refresh token private. Retry in the current conversation; token expiry alone does not require a new conversation. If the updated header is not picked up, use the documented WorkBuddy reload path (restart WorkBuddy or start a new session), then confirm the MCP server status. Keep both tokens out of chat, logs, and Git.

## Local requirements

- Bash on macOS or Linux; Windows users need WSL2 or an equivalent Unix shell.
- Node.js 22 or newer with npm and npx.
- FFmpeg and FFprobe with H.264 and AAC support.
- jq.
- Optional: [Smiley Sans WOFF2](https://github.com/atelier-anchor/smiley-sans/releases), released under SIL Open Font License 1.1. Missing font media uses the composition's sans-serif fallback and does not block the job.

## Job setup

Create the job:

```bash
./scripts/scaffold-project.sh jobs/<job-id> /absolute/path/to/video.mov review
```

Prepare the pinned renderer dependencies when composition is needed. The command first reuses the repository's `node_modules/`; if the exact versions are absent, it installs them there automatically. This project-local install never requires user approval and does not install global packages or change Agent configuration.

```bash
./scripts/check-environment.sh install-job jobs/<job-id>
./scripts/install-font.sh jobs/<job-id>
```

`install-font.sh` resolves the display font in this order: `--from <file>`, the shared cache under `assets/fonts/` (git-ignored, populated by the first job that has the font), fonts already installed in another job, and finally an explicit `--download` from the upstream release. It copies the font and its license into `hyperframes/<fontAsset>`, repoints `state/design-system.json` at the installed file, and rewrites the `@font-face` in the HyperFrames template so the format match is real rather than assumed. Skip it when no font is available; the composition falls back to sans-serif and the font check is optional.

`install-job` stores pinned HyperFrames, GSAP, and their dependency tree in the Git-ignored root `node_modules/`. It checks that tree first, then adopts a matching job or npm cache before downloading packages. Each job links to the shared tree; its small GSAP browser asset stays in the job. Dependency adoption preserves unrelated root packages. Do not create another checkout or repository cache for production.

## ChatCut preflight

Use ChatCut tools already exposed in the active Agent session. If they are unavailable, report that immediately and stop the normal editing run. Endpoint probing is only for a specific connection diagnosis, never a routine preflight. `check-environment.sh check` verifies local dependencies:

```bash
./scripts/check-environment.sh chatcut
```

It distinguishes endpoint/network/authentication failures from a responding server. Its JSON config discovery covers WorkBuddy/CodeBuddy/Cursor-style configs; native desktop integrations may not use those files. Missing config is not proof of a missing plugin. A healthy endpoint does not prove that the active client mounted its tools; check that client's enabled/trusted state.

## Import a local recording into ChatCut

Check for an existing asset first. Use the active integration's import skill and tool contract; hosted plugins and desktop MCP clients can expose different import routes and helper arguments.

- When the hosted plugin supports same-machine editor import, use its bundled local-media helper and `import_media action=from_editor`. Keep the editor open for sync and transcription.
- Otherwise use the supported desktop import tool or `import_media action=create_session` and its matching upload helper. Follow that helper's arguments; do not transplant `--input`, retry, or transcription-only flags from another client. Keep import tokens out of chat, logs and Git.
- If the loopback helper returns `listen EPERM` before transferring media, retry that helper only through the host-approved local-network permission path. If the client does not support the loopback bridge, use its documented upload helper; if the host or OS denies the requested operation, stop and ask the user to grant that permission or upload through the editor. Do not change transfer routes to bypass the denial or spend time probing endpoints.
- Reuse the confirmed helper invocation and its running session for the rest of the job. Summarize tool results with IDs, status, duration, and next offset; save complete structured data directly under the job rather than printing it and parsing truncated terminal output.
- On a timeout, inspect progress and the existing asset before retrying. A helper still retrying is not a terminal failure; resume the same asset through its supported recovery path instead of starting another upload/transcode.
- Wait for transcription readiness using the integration's progress/asset tools before Script editing. An upload acknowledgment alone does not establish transcript readiness, and a provisional status alone does not justify re-uploading.

## Render commands

After the existing plan-package approval and A-roll media lock, prepare once:

```bash
./scripts/check-environment.sh install-job jobs/<job-id>
node scripts/compose-job.mjs jobs/<job-id>
```

Follow the composition command's batch snapshot command, inspect the expanded MGs, and recapture only affected groups after a local change. Then render from `jobs/<job-id>/hyperframes`:

```bash
npm run render
```

These scripts use the repository's stable delivery route. `npm run render` is the default single delivery render: ordinary jobs stay monolithic and only longer jobs use chunks with HyperFrames' platform-default browser resolution. Use `npm run render:preview` only for an explicit visual question, not as a mandatory pre-render step. Use `npm run render:chunked` only for a known long-media or normal-route failure case; that explicit route selects the exact cached arm64 HeadlessChrome and hardware Metal. Chunk boundaries are normalized to the manifest frame grid, each rendered chunk is probed and cached with a receipt, and the final video is assembled with the authoritative audio. The preview uses HyperFrames `standard` quality; the final render uses `high` quality with the same composition, resolution, frame rate, timing, and audio.

Perform [MG final-state self-review](workflow.md#mg-final-state-self-review) in one snapshot batch, then run `npm run render` once. Resume a running render instead of launching another; reuse a completed delivery recorded for the same composition. A bare `final.mp4` filename does not establish that revised inputs are already rendered. `render:revision` aliases the same direct `output/final.mp4` output. If the normal render hits a known failure, follow the matching entry in [Troubleshooting](troubleshooting.md); do not probe alternative renderers or worker settings. Read command summaries and saved data for recovery; routine delivery does not require rereading helper source or dumping full JSON.

### Optional preview

Use `npm run render:preview` only when a specific visual question needs an early frame. It is not a delivery step.

## Repository verification

Keep user media, transcripts, job state, and credentials under ignored local paths, normally `jobs/`. Media is ignored by default. Tracking public reference media requires user approval and an explicit ignore exception. Never force-add private files. Ignoring a file does not remove it from Git's index or history.

Before committing, run `node scripts/check-repository-privacy.mjs --staged` against the actual index. Static verification also checks working-tree candidates for common credential patterns without printing secret values. This lightweight check cannot recognize every personal document or arbitrary key: inspect the staged diff as well. It is repository maintenance, not a video-production gate.

```bash
./scripts/verify-repository.sh --static
CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

Static verification is the CI-safe default. Runtime verification resolves the job-local HyperFrames runtime and executes real CLI, browser, and media checks.

## GitHub pull requests

Before opening a PR, verify the active `gh` account with `gh auth status` and `gh api user --jq .login`. SSH push identity does not determine the PR author. If `gh` needs authentication, follow the approval rule in `AGENTS.md`, then use `gh auth login --web --skip-ssh-key` in an interactive terminal. Do not pipe guessed input into an OAuth prompt; if the current Agent has no TTY, ask the user to run that command in their local interactive terminal, then verify the active account again. After creating the PR, confirm the author with `gh pr view <number> --json author --jq .author.login`.
