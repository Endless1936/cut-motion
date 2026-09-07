# Agent Setup and Maintenance

This document is for Agents and repository contributors. End users should follow `README.md` or `README-EN.md` and interact through natural language.

## Environment preflight

Inspect the active Agent session for ChatCut, then run:

```bash
./scripts/check-environment.sh check
```

If ChatCut is required but unavailable, explain the reason and wait for approval. After approval:

- Codex: `Read https://chatcut.io/chatgpt to install and use the ChatCut plugin`
- Claude Code: `Read https://chatcut.io/claude to install and use the ChatCut plugin`

Do not add or run a deterministic ChatCut installer.

## Local requirements

- Bash on macOS or Linux; Windows users need WSL2 or an equivalent Unix shell.
- Node.js 22 or newer with npm and npx.
- FFmpeg and FFprobe with H.264 and AAC support.
- jq.
- [Smiley Sans WOFF2](https://github.com/atelier-anchor/smiley-sans/releases), released under SIL Open Font License 1.1.

## Job setup

Create the job:

```bash
./scripts/scaffold-project.sh jobs/<job-id> /absolute/path/to/video.mov review
```

After dependency-install approval:

```bash
./scripts/check-environment.sh install-job jobs/<job-id> --yes
mkdir -p jobs/<job-id>/hyperframes/assets/fonts
cp /path/to/smiley-sans-oblique.woff2 jobs/<job-id>/hyperframes/assets/fonts/smiley-sans-oblique.woff2
```

`install-job` reuses the exact HyperFrames version from npm's `_npx` cache when available. Otherwise it installs the pinned dependency inside the job. It resolves GSAP independently and never requires a global HyperFrames installation.

## Render commands

From `jobs/<job-id>/hyperframes`:

```bash
npm run render:preview
npm run render
```

The preview uses HyperFrames `standard` quality. The final render uses `high` quality with the same composition, resolution, frame rate, timing, and audio.

## Repository verification

Keep user media, transcripts, job state, and credentials under ignored local paths, normally `jobs/`. Media is ignored by default; only the exact existing approved reference frames are excepted. New public examples require user approval and an explicit ignore exception. Never force-add private files. Ignoring a file does not remove it from Git's index or history.

Before committing, run `node scripts/check-repository-privacy.mjs --staged` against the actual index. Static verification also checks working-tree candidates for common credential patterns without printing secret values. This lightweight check cannot recognize every personal document or arbitrary key: inspect the staged diff as well. It is repository maintenance, not a video-production gate.

```bash
./scripts/verify-repository.sh --static
CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

Static verification is the CI-safe default. Runtime verification resolves the job-local HyperFrames runtime and executes real CLI, browser, and media checks.
