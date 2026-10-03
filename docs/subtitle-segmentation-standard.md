# Subtitle Segmentation Standard

Use the approved ChatCut main-timeline transcript entries and their frame ranges for the routine caption plan. Keep those item boundaries as cues; do not run a character-count or automatic Chinese sentence splitter, and do not fetch source-word timestamps to reconstruct the Script. Exact within-phrase timing changes belong to revisions requested after the user reviews the final video. This guide adds no review or approval gate.

## Authority

Wording priority is:

1. recorded speech and visible delivery;
2. supplied reference script as a terminology and intended-structure candidate;
3. ChatCut ASR and reviewed local fallback.

`state/transcript-reconciliation.json` records every conflict. Neither a script nor ASR may introduce wording the recording does not support.

## Segmentation order

Apply these decisions in order:

1. preserve a complete lexical unit or fixed phrase;
2. choose a clause, syntactic phrase, punctuation, breath, or discourse-reset boundary;
3. keep the cue readable for its acoustic duration;
4. measure the final rendered width and fit it to one line.

Never cut raw text at a character limit before the language pass.

## Structural invariants

- Exactly one rendered line per cue.
- Cues are mutually exclusive half-open integer frame windows; touching endpoints are valid, crossfades between cues are not. Installation/build must enforce this even when an optional audit is skipped.
- A protected term, product name, number-plus-unit, or fixed phrase cannot cross cues.
- The concatenated cue text must reproduce the approved transcript after punctuation and spacing normalization.
- Approved cue boundaries cannot change during composition.

## Reading-quality guidance

- Prefer not to isolate a particle, conjunction, or other function word; avoid one-character cues where a natural phrase can be kept together.
- Prefer cues around 0.8–2.5 seconds. Use shorter or longer cues when the spoken phrase and timing read naturally.
- Target 4–10.5 measured display units. Fit a longer phrase to one line when needed; do not shrink the whole track to solve one cue.
- A short closing phrase may stand alone when it reads naturally; no exception record is required.

For user-edited segmentation, rebind word anchors to the new text before filling blank timestamps; missing/null/blank means align, not zero. Keep counting, punctuation, version notation, and official-name exceptions in the job rather than silently normalizing them away. See [Editorial revisions](revision-standard.md#captions-and-small-text-revisions) for size changes and targeted checks.

## Workflow

Use the approved main-timeline preview as wording and timing authority for a standard ChatCut plan. Keep names, product configurations, number-unit pairs and fixed phrases in the caption lexicon. The generator creates one cue per returned timeline-item transcript entry; this count is not expected to equal the ChatCut Script row count. Do not run `--outline`, fetch per-word timestamps, or repeat a full cue-by-cue audit during routine delivery. `compose-job.mjs` installs the generated plan without a separate user approval.
