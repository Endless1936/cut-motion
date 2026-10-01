# Stage: intake

Load this when `workflow-state.mjs` enters `intake`.

## Enters with

- A local talking-head video path from the user. If media is missing, ask for the path and stop.

## Do

1. **Check the tool surface first.** Inspect the active Agent tool list for the ChatCut tools before creating anything. If they are absent, follow [`troubleshooting.md`](../troubleshooting.md) — an expired credential is the usual cause, not a broken config.
2. Run `./scripts/check-environment.sh check`.
3. Create the job with `scripts/scaffold-project.sh`.
4. Copy or link the source into `input/`. The original is never modified.
5. Ask **once** for optional preferences: caption mode, reference script, visual-axis strategy. Record what is supplied; otherwise defer and continue without blocking.
6. Probe duration, dimensions, frame rate, codecs, sample rate, and rotation with FFprobe.
7. Set the project timeline to **30 fps** even when the source is 29.97. Record source rate and timeline rate separately.

If ChatCut or a local dependency is genuinely unavailable, explain the gap and its install scope in one concise prompt and **wait for explicit approval**. Do not install packages, alter global Agent configuration, or start OAuth before approval. After approval, direct the user to the official setup for their client and start a new session before confirming the tools are present.

## Do not

- Install anything, change global configuration, or begin OAuth without approval.
- Add a ChatCut installer to this repository.
- Scan download folders or place job media, state, previews, or logs in the repository root.
- Reject a reference script without checking it: empty, nested, unclosed, or unmatched full-width `【】` is rejected here, during intake.

## Exits with

- `state/project.json` holding the probe result and the resolved preferences.
- An immutable source copy under `input/`.
- Environment preflight passed, or an explicit `roughCutEngine: "ffmpeg-fallback"` recorded because ChatCut is unavailable.
