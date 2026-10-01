# Stage: rough-cut-review

Load this when `workflow-state.mjs` enters `rough-cut-review`. This is **the only approval gate** in the workflow.

## Enters with

- A rough cut whose own record says every mandatory Golden Standard step ran.

## Do

1. **Verify the record before presenting anything.** Confirm every mandatory step is recorded as run in `state/chatcut-roughcut.json`, the terminal-tail pass and the residual-take scan included. A rough cut whose record says a mandatory step was skipped does not advance — fix it and re-record instead of reporting it as a known omission.
2. Put the cut in front of the user and wait. Approval requires `approve --actor user --note <feedback>` in `review` mode.
3. Resolve deferred preferences here: if the user gave no caption preference, analyze the locked edit and record a recommendation; infer and record the axis recommendation with its reason.

## Do not

- Infer approval or an automatic decision from silence. `roughCutReviewDecision` is `pending`, `manual-approved`, or `automatic-fallback` — nothing else.
- Advance on a record that admits a skipped mandatory step.
- Treat inspecting the rendered file as another gate. It is a handoff for the user's editorial decision.

## Exits with

- `approve` → `rough-cut-export`, with `roughCutReviewDecision` set and caption/axis preferences resolved.
- `revise` → back to `rough-cut`, with a new `revisionId`.

## If revised

`revise` returns to `rough-cut`. **Reload `stages/rough-cut.md` and work it from the top.** Do not resume from memory of the previous pass — the one historical failure in this workflow happened exactly there: a revision was applied without re-running the mandatory terminal-tail pass, and the user found it, not the agent.
