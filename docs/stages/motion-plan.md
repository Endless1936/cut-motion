# Stage: motion-plan

Load this when `workflow-state.mjs` enters `motion-plan`.

## Enters with

- A locked edit: `roughcut/a-roll.mp4`, `state/source-transcript.json`, resolved caption mode and axis.

## Do

1. Create `state/beat-map.json` **before** writing any animation code.
2. Copy `assets/design-system.default.json` to `state/design-system.json` and change it only when the user or a supplied brand requires it. Prefer 得意黑 when its font file exists; its absence does not block the job.
3. Represent every spoken sentence. Split long sentences into meaningful phrases.
4. Give each beat its required fields: timing, source segment IDs, intent, axis treatment, and — when motion is approved — a motion recipe, `primaryFlowAxis`, `semanticTopology`, word-level entry/exit anchors, motion and transition families, micro-events, components, entrance/hold/exit timing, measured typography, and collision/face-cover/safe-area notes. Caption-only beats use `mgScope: none` with empty motion fields.
5. For `subtitles`, prepare the caption plan under [`subtitle-segmentation-standard.md`](../subtitle-segmentation-standard.md). For `motion-copy`, cover all speech in the beat map.
6. Bundle settled wording, MG, style, timing, axis, and intentional no-MG choices into the creative-confirmation package.
7. Bind every `【】` visual note from the reference to the locked timeline and list it as `adopted`, `adjusted`, or `rejected` with its resolved scope, treatment, reason, and beat IDs. Plan unannotated passages normally. Correct or reject a note that conflicts with the recording, evidence, visual-value rules, protected regions, or coherent axis behavior.
8. Run `scripts/check-visual-plan.mjs` in `auto` mode, or when a specific planning question needs it.

## Do not

- Write animation code before the beat map exists.
- Attach a motion recipe to a caption-only beat.
- Treat a reference visual note as final axis or motion approval.
- Change the design system without a user or brand reason.

## Exits with

- `state/beat-map.json`, `state/design-system.json`, `state/creative-confirmation.json`, and `docs/motion-plan.md`.

A caption-mode or axis change at or after this point returns to `motion-plan`.
