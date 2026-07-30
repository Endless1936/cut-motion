# Quality Gates

## Rough cut

- Original media remains unchanged.
- No unintended black frames, timeline gaps, duplicated audio, or frozen clips.
- The default `tight-talking-head` profile in `docs/talking-head-trim-standard.md` was applied before rough-cut review, unless a user-requested rhythm profile is recorded.
- Every seam has transcript-semantic, multi-threshold acoustic, and visible-performance evidence, or an explicit documented exception.
- Removed and deliberately retained pauses are documented in `trim-plan.json` with reasons and confidence.
- `scripts/check-trim-plan.mjs state/trim-plan.json --require-audit --media roughcut/a-roll.mp4` passes with a matching final-media hash and measured residual silence.
- Default safety handles are asymmetric: about 20 ms after outgoing speech and 50 ms before incoming speech; tightening a tail must not move the incoming boundary later. Low-confidence boundaries use documented conservative padding.
- Every seam passes picture-and-sound inspection: no clipped or prematurely faded outgoing phoneme, shaved incoming onset, comprehension-critical breath removal, reading/reset tail, black frame, gap, overlap, or detached audio.
- Timeline transitions are zero to two frames at 30 fps and never mask an incorrect physical cut, attenuate an incoming onset, or restore discarded tail audio.

## Transcript and beat map

- Both intake decisions are acknowledged and any active reference-script hash matches its immutable job-local copy.
- `scripts/check-transcript-reconciliation.mjs` passes strictly before creative approval; recording evidence outranks scripts and ASR.
- In `motion-copy`, every spoken sentence and transcript segment is represented by motion copy.
- In `subtitles`, captions cover the transcript exactly and approved MG adds information instead of repeating it.
- Every subtitle-mode local MG records and passes the cognition-gap, removal, still-frame, cost, and source tests in `docs/subtitle-mg-standard.md`, including `stillFrameValue`, factual-claim sources, and plain explanations for introduced terms.
- Every phrase has timing and coverage. Micro-events and motion recipes are required only for `motion-copy` and approved local-MG beats; caption-only beats keep them empty.
- Essential Chinese wording is not replaced by English.
- `scripts/check-visual-plan.mjs` passes.
- `scripts/check-information-value.mjs` passes; no visible type is below the design-system floor and no self-evident PIP label is present.

## Captions

- `motion-copy` has no standalone caption layer.
- `subtitles` uses white 得意黑, a soft downward shadow, no opaque band, and exactly one rendered line per cue. Semantic grouping, protected terms, function-word isolation, 0.5s minimum duration, and measured display width must pass `check-caption-review-plan.mjs`.
- ChatCut pages remain locked raw timing evidence; their `/` pagination is not an authority.
- `scripts/check-captions.mjs` proves the rendered cues exactly match the approved semantic wording and frame-quantized boundaries before installation.
- Subtitle-mode MG is local and supplemental; it never occupies a caption, PiP, evidence, or protected UI region. Informative A-axis face coverage is brief and non-accumulating.
- Subtitle-mode MG uses one declared support role and the lowest-cost visual form that closes its viewer cognition gap.

## Motion design

- `state/creative-confirmation.json` and `docs/creative-confirmation.md` exist, agree with the workflow caption mode, and pass `scripts/check-creative-confirmation.mjs`.
- `scripts/check-creative-fingerprints.mjs` passes before sample, composition, QA, and render.
- A-axis overlays replace rather than accumulate, use one declared top/bottom/side face-safe zone, and use localized glass only; B-axis scenes retain a live protected PIP and may exit as a group.
- Every MG keeps one horizontal or vertical primary flow; the main chain does not turn 90 degrees.
- Copy, timing, and size-only revisions inherit the approved visual reference.
- `scripts/check-layout-constraints.mjs` passes: Chinese copy has no one-character orphan line, and every B-axis PIP uses its declared exclusion zone.
- Every `data-motion-role="label"` declares `data-information-role` as one of the Beat Map support roles: `evidence`, `explanation`, `calibration`, `organization`, `action`, or `consequence`.
- HyperFrames runtime layout passes at sampled motion states; every authored visual belongs to a timed motion group, and bounds, protected regions, A-axis accumulation, face-cover duration, connector flow, borders, labels, caption weight, and caption bottom ratio match the browser contract.
- Phrase entrances land within three frames of acoustic onset unless documented.
- No caption wrapping, single-line overflow, or transformed-glyph clipping.
- No empty component larger than 10% of the frame.
- No more than two consecutive scenes use the same transition family.
- `motion-copy` has no unexplained visual dead zone longer than 0.9 seconds; the subtitle supplemental-motion limit applies only inside approved local-MG passages.
- Major layout cadence uses the active caption-mode rhythm profile.
- A/B-axis switches are semantically motivated.
- A high-attention-cost subtitle MG is restricted to the B-axis and has a documented reason.
- A B-axis run lasts at least 2.5 seconds unless explicitly justified.
- PIP footage changes across sampled frames.
- Repeating effects continue through their scene end.
- Each active scene has one primary focal group and one to four supporting elements.

## Typography and layout

- `scripts/check-font.sh` confirms the 得意黑 WOFF2 file and `@font-face` declaration.
- Captions inherit design-system weight `400`; synthetic bold and undeclared `700` are absent.
- `scripts/check-information-value.mjs` rejects ornamental micro-labels before preview or render.
- Primary Chinese text is at least 84 px at 1080×1920; secondary text is at least 42 px.
- Display line height is 0.92–1.12.
- Panel padding is 48–72 px unless a documented composition requires otherwise.
- Primary content occupancy is 28–65% and stays inside the declared safe area at peak motion.
- When triggered, the 3–5 second sample captures representative local phases. Final QA samples MG scenes and axis transitions, not pure-caption beats: A-axis entrance/resolved/exit, extra B-axis or complex-motion peaks, plus opening and closing frames.
- A typical job uses about 12–30 snapshots. Larger sets must be explained by the number of high-risk visual scenes; never export every video frame for routine QA.
- Generate and inspect snapshot receipts with `scripts/run-validation-check.mjs`. Static checks bind to the independent source; snapshots and audio bind to the rendered sample or preview.

## HyperFrames

- `npx hyperframes check` passes without errors.
- Snapshots cover each visual scene's required states and every axis transition.
- Composition is deterministic and seek-safe.
- Media elements are direct children of the composition root.

## Delivery

- Final render exists and is non-empty.
- Duration matches project state within one frame.
- Video dimensions, frame rate, and audio stream match the target.
- Silence detection finds no new unexplained dead-air interval.
- Final preview was approved in `review` mode.
- Final QA verifies approved trim-plan and visual-plan fingerprints instead of rerunning unchanged planning validators.
- Final QA uses the same runner and contract. Reused, stale, hand-authored, untyped, or self-referential evidence fails.
