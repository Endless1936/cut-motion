# Talking-Head Rough-Cut Golden Standard

This is the sole detailed standard for talking-head rough cuts. All ChatCut rough cuts use the same sequence: select takes from the recording, locate terminal-tail candidates from ASR timing, inspect remaining transcript and low-level-audio candidates, verify spoken-content coverage, and use one original-source waveform batch lookup before `rough-cut-review`. ASR and dB detections locate candidates; original-source audio evidence determines whether and where to trim. Exhaustive localized playback at every seam is not part of the default pass.

Use [`source-audio-silence-index.md`](source-audio-silence-index.md) only for the index format and batch-lookup mechanics. `AGENTS.md`, `docs/quality-gates.md`, and `docs/state-machine.md` describe workflow operations; they do not define alternative cut criteria.

Use a 30 fps project timeline by default, even when the source is 29.97 fps; honor another rate only when the user requests it and keep source timing distinct from the timeline frame grid.

The terminal-tail pass applies only after ChatCut semantic editing. The final aligned ASR word locates the suffix candidate; it does not set the cut frame. Decide whether and where to trim from original-source audio evidence, and preserve an ambiguous tail. Do not extend this rule to clip heads, pauses inside a clip, or gaps between words. Refine all other physical cut edges from the original waveform.

## Fast review path

1. **Select speech semantically in ChatCut:** use Script and the recording to remove misspeaks, failed starts, retries, repeated takes, and contextually confirmed filler words. Keep the last complete, correct take by default. Preserve quiet speech, meaningful interjections, natural breaths, and intentional emphasis. Do not rely on transcript row length alone to choose a take.

Scan for residual takes in the opposite direction before finishing this step: ASR often merges a failed attempt into the same transcript row as the successful delivery, so a whole-row keep-or-drop decision hides it and the failure survives into the cut. Re-read every retained row for a repeated leading phrase and delete the failed attempt inside the row with Script's inline `~~…~~` strike. A row-level decision alone never clears an in-row residual, and completeness checking below is forward-only, so nothing else catches it later.
2. **Protect Chinese words during filler cleanup:** never run `clean_script({only:"fillers"})` on Chinese speech; its fixed list removes every `额` token, including the lexical `额` in `免费额度`. Remove `呃`/`额` only through Script after confirming each hit is a standalone disfluency. ASR omissions do not identify mouth clicks; remove a click only when audio evidence confirms it is non-speech. If playback is unavailable, preserve ambiguous sound and report it as unverified.
3. **Trim terminal tails:** immediately after semantic editing, map each retained clip's final aligned word end from `state/source-transcript.json` to source time; this starts the terminal-tail candidate, not the cut. Use original-source audio evidence to decide whether non-speech tail remains and where speech ends. Trim confirmed tail only, rounding that audio boundary to the nearest 30 fps timeline frame, then shift following clips left to keep the sequence closed. If the confirmed tail is under half a frame, leave it unchanged; if the audio evidence is ambiguous or the final word has no reliable mapping, preserve the suffix for candidate review. Do not use this rule on clip heads, internal pauses, or between-word gaps.

This step is mandatory for every rough cut. Never omit it, and never substitute `clean_script` silence compression for it: that bulk cleanup keeps a preserved floor in place and cannot remove a tail. The cut frame comes from original-source audio evidence alone — do not cut at the aligned ASR word end and do not combine the two as `max(ASR end, waveform end)`, because ASR word ends routinely extend past real energy and that combination preserves the very blank this step exists to remove. Record the pass in `state/chatcut-roughcut.json`; the review gate requires that record. Compute it with `scripts/compute-seam-tightening.mjs` from the waveform index and `state/timeline-source-windows.json` rather than deriving cut frames by hand — the two hand-written formulas tried so far both failed, one of them by preserving the blank it was meant to remove.
4. **Find other gap candidates:** after the terminal-tail pass, compare source-aligned word timings in `state/source-transcript.json` with the retained timeline and read Script with `showSilence:true`. Every other retained source span with no aligned ASR word for at least 0.3 seconds—including clip heads, internal pauses, and timeline ends—is a candidate for inspection, not an automatic deletion. Run `scripts/detect-silence.sh <original-source>` once with its default `-30`, `-35`, and `-40 dB` sweep (minimum detected duration 0.45 seconds); consider only intervals that overlap retained source footage. Merge overlapping candidates and classify them using the audio-led rules in “Seam classification” below. The dB sweep complements ASR; it does not label a sound or authorize a cut.
5. **Classify candidates and protect content:** mark each remaining candidate for removal or retention. Remove confirmed dead air, hiccups, clicks, false starts, and resets; preserve quiet words, natural breaths, meaningful pauses, and ambiguous sounds. Compare the retained timeline with the recording-backed source transcript and reconciled reference wording: every valid spoken phrase must remain once or have an explicit editorial disposition. Never remove a complete correct phrase solely because its wording differs from the reference or ASR. `clean_script({only:"silence",longSilence:800})` is allowed only when every affected pause is clearly expendable; do not lower this bulk-cleanup setting to 0.3 seconds. If playback is unavailable, preserve ambiguous sound and report that limitation.
6. **Check first-pass completeness:** re-read the retained timeline with `showSilence:true`; confirm the terminal-tail pass, every remaining gap candidate, every valid spoken phrase, and both timeline ends are accounted for. No candidate may remain unexplained before seam refinement.
7. **Use one batch seam lookup:** use the prebuilt source-waveform index to collect traces for all retained cut in/out edges, including both sides of each newly created cut. This is diagnostic evidence, not an instruction to listen to every seam or move every edge. Do not adjust an edge from a dB threshold or waveform dip alone; use targeted playback only when a candidate scan or trace shows a specific concern and playback is available. Preserve ambiguous edges and do not rescan the source separately for each cut.

