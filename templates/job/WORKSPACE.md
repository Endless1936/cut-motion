# MotionScript Job Workspace

This directory belongs to one video job.

- `input/` contains immutable source media.
- `state/workflow.json` controls progression and approvals.
- `state/` contains machine-readable decisions.
- `state/creative-confirmation.json` records the user-facing creative contract.
- `docs/creative-confirmation.md` bundles caption mode, A/B-axis rules, the storyboard, and sample scope for review.
- `docs/motion-plan.md` is the user-reviewable animation proposal.
- `roughcut/` contains clean A-roll exports.
- `captions/` contains generated subtitle data when enabled.
- `hyperframes/` contains the composition.
- `previews/` contains review artifacts.
- `checkpoints/` preserves approved or superseded stage artifacts.
- `logs/` contains tool reports.
- `output/` contains final delivery renders.

Do not reuse this directory for another source video. Create a new job so state transitions, review decisions, and generated artifacts remain reproducible.
