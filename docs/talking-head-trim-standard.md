# Talking-Head Precision Trim Standard

This is cut-motion's default first-pass standard for direct-to-camera talking-head videos. It is designed to produce a reviewable cut without waiting for the user to identify long seam pauses.

## Default profile

Use `tight-talking-head` unless the user requests a slower conversational, dramatic, or lecture rhythm.

| Setting | Default |
| --- | --- |
| Boundary evidence | median of `-30`, `-35`, and `-40 dB` speech boundaries |
| Outgoing safety handle | 20 ms after the last acoustic speech boundary |
| Incoming safety handle | 50 ms before the first acoustic speech boundary |
| Seam audio transition | 0–2 frames at 30 fps; use only when it survives onset/tail audit |
| Review coverage | every seam, in picture and sound |

Convert milliseconds to the source frame grid only after calculating the boundary. At 30 fps, the handles normally become 0–1 outgoing frame and 1–2 incoming frames. The handles protect speech; they are not silence that must be manufactured between clips.

Finish every removable seam asymmetrically:

1. Tighten the outgoing side to remove weak decay, breath, room tone, and visible reset without clipping the final phoneme.
2. Inspect the first two to three frames of the incoming phrase. If its onset sounds shaved, restore one or two source frames; never restore the whole discarded pause by default.
3. Add at most two transition frames only after the physical boundaries are correct. Use zero when a transition attenuates the onset or pulls discarded tail audio back into the cut.

Do not create a separate trim profile for this behavior. It is the default meaning of `tight-talking-head`.

## Three-layer decision

1. **Semantic selection:** use the transcript and complete spoken thought to choose the valid take, remove false starts and duplicates, and preserve connective language. ASR timestamps do not set physical cut frames.
2. **Acoustic boundary:** run silence or speech-boundary detection at all three default thresholds and use the median result. This avoids late cuts caused by room tone, breath noise, or one permissive threshold.
3. **Performance classification:** inspect gaze, mouth, head, and torso around the candidate. Preserve continuous delivery; remove reading, searching, restart preparation, and visible reset behavior.

Cut to the acoustic boundary when the speaker has stopped delivering and entered a reset. Do not retain 180–400 ms merely because it falls at a sentence or topic boundary. Conversely, do not compress an intentional pause to 80 ms when eye contact, pose, breath, and meaning remain continuous.

## Editorial heuristics

These guide ChatCut selection and Agent judgment. They do not add schema fields, validator failures, or review gates.

- **Repeated expression:** remove repetitions that add no information. Choose the take with the best completeness, accuracy, fluency, performance, and visual continuity; prefer the later take only when quality is otherwise comparable. Preserve intentional emphasis, recap, and comic repetition.
- **Correction and restart:** remove confirmed slips, failed openings, and production chatter such as requests to restart, then keep the successful delivery. Preserve meaningful negation, contrast, and rhetorical self-correction.
- **Breath and pacing:** remove reading, searching, restart preparation, and empty delay while retaining natural breath and pauses needed for comprehension or emphasis. Prefer a conservative boundary when a tighter cut creates a distracting gaze, mouth, or posture jump.

## Seam classification

Preserve a pause when at least one of these is true and no reset signal is present:

- it supports comprehension, emphasis, humor, or a deliberate change of thought;
- eye contact and body intention continue through the pause;
- the breath is part of continuous delivery and removing it makes speech sound clipped.

Remove a pause when one or more of these is visible or audible:

- gaze leaves the lens to check a script;
- mouth articulation stops and the speaker searches for the next line;
- head or torso resets between takes;
- the next phrase begins like a restart rather than continuous delivery;
- room tone or breath noise extends well beyond the last spoken phoneme.

When evidence conflicts, protect speech with 50–120 ms of padding, record low confidence, and surface only that seam for review.

Use `scripts/inspect-media-window.mjs` only for conflicting or low-confidence evidence. Its aligned filmstrip and waveform help classify gaze, mouth, posture, and audio continuity around the decision; it is internal diagnostic evidence, not a required artifact for every seam or a new review gate.

## Required trim-plan record

`state/trim-plan.json` must identify:

- `profile`, source FPS, acoustic thresholds, outgoing and incoming handles, and transition length;
- each seam or removal with semantic evidence, visual evidence, three acoustic boundaries, applied frame, classification, reason, confidence, and actual audio-transition frames;
- any deliberate pause retained as an exception;
- continuity verification and the cumulative removed duration used for timestamp migration.

## Blocking acceptance checks

- Every seam has acoustic evidence or an explicit documented exception.
- No cut is based only on a transcript or ASR word endpoint.
- No outgoing phoneme or comprehension-critical breath is clipped, and no incoming onset is shaved or faded early.
- No invalid reading, searching, or body-reset tail remains after speech.
- No audio transition restores discarded tail noise or weak decay.
- The timeline is contiguous, source order is correct, and there are no black frames, overlaps, frozen items, or detached audio.
- Every seam has been listened to and inspected at the frame before and after the cut.

The rough-cut review artifact must already pass these checks. Review is for editorial judgment, not for discovering routine boundary cleanup.

Before review, `audit-roughcut-seams.mjs` measures the final export around every seam at `-30`, `-35`, and `-40 dB` and records its SHA-256. Removed reset, false-start, restart, body-reset, and duplicate-take seams use an 80ms ceiling quantized down to source frames. Natural or intentional pauses remain exempt. `audioAudited: true` means both edges and the applied transition were heard: the outgoing phoneme is complete, the incoming onset is intact, and discarded audio was not restored. Automated measurement supplements rather than replaces picture and phoneme review.
