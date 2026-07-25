# Talking-Head Precision Trim Standard

This is MotionScript's default first-pass standard for direct-to-camera talking-head videos. It is designed to produce a reviewable cut without waiting for the user to identify long seam pauses.

## Default profile

Use `tight-talking-head` unless the user requests a slower conversational, dramatic, or lecture rhythm.

| Setting | Default |
| --- | --- |
| Boundary evidence | median of `-30`, `-35`, and `-40 dB` speech boundaries |
| Outgoing safety handle | 20 ms after the last acoustic speech boundary |
| Incoming safety handle | 50 ms before the first acoustic speech boundary |
| Seam audio transition | 2 frames at 30 fps; shorten if it touches a phoneme |
| Review coverage | every seam, in picture and sound |

Convert milliseconds to the source frame grid only after calculating the boundary. At 30 fps, the handles normally become 0–1 outgoing frame and 1–2 incoming frames. The handles protect speech; they are not silence that must be manufactured between clips.

## Three-layer decision

1. **Semantic selection:** use the transcript and complete spoken thought to choose the valid take, remove false starts and duplicates, and preserve connective language. ASR timestamps do not set physical cut frames.
2. **Acoustic boundary:** run silence or speech-boundary detection at all three default thresholds and use the median result. This avoids late cuts caused by room tone, breath noise, or one permissive threshold.
3. **Performance classification:** inspect gaze, mouth, head, and torso around the candidate. Preserve continuous delivery; remove reading, searching, restart preparation, and visible reset behavior.

Cut to the acoustic boundary when the speaker has stopped delivering and entered a reset. Do not retain 180–400 ms merely because it falls at a sentence or topic boundary. Conversely, do not compress an intentional pause to 80 ms when eye contact, pose, breath, and meaning remain continuous.

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

## Required trim-plan record

`state/trim-plan.json` must identify:

- `profile`, source FPS, acoustic thresholds, outgoing and incoming handles, and transition length;
- each seam or removal with semantic evidence, visual evidence, three acoustic boundaries, applied frame, classification, reason, confidence, and actual audio-transition frames;
- any deliberate pause retained as an exception;
- continuity verification and the cumulative removed duration used for timestamp migration.

## Blocking acceptance checks

- Every seam has acoustic evidence or an explicit documented exception.
- No cut is based only on a transcript or ASR word endpoint.
- No phoneme or comprehension-critical breath is clipped or faded early.
- No invalid reading, searching, or body-reset tail remains after speech.
- The timeline is contiguous, source order is correct, and there are no black frames, overlaps, frozen items, or detached audio.
- Every seam has been listened to and inspected at the frame before and after the cut.

The rough-cut review artifact must already pass these checks. Review is for editorial judgment, not for discovering routine boundary cleanup.