Record elapsed seconds while working in `state/chatcut-roughcut.json` under the schema's existing `elapsedSecondsByStage` keys: project/asset lookup as `projectAndAssetLookup`, transfer as `assetTransfer`, semantic editing as `semanticCut`, terminal-tail and other pause/head-tail cleanup as `wholeTimelineSweep`, transcription as `transcription`, source-index work as `sourceWaveformIndex`, one manifest query as `batchSeamLookup`, applied edge changes as `seamAdjustment`, and end-to-end duration as `total`. Omit stages that were not run or not measured; use `0` only for confirmed zero-duration work. Do not estimate timings afterward.
8. **Keep transitions local:** do not run global `smooth_audio` by default. If a confirmed hard pop remains after the physical boundary is correct, use a local 0–2 frame transition and recheck the onset; default to 0.
9. **Review:** open the internally checked rough cut in ChatCut. This remains the existing rough-cut review gate; tail cleanup, candidate classification, and seam refinement add no workflow state or approval gate.

## Source-waveform boundary refinement

This procedure applies to every ChatCut rough cut after semantic editing, terminal-tail trimming, and remaining candidate cleanup. It refines accepted edit seams; it does not replace or postpone ChatCut's editorial decisions.

1. Follow [`source-audio-silence-index.md`](source-audio-silence-index.md) to build or reuse the original-source index during semantic editing, then have it ready before the batch lookup. Candidate discovery is separate and may include ASR gaps and threshold detections.
2. Use the operator-attested schema-v2 lookup as waveform evidence, not as an automatic cut recommendation. The utility checks map fields for consistency; the operator remains responsible for matching the ChatCut asset metadata to the original-file probe. A trace of the two edge neighborhoods is not evidence for the uninspected interior. ASR, VAD, and fixed dB values do not choose physical boundaries. Inspect only seams implicated by a specific candidate or conspicuous trace; use localized playback when available, and preserve ambiguous edges.
3. Do not run an exhaustive edge-tightening pass. If a clearly expendable edge is adjusted, keep outgoing blank under one full timeline frame and incoming preceding blank at no more than one full frame after frame-grid quantization. This guard bounds this optional refinement stage only; it is never grounds for skipping mandatory fast-path step 3, whose terminal-tail removal is a different, required pass.
4. Apply any accepted seam edits together. Transition handling follows the single fast-path rule above.

## Legacy FFmpeg trim-plan path

This is a separate explicit fallback, not a second rough-cut standard. `scripts/apply-trim-plan.sh` applies authored frame ranges; `scripts/finalize-trim-plan.mjs` audits that output, including threshold-relative dB checks. The audit can reject a trim-plan result, but it does not choose or move cut frames. It is not run for ChatCut timelines.

## Editorial heuristics

These guide ChatCut selection and Agent judgment. They do not add schema fields, validator failures, or review gates.

- **Repeated expression:** remove retries and repetitions that add no information. Keep the last complete, correct take by default; use an earlier take only when the later one is incomplete or incorrect, never merely because the earlier transcript alignment looks cleaner. Preserve intentional emphasis, recap, and comic repetition.
- **Correction and restart:** remove confirmed slips, failed openings, and production chatter such as requests to restart, then keep the last successful delivery. Preserve meaningful negation, contrast, and rhetorical self-correction.
- **Breath and pacing:** remove reading, searching, restart preparation, and empty delay while retaining natural breath and pauses needed for comprehension or emphasis. Prefer a conservative boundary when audio evidence is ambiguous.

## Seam classification

For sentence-tail candidates, use original-source audio evidence to establish where speech ends; the aligned ASR endpoint only locates where to inspect. Do not cut at the ASR endpoint alone or trim a tail solely because of gaze, head, or body movement. Use picture only to help identify a false start/restart or take reset. Preserve the tail when the audio evidence is ambiguous.

Preserve a pause when at least one of these is true and no reset signal is present:

- it supports comprehension, emphasis, humor, or a deliberate change of thought;
- the breath is part of continuous delivery and removing it makes speech sound clipped.

Remove a pause only when audio confirms expendable non-speech or semantic review confirms a false start/restart:

- the next phrase begins like a restart rather than continuous delivery;
- room tone or breath noise extends well beyond the last spoken phoneme.

Use `scripts/inspect-media-window.mjs` only for conflicting or low-confidence evidence. Its aligned filmstrip and waveform may help identify a false start/restart and assess audio continuity; it is internal diagnostic evidence, not a required artifact for every seam or a new review gate.
