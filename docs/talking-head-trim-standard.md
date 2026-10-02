# Talking-Head Rough-Cut Golden Standard

This is the sole detailed standard for talking-head rough cuts. All ChatCut rough cuts use the same sequence: select takes, clean remaining transcript and gap candidates, verify spoken-content coverage, then run the default clip-edge calculator before `rough-cut-review`. The calculator refines only the boundaries of clips already selected for retention; it does not decide what speech stays or search within clips. Use the existing targeted waveform review only if the user later reports that a seam still feels loose.

Use [`source-audio-silence-index.md`](source-audio-silence-index.md) only for the index format and batch-lookup mechanics. `AGENTS.md`, `docs/quality-gates.md`, and `docs/state-machine.md` describe workflow operations; they do not define alternative cut criteria.

Use a 30 fps project timeline by default, even when the source is 29.97 fps; honor another rate only when the user requests it and keep source timing distinct from the timeline frame grid.

The default calculator scans the original-source interval at both ends of every retained clip. It uses primary and lower RMS thresholds with a one-frame safety margin; ASR does not set the physical edge. It measures signal level, not sound category, so it cannot guarantee that low-level speech is preserved. Internal pauses and between-word gaps remain part of candidate cleanup. Preserve an edge when the source mapping is uncertain or the recording shows quiet speech at that boundary.

## Fast review path

1. **Select speech semantically in ChatCut:** use Script and the recording to remove misspeaks, failed starts, retries, repeated takes, and contextually confirmed filler words. Check retained rows for a failed restart merged with the correct take; use Script's inline `~~…~~` strike to remove only the failed fragment. Keep the last complete, correct take by default. Preserve quiet speech, meaningful interjections, natural breaths, and intentional emphasis. Do not rely on transcript row length alone to choose a take.
2. **Protect Chinese words during filler cleanup:** never run `clean_script({only:"fillers"})` on Chinese speech; its fixed list removes every `额` token, including the lexical `额` in `免费额度`. Remove `呃`/`额` only through Script after confirming each hit is a standalone disfluency. ASR omissions do not identify mouth clicks; remove a click only when audio evidence confirms it is non-speech. If playback is unavailable, preserve ambiguous sound and report it as unverified.
3. **Find gap candidates:** copy `state/timeline-source-windows.json` to `state/timeline-source-windows.pre-cleanup.json` before changing anything, then compare source-aligned word timings in `state/source-transcript.json` with the retained timeline and read Script with `showSilence:true`. Every other retained source span with no aligned ASR word for at least 0.3 seconds—including internal pauses and between-word gaps—is a candidate for inspection, not an automatic deletion. Run `scripts/detect-silence.sh <original-source>` once with its default `-30`, `-35`, and `-40 dB` sweep (minimum detected duration 0.45 seconds), keep the output as `state/source-silence-db-scan.txt`, and consider only intervals that overlap retained source footage. Merge overlapping candidates and classify them using the audio-led rules in “Seam classification” below. The dB sweep complements ASR; it does not label a sound or authorize a cut. Run `scripts/classify-gaps.mjs <job-directory> --write` to detect the candidates and cite the sweep hits for each one instead of assembling that list by hand; the command removes the bookkeeping, not the judgment.
4. **Classify candidates and protect content:** mark each remaining candidate for removal or retention by setting `classification` and `reasonCode`/`reason` on its entry in `state/gap-candidates.json`. Remove confirmed dead air, hiccups, clicks, false starts, and resets; preserve quiet words, natural breaths, meaningful pauses, and ambiguous sounds. Every candidate at or above 0.8 seconds needs its own written reason. Compare the retained timeline with the recording-backed source transcript and reconciled reference wording: every valid spoken phrase must remain once or have an explicit editorial disposition. Never remove a complete correct phrase solely because its wording differs from the reference or ASR. `clean_script({only:"silence",longSilence:800})` is allowed only when every affected pause is clearly expendable; do not lower this bulk-cleanup setting to 0.3 seconds. If playback is unavailable, preserve ambiguous sound and report it as unverified.
5. **Check speech coverage:** re-read the retained timeline with `showSilence:true` and confirm every valid spoken phrase remains once or has an explicit editorial disposition. No gap candidate may remain unexplained before edge tightening. The transition into `rough-cut-review` enforces this: `scripts/check-gap-candidates.mjs` re-detects the candidates against the locked timeline and fails on any retained pause without a disposition, on any removal that is still present, and on any pause excised from the pre-cleanup snapshot that went unrecorded.
6. **Run default edge tightening:** build or reuse the original-source waveform index, create `state/timeline-source-windows.json` from the current ChatCut timeline, and confirm every item's explicit 1x playback rate and source-time mapping. Run `scripts/compute-seam-tightening.mjs` once across the retained clips. Apply its candidate frame plan through one ChatCut `edit_item` update batch, using the plan's adjusted timeline starts and durations and advancing each source start by its proposed head-trim frames. Cleanup must be applied before this step, not after: the gap-candidate check compares the tightening plan's item count with the locked timeline, so a plan computed on the pre-cleanup structure fails. The calculator does not classify speech or guarantee that low-level speech is preserved; keep an original edge when its mapping is uncertain or the recording contradicts the proposal. Use the existing rough-cut review for the result; do not add per-seam playback as a default gate. Do not run the targeted seam lookup unless the user reports a loose seam or asks for a diagnosis.
7. **Keep transitions local:** do not run global `smooth_audio` by default. If a confirmed hard pop remains after the physical boundary is correct, use a local 0–2 frame transition and recheck the onset; default to 0.
8. **Review:** open the tightened rough cut in ChatCut. This remains the existing `rough-cut-review` gate; the calculator adds no workflow state or approval gate.

Record elapsed seconds while working in `state/chatcut-roughcut.json` under the schema's existing `elapsedSecondsByStage` keys: project/asset lookup as `projectAndAssetLookup`, transfer as `assetTransfer`, semantic editing as `semanticCut`, the default calculator as `wholeTimelineSweep`, transcription as `transcription`, source-index work as `sourceWaveformIndex`, targeted fallback lookup as `batchSeamLookup`, applied edge changes as `seamAdjustment`, and end-to-end duration as `total`. Omit stages that were not run or not measured; use `0` only for confirmed zero-duration work. Do not estimate timings afterward.
## User-feedback seam review

If the user reports that a seam still feels loose after the default calculator, follow the normal rough-cut revision route and use one targeted batch lookup for the reported edge or edges. Follow [`source-audio-silence-index.md`](source-audio-silence-index.md) for the schema-v2 lookup, then use the existing audio-led seam classification and localized playback when available. Apply supported corrections together; preserve ambiguous edges. This is the fallback path, not an additional default pass.

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
