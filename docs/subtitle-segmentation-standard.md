# Subtitle Segmentation Standard

This standard is binding for `captionMode: subtitles`. Its purpose is natural one-line reading, not maximum cue count or fixed character packing.

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

## Blocking rules

- Exactly one rendered line per cue.
- Cues are mutually exclusive half-open integer frame windows; touching endpoints are valid, crossfades between cues are not. Installation/build must enforce this even when an optional audit is skipped.
- A protected term, product name, number-plus-unit, or fixed phrase cannot cross cues.
- A particle, conjunction, or other function word cannot stand alone. One-character cues are forbidden.
- Do not leave `的`, `了`, `着`, `过`, `啊`, `吧`, `吗`, `呢`, `与`, `和`, `但`, `所以`, `因为`, or `而` as an isolated cue.
- Cue duration is at least 0.5 seconds; normally target 0.8–2.5 seconds.
- Target 4–10.5 measured display units. Allow at most 11.8 units with a documented 88–96px cue-level fit; do not shrink the whole track to solve one phrase.
- A meaningful short closing phrase may be accepted only with an explicit exception reason.
- The concatenated cue text must reproduce the approved transcript after punctuation and spacing normalization.
- Approved cue boundaries cannot change during composition.

For user-edited segmentation, rebind word anchors to the new text before filling blank timestamps; missing/null/blank means align, not zero. Keep counting, punctuation, version notation, and official-name exceptions in the job rather than silently normalizing them away. See [Editorial revisions](revision-standard.md#captions-and-small-text-revisions) for size changes and targeted checks.

## Review workflow

1. Use `state/transcript.json` as authority; `captions/reference-transcript.txt` may exist only as a derived human-readable snapshot.
2. Record names, product configurations, number-unit pairs, and fixed phrases in `captions/caption-lexicon.json`.
3. Author each semantic cue once in `state/planning-inputs.json` as a `cueLines` range (`segmentId`, `fromWord`, `toWord`) using the generated planning outline. `generate-plan.mjs` derives the text and anchored caption review plan. Code must not choose or optimize cue boundaries.
4. Use `scripts/check-caption-review-plan.mjs` for early feedback when useful; the caption promotion step performs the release check itself.
5. Present every cue in `docs/caption-plan.md` when creative review is triggered.
6. The generator marks settled cues `approved` by default; use `captionStatus: proposed` only for an unfinished draft. This is Agent readiness, not another user approval.
7. Run `node scripts/compose-job.mjs <job>` to promote and install that exact plan with the planned MG templates. Promotion checks the semantic plan and generated cues. Do not repaginate during composition.
