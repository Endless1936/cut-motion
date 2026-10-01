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

After dependency-install approval:

```bash
./scripts/check-environment.sh install-job jobs/<job-id> --yes
mkdir -p jobs/<job-id>/hyperframes/assets/fonts
cp /path/to/smiley-sans-oblique.woff2 jobs/<job-id>/hyperframes/assets/fonts/smiley-sans-oblique.woff2
```

The font copy is optional; skip it when the file is unavailable.

`install-job` first reuses exact-version dependencies already in the current job, then checks valid dependency trees in other jobs under the same repository, then npm's `_npx` cache. A dependency tree copied from another job includes its hoisted dependencies, so the new job does not depend on the old job remaining in place. Invalid links and version mismatches are skipped. GSAP is resolved independently and its browser runtime is regenerated from the verified package. Only when no exact local source exists does it install the pinned dependencies; it never requires a global HyperFrames installation or a user-configured cache path.

## Render commands

From `jobs/<job-id>/hyperframes`:

```bash
npm run render
```

These scripts use the repository's stable delivery route. `npm run render` is the default single delivery render: ordinary jobs stay monolithic and only longer jobs use chunks with HyperFrames' platform-default browser resolution. Use `npm run render:preview` only for an explicit visual question, not as a mandatory pre-render step. Use `npm run render:chunked` only for a known long-media or normal-route failure case; that explicit route selects the exact cached arm64 HeadlessChrome and hardware Metal. Chunk boundaries are normalized to the manifest frame grid, each rendered chunk is probed and cached with a receipt, and the final video is assembled with the authoritative audio. The preview uses HyperFrames `standard` quality; the final render uses `high` quality with the same composition, resolution, frame rate, timing, and audio.

Do not replace these scripts with a bare `hyperframes render` for this job family. HyperFrames 0.7.60 can stall in macOS Apple Silicon media initialization before frame 0 when a composition contains several long videos, a duplicated PiP source, and dense captions. The browser choice alone does not remove that stall; the explicit chunked route isolates the media initialization to short compositions and fails fast when the cached browser is missing. A future CLI upgrade is a separate, explicitly verified change rather than an automatic render fallback.

If the explicit macOS arm64 chunked route reports that no exact cached browser is available, install or restore the browser for the pinned version and rerun `npm run render:chunked`. Ordinary `auto` renders follow HyperFrames' platform-specific browser setup. Do not wait on a silent monolithic render or switch to Edge as a workaround.

### Preview render efficiency and recovery

For a normal preview, try `npm run render:preview` once. If it fails before frame 0 with the known HyperFrames initialization issue, use `npm run render:preview:chunked`; that route uses standard quality and four Chrome workers. HyperFrames documents four as a usual balance, with roughly 256 MB of Chrome memory per worker. Step down to three only when actual memory pressure is observed; step up to five only after timing a representative chunk and confirming memory headroom. Do not force `PRODUCER_MAX_WORKERS=1` or software GPU without a matching measured failure; leaving the producer setting unset preserves HyperFrames' host-aware default. The chunk renderer processes segments sequentially, so the number of segments is not parallelism.

Recovery order: keep one renderer active; for a known pre-frame initialization failure, use the matching chunked package route and inspect the first failed interval before changing worker count. Change worker count only in response to measured memory pressure. Use FFprobe once on the final file and review that MP4; extract stills from it with FFmpeg. Record route, quality, workers, GPU mode, chunk count, and elapsed time.

## Repository verification

Keep user media, transcripts, job state, and credentials under ignored local paths, normally `jobs/`. Media is ignored by default. New public examples require user approval and an explicit ignore exception. Never force-add private files. Ignoring a file does not remove it from Git's index or history.

Before committing, run `node scripts/check-repository-privacy.mjs --staged` against the actual index. Static verification also checks working-tree candidates for common credential patterns without printing secret values. This lightweight check cannot recognize every personal document or arbitrary key: inspect the staged diff as well. It is repository maintenance, not a video-production gate.

```bash
./scripts/verify-repository.sh --static
CUT_MOTION_FONT=/absolute/path/to/smiley-sans-oblique.woff2 ./scripts/verify-repository.sh --runtime
```

Static verification is the CI-safe default. Runtime verification resolves the job-local HyperFrames runtime and executes real CLI, browser, and media checks.
