# Subtitle Segmentation Standard

Use the generator's default caption segmentation. This standard is for correcting a specific visibly awkward cue, not for manually resegmenting the whole track. Structural and timing checks remain enforced; reading-quality targets are guidance, not extra workflow gates.

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

Use `state/transcript.json` as wording authority. Keep names, product configurations, number-unit pairs and fixed phrases in the caption lexicon. Let generated segmentation stand by default; add a `cueLines` override only for a specific cue that is clearly awkward or a user-requested change. Do not inspect or rewrite every cue, run `--outline`, or run standalone validators during routine delivery. `compose-job.mjs` checks transcript coverage, protected terms, timing and installation. It promotes the generated plan without a separate user approval.
