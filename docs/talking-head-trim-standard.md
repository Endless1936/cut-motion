# Talking-Head Rough Cut

Default: **one semantic pass → one pause-cleanup pass → one edge-tightening pass → deliver the ChatCut project for listening**. For a 5–6 minute recording, target roughly ten minutes to this handoff when tools are available. Report a blocking tool failure promptly with the usable result so far. The user judges listening quality in `rough-cut-review`.

## Start or resume

Create the job once; this entry point copies the source and creates workflow state:

```bash
./scripts/scaffold-project.sh jobs/<job-id> /absolute/source.mov review
```

Resume from `workflow-state.mjs ... status`. Match the source to its ChatCut asset once. If a usable cut already exists, give the user its project link and apply only requested revisions. Local source-word conversion, reconciliation, Caption Plan and MG planning belong after rough-cut approval.

## Three editing passes

1. **Semantic edit.** Read ChatCut Script and remove misspeaks, failed starts, repeated takes and production chatter. Keep the last complete correct take by default, preserving meaningful emphasis and rhetorical self-correction. Use inline deletion for failed fragments within a row. For Chinese, remove only contextually confirmed standalone fillers: bulk filler cleanup can delete the lexical `额` in `免费额度`.
2. **Pause cleanup.** Read the retained Script with `showSilence:true`; remove empty delays and restart preparation, including pauses inside clips. Use one `scripts/detect-silence.sh <source>` scan when needed to locate remaining low-level gaps. Word timing and quiet intervals support these edits; ambiguous breaths or possible quiet words remain for user listening. Absence of an ASR word alone does not identify a mouth click. Process candidates directly; no classification ledger, pre-cleanup snapshot, per-candidate reason or full speech-coverage report is required.
3. **Edge tightening.** Save the current `preview_timeline` structured response (all pages) and run the command below. Apply the plan once in a batch. It already handles source bounds, waveform offsets, low-level tails and frame safety margins. ASR intervals are often wider than the physical sound: overlap with an ASR word is not a reason to re-audit every edge or reject the plan. If the mapping is unsupported, keep those edges and disclose that limitation at handoff.

## Edge command

Use a 30 fps timeline by default. Save tool responses directly as JSON under the job; pass multiple files for paginated results:

```bash
node scripts/prepare-rough-cut.mjs jobs/<job-id> tighten jobs/<job-id>/state/chatcut-timeline.json
```

The command builds/reuses the waveform index, converts timeline entries into source windows, and writes `state/seam-tightening-plan.json`. It supports a single source video track at an integer timeline fps with a linear 1x mapping; the source span must agree with each clip's frame duration. Fetch another timeline page only when pagination requires it. Query individual items only to resolve missing or unsupported mapping data.

For each plan clip, send ChatCut the computed `timelineStartFrameAfterShift`, `durationFramesAfterTrim`, `sourceStartUsAfterTrim` and `sourceEndUsAfterTrim` in the tool's corresponding fields. Keep item IDs unchanged. The companion `timeline-source-windows.proposed.json` contains the resulting mapping: adopt it as `timeline-source-windows.json` only after the entire batch succeeds. For a partial failure, fetch the actual current timeline once and report the outcome rather than reapplying the old batch.

One final timeline read confirms the batch landed. Deliver immediately; no further scan, ASR-overlap sweep, gap reclassification, per-seam playback or MP4 export precedes listening. Do not run global audio smoothing by default.

## Handoff

```bash
node scripts/workflow-state.mjs jobs/<job-id>/state/workflow.json review-cut --project-id <project-id> --timeline-id <timeline-id>
```

This generates the rough-cut record and enters the existing `rough-cut-review` from intake, transcription or rough-cut. It checks any existing source-transcript lock but does not demand one to hear the cut. Give the project link, current duration and any skipped operation; then wait for the user's decision. The command records a handoff, not proof that edits or listening occurred.

## After user feedback

Repair only the reported passages. A targeted waveform lookup or `inspect-media-window.mjs` can help with a specific seam; see [audio index mechanics](source-audio-silence-index.md). `classify-gaps.mjs` and `check-gap-candidates.mjs` remain optional diagnostics for a requested cleanup investigation.

For an explicit FFmpeg fallback, use the existing trim-plan commands and their media checks. This is not a second pass on a ChatCut cut.
