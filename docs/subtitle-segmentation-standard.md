# Subtitle Segmentation Standard

Use the approved ChatCut main-timeline transcript entries as the source for caption wording. Correct terminology and split only entries that need natural Chinese phrase boundaries in `state/planning-inputs.json`; do not rewrite every caption. Keep each rendered line to at most 10 display units: count each Chinese character as 1 and each 3 English characters as about 1. This is a writing rule, not an automated splitter or a new review gate.

The generator applies `corrections:{"原识别":"确认后的用词"}` once to the released transcript and every derived caption. Prefer `captionEdits:{"main-003":["一个完整短语","下一个短语"]}` for necessary phrase splits; all other entries keep their existing boundaries. The tool locates existing measured token boundaries first, then matching caption-card boundaries. Without exact coverage, it allocates caption-only frame ranges within that parent entry; those estimates never become MG word evidence. Do not hand-calculate every caption time. For deliberate timing changes, use `captionEdits:{"main-003":[{"text":"一个完整短语","start":1.2,"end":2.1},...]}`; explicit seconds are preserved and must stay within the parent entry. Finish these edits before delivering the three plans. `captionCues` remains available for an intentionally authored full track.

If the approved timeline already has a CaptionProgram, locate that existing program in the current project and request `read_captions({projectId:<project>,json:JSON.stringify({words:true,limit:100})})`. Save the returned pages once and set `captionTimingPath:"state/chatcut-caption-timing.json"`. When another page is returned, retain the same program, returned revision and filters, changing only its requested offset. `generate-plan.mjs` accepts the actual `structuredContent.text` card/token response or a `cards` array, reuses matching phrase cards, and applies the same corrections. Save every page in returned order. Do not create or edit ChatCut captions merely to obtain this optional data. Without it, generate from main-timeline entry ranges and author only necessary phrase splits. Neither a card range nor an estimated token is measured MG word timing.

## Authority

Wording priority is:

1. recorded speech and visible delivery;
2. supplied reference script as a terminology and intended-structure candidate;
3. ChatCut ASR and reviewed local fallback.

`state/transcript-reconciliation.json` records every conflict. Neither a script nor ASR may introduce wording the recording does not support.

Routine speech reconciliation is generated from the released transcript. Author only wording corrections and genuine conflicts; do not restate every ordinary entry as a separate evidence ledger.

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

Use the approved main-timeline preview as the wording and parent timing authority for a standard ChatCut plan. Keep names, product configurations, number-unit pairs and fixed phrases in the caption lexicon. Author corrections and necessary phrase edits once, then run `node scripts/generate-plan.mjs <job> --write` to generate the three plans together; do not manually synchronize their derived JSON files. Phrase timing is sufficient for routine caption plans; it does not establish MG keyword onsets. Resolve [MG internal keyword timing](mg-speech-timing.md) during the first composition preparation, and refine caption timing when a specific within-phrase adjustment is needed. `compose-job.mjs` installs the generated plan after the existing plan-package approval.
