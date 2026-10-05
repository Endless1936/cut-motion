# cut-motion

@/Users/prototech/.codex/RTK.md

Read [.agents/skills/cut-motion/SKILL.md](.agents/skills/cut-motion/SKILL.md) for video work. Read its references only when that stage needs them.

Keep source media intact. Keep private job data and generated media in `jobs/`, outside Git. Repository changes should retain reusable instructions and tests; report one-off review findings in chat.

Before committing workflow changes, run `node --test .agents/skills/cut-motion/tests/*.test.mjs dev/*.test.mjs` and `node dev/check-privacy.mjs`. These are repository development checks, not video-production steps.

Continue from the job's `plan.json` and existing media rather than recreating the job. Review has two user approvals; Auto changes only waiting behavior. Do not add state-machine paperwork, approval receipts, audit reports or automatic quality gates.
