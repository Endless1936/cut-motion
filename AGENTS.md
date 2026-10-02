# cut-motion Agent Protocol

@/Users/prototech/.codex/RTK.md

cut-motion is an Agent workflow for turning a talking-head recording into a tightly edited, motion-designed video. This file is the always-loaded entry point; phase instructions live in `docs/`.

## Always-loaded rules

- Resume from the active job's `state/workflow.json`. Read its status with `node scripts/workflow-state.mjs <path> status`; never infer the current phase from files alone.
- In [`docs/workflow.md`](docs/workflow.md), read the route for the current state and its phase section only. Read a linked specialist guide when that phase needs it. Open [`docs/troubleshooting.md`](docs/troubleshooting.md) only when a matching failure occurs.
- A local talking-head video is required. If it is missing, ask for its path and stop. Ask once for optional preferences; continue with unanswered choices deferred.
- Preserve the source video. Keep each job's media, state, previews, and logs inside its job directory; keep private job data and credentials out of Git. Run the repository privacy check before committing examples or workflow changes.
- The recording is authoritative for spoken wording. Reconcile any supplied reference script against it; `【】` holds visual notes, while ordinary `[]` remains spoken text. See the workflow guide for handling and provenance.
- Do not ask the user for item-by-item listening before the rough cut. Prepare the rough cut from ChatCut transcription and timing; the user listens to the complete cut in the existing `rough-cut-review` and explicitly approves or requests revisions.
- Use `scripts/workflow-state.mjs` for every state transition. The only workflow approval gate is `rough-cut-review`; never infer approval or an automatic decision. `review` is the default; use `auto` only when explicitly selected. Follow only the checks listed for that mode in [`docs/quality-gates.md`](docs/quality-gates.md).
- Use ChatCut for the editable rough cut, FFmpeg/FFprobe for media work, and HyperFrames HTML/CSS/GSAP for captions, motion, composition, and rendering. Remotion or Vibe Motion requires an explicit user request and a recorded deviation.
- During planning, choose a [motion template](templates/motion-graphics/README.md) and record its ID; during composition, instantiate that planned template. Use a custom MG when the content or an explicit design request needs it, with a brief reason in the Motion Plan.
- Before a new job, inspect the available ChatCut Agent tools and run `./scripts/check-environment.sh check`. See [`docs/agent-setup.md`](docs/agent-setup.md) for setup, render commands, and privacy checks. Get approval before installing dependencies, changing global Agent configuration, or starting OAuth.
