# cut-motion Job Workspace

This directory belongs to one video job.

- `input/` contains immutable source media.
- `state/workflow.json` controls progression and approvals.
- `state/` contains machine-readable decisions.
- `state/chatcut-roughcut.json` records the ChatCut project and timeline IDs used for the pre-export manual review.
- `state/creative-confirmation.json` records the internal creative plan and its wording, axis, timing, and MG decisions.
- `state/reference-script-annotations.json` separates local `【】` visual notes from the persisted release wording of the reference script.
- `docs/creative-confirmation.md` bundles caption mode, A/B-axis rules, the storyboard, and optional sample scope; it is not a default user gate.
- `docs/motion-plan.md` is the user-reviewable animation proposal.
- `roughcut/` contains the clean A-roll export produced after manual ChatCut approval or the explicit automatic fallback.
- `captions/` contains generated subtitle data when enabled.
- `hyperframes/` contains the composition.
- `previews/` contains optional short-window or full-audit review artifacts.
- `checkpoints/` preserves optional diagnostics and audit artifacts.
- `logs/` contains tool reports.
- `output/` contains final delivery renders.

Do not reuse this directory for another source video. Create a new job so the source, wording, timing, and generated artifacts stay together.
