# Workflow State Machine

## States

```text
intake
→ transcription
→ rough-cut
→ rough-cut-review
→ motion-plan
→ motion-plan-review          # conditional
→ visual-sample               # conditional
→ visual-sample-review        # conditional
→ composition
→ qa
→ final-preview
→ render
→ complete
```

`rough-cut` includes ChatCut selection, frame-level precision trim, seam audit, and final A-roll export.

Review states are gates, not production stages. Locked-edit and final-preview reviews are mandatory. Creative review is required for MG, `motion-copy`, B-axis or hybrid treatment, release-impact ambiguity, or an explicit request. Visual-sample review is required for a first or changed motion-bearing visual fingerprint, or an explicit caption-layout precheck; caption-only subtitle work may skip it.

For `subtitles`, the package contains the exact one-line caption plan, MG-to-cue mappings, exhaustive on-screen copy, information gain, style, and intentional no-MG passages. For `motion-copy`, it contains complete designed-speech coverage in the beat map and motion plan without a caption plan. Approval authorizes only those fields.

For subtitles, the plan gate validates recording-backed reconciled wording and semantic caption grouping before approval. Each cue must preserve complete protected terms, avoid isolated particles or conjunctions, remain on one measured line, last at least 0.5 seconds, and cover the approved transcript exactly.

## Intake control

The Agent asks caption mode and reference-script status together. `intake → transcription` requires both explicit acknowledgements, resolved source media, and a matching SHA-256 for any provided job-local script. Legacy jobs beyond intake receive `intakeDecisionBlock` until both decisions are recorded.

Creative confirmation must name and define A-axis overlay mode and B-axis stage mode. Subtitle projects default to A-axis overlay mode. If the plan introduces any B-axis stage or materially reduces speaker visibility, the gate waits for an explicit A-axis, B-axis, or hybrid choice; otherwise the stated A-axis default is sufficient.

Record axis choices through the state machine so history, mirrors, and invalidation stay consistent:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-axis-mode a-axis-overlay --actor user --note "Keep the speaker full-frame"
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-axis-mode b-axis-stage --actor user --note "Approve the full MG stage"
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-axis-mode hybrid --actor user --note "Approve the named B-axis passages"
```

`b-axis-stage` and `hybrid` are valid only when this command records the user's explicit choice.

## Caption-mode control

Caption mode is selected at intake through the scaffold argument or the user request; omitted input proposes `subtitles` and leaves `captionModeAcknowledged` false. The agent records an explicit choice with:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-caption-mode subtitles --actor user --note "Use recording-backed semantic captions"
```

or:

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json set-caption-mode motion-copy --actor user --note "Use designed motion copy without a subtitle layer"
```

A mode change at or after planning invalidates dependent creative artifacts and returns to `motion-plan`. Reference-script changes return through transcription while preserving already approved edit work when safe.

## Review mode

The Agent stops at each required gate. Inapplicable conditional gates are recorded as `skipped`. The creative package is always generated and validated internally even when it is not shown.

Request an otherwise optional review by setting `review.required` or `visualSample.required` in the creative package.

## Automatic mode

Required gates are marked `auto-approved`; inapplicable gates remain `skipped`. Automated mode never skips artifact validation or hides a fallback.

## State authority

`state/workflow.json` is authoritative. `currentState` and `pendingGate` identify the active position. Every replan increments `revisionId`; invalidated decisions remain in `history` as `superseded`. Creative approval stores SHA-256 fingerprints; sample, composition and render stop on drift.
