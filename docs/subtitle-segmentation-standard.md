# Subtitle Segmentation Standard

Use the approved ChatCut main-timeline transcript entries as the source for caption wording. Manually split long entries into natural Chinese phrases and write `captionCues` in `state/planning-inputs.json`; each item has `segmentId`, `text`, `start` and `end` in seconds, with its time range inside the parent entry. Keep each rendered line to at most 10 display units: count each Chinese character as 1 and each 3 English characters as about 1. This is a writing rule, not an automated splitter or a new review gate.

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
- Keep every line at or below 10 display units. Split a longer entry at natural phrase boundaries; do not shrink the whole track to solve one cue.
- A short closing phrase may stand alone when it reads naturally; no exception record is required.

Keep the cue wording complete and in the approved transcript order. Keep manually authored cue times inside their parent main-timeline entry. Preserve counting, punctuation, version notation, and official-name exceptions in the job rather than silently normalizing them away. See [Editorial revisions](revision-standard.md#captions-and-small-text-revisions) for requested caption revisions.

## Workflow

Use the approved main-timeline preview as the wording and parent timing authority for a standard ChatCut plan. Keep names, product configurations, number-unit pairs and fixed phrases in the caption lexicon. Author the phrase-level cues once through the existing plan input, then generate the three plans together. Use additional word-level timing only when final-video feedback requests a specific within-phrase adjustment. `compose-job.mjs` installs the generated plan after the existing plan-package approval.
