# Stage: render

Load this when `workflow-state.mjs` enters `render`.

## Enters with

- A built composition and, for a revision round, one combined delivery confirmation.

## Do

1. Render through the job package entrypoint: `npm run render`, or `npm run render:revision` for a revision. Route selection, chunked recovery, browser and worker settings, and preview handling come from [`agent-setup.md`](../agent-setup.md#render-commands).
2. Render **once**.
3. Verify with FFprobe that the delivery has readable video and audio, correct dimensions, frame rate and duration, and a non-empty file.
4. Produce `output/final.mp4` and hand it to the user.

## Do not

- Claim machine checks proved semantic correctness, aesthetics, or release readiness. They establish structure and media integrity only.
- Claim automatic-validation completion unless the user explicitly selected `auto` and the applicable checks passed.
- Render again without a reason. Use a short preview for a specific visual question instead, which does not change workflow state.

## Exits with

- `output/final.mp4` passing the basic media checks.
- The user given the chance to judge captions, MG, timing, semantics, and visual quality. Their decision is final.

On the `review` path this is completion: the file exists, basic checks pass, and the user has had the opportunity to inspect it.
