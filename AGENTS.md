# cut-motion Agent Protocol

@/Users/prototech/.codex/RTK.md

cut-motion is an Agent workflow for turning a talking-head recording into a tightly edited, motion-designed video. This file is the always-loaded entry point; phase instructions live in `docs/`.

## Always-loaded rules

- Resume from the active job's `state/workflow.json`. Read its status with `node scripts/workflow-state.mjs <path> status`; never infer the current phase from files alone.
- In [`docs/workflow.md`](docs/workflow.md), read the route for the current state and its phase section only. Read a linked specialist guide when that phase needs it. Open [`docs/troubleshooting.md`](docs/troubleshooting.md) only when a matching failure occurs.
- A local talking-head video is required. If it is missing, ask for its path and stop. Ask once for optional preferences; continue with unanswered choices deferred.
- Preserve the source video. Keep each job's media, state, previews, and logs inside its job directory; keep private job data and credentials out of Git. Run the repository privacy check before committing examples or workflow changes.
- The recording is authoritative for spoken wording. Reconcile any supplied reference script against it; `【】` holds visual notes, while ordinary `[]` remains spoken text. See the workflow guide for handling and provenance.
- Use `scripts/workflow-state.mjs` for every state transition. The only workflow approval gate is `rough-cut-review`; never infer approval or an automatic decision. `review` is the default; use `auto` only when explicitly selected. Follow only the checks listed for that mode in [`docs/quality-gates.md`](docs/quality-gates.md).
- Before candidate cleanup, snapshot `state/timeline-source-windows.pre-cleanup.json`, then run `scripts/classify-gaps.mjs` and classify every candidate it reports in `state/gap-candidates.json`. A ChatCut rough cut cannot enter `rough-cut-review` while a retained pause is unexplained, so run the step rather than describing it.
- Derive the motion-plan artifacts from `state/planning-inputs.json` with `scripts/generate-plan.mjs <job-directory> --write` instead of writing them per job, and let the beat map inherit the fields it shares with its MG component. Every transition re-checks the fingerprints the workflow recorded, so rebuild through `advance` rather than editing `hyperframes/index.html` or `state/*.json` by hand; run `scripts/workflow-state.mjs <workflow.json> verify` when you need that comparison without moving the job.
- Use ChatCut for the editable rough cut, FFmpeg/FFprobe for media work, and HyperFrames HTML/CSS/GSAP for captions, motion, composition, and rendering. Remotion or Vibe Motion requires an explicit user request and a recorded deviation.
- Before a new job, inspect the available ChatCut Agent tools and run `./scripts/check-environment.sh check`. See [`docs/agent-setup.md`](docs/agent-setup.md) for setup, render commands, and privacy checks. Get approval before installing dependencies, changing global Agent configuration, or starting OAuth.
